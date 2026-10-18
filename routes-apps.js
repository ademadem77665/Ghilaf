const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const db = require('./db');
const cfg = require('./config');
const { UserError, V, extractSite } = require('./util');
const { effectivePlan, limitsFor, monthStart } = require('./plans');
const { wrap } = require('./auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 2, fields: 20 } });

const D = cfg.DATA_DIR;
const sitesDir = (id) => path.join(D, 'sites', id);
const iconPath = (id) => path.join(D, 'icons', id + '.png');
const keyPath = (id) => path.join(D, 'keys', id + '.jks');
const outDir = (id) => path.join(D, 'outputs', String(id));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const appDto = (a) => ({
  id: a.id, name: a.name, package: a.package, source: a.source, url: a.url, color: a.color,
  contact: a.contact || '', hasIcon: !!a.has_icon, versionCode: a.version_code, versionName: a.version_name,
  status: a.status, createdAt: a.created_at,
  siteUrl: a.source === 'zip' ? `${cfg.SITES_URL}/${a.id}/` : null,
});

const buildDto = (b, full = false) => {
  const o = {
    id: b.id, appId: b.app_id, format: b.format, status: b.status, versionCode: b.version_code,
    versionName: b.version_name, error: b.error, hasApk: !!b.has_apk, hasAab: !!b.has_aab, hasKey: !!b.has_key,
    createdAt: b.created_at, finishedAt: b.finished_at,
  };
  if (full) {
    o.log = (b.log || '').slice(-20000);
    o.keyPass = b.status === 'ready' ? b.key_pass : null;
  }
  return o;
};

function getApp(req) {
  const id = String(req.params.id || '');
  const a = UUID.test(id) ? db.prepare('SELECT * FROM apps WHERE id=?').get(id) : null;
  if (!a || (a.user_id !== req.user.id && req.user.role !== 'admin')) throw new UserError('التطبيق غير موجود.', 404);
  return a;
}

async function saveIcon(buf, id) {
  try {
    const m = await sharp(buf, { limitInputPixels: 25e6 }).metadata();
    if (!['png', 'jpeg', 'webp'].includes(m.format)) throw new Error('format');
    fs.mkdirSync(path.dirname(iconPath(id)), { recursive: true });
    await sharp(buf, { limitInputPixels: 25e6 }).resize(512, 512, { fit: 'cover' }).png().toFile(iconPath(id));
  } catch {
    throw new UserError('الأيقونة غير صالحة. ارفع صورة PNG أو JPG أو WebP.');
  }
}

function removeAppFiles(id) {
  const builds = db.prepare('SELECT id FROM builds WHERE app_id=?').all(id);
  for (const b of builds) fs.rmSync(outDir(b.id), { recursive: true, force: true });
  fs.rmSync(sitesDir(id), { recursive: true, force: true });
  fs.rmSync(iconPath(id), { force: true });
  fs.rmSync(keyPath(id), { force: true });
}

// قائمة تطبيقاتي
router.get('/apps', (req, res) => {
  const rows = db.prepare('SELECT * FROM apps WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);
  const last = db.prepare('SELECT status,format,version_name FROM builds WHERE app_id=? ORDER BY id DESC LIMIT 1');
  res.json({ apps: rows.map((a) => ({ ...appDto(a), lastBuild: last.get(a.id) || null })) });
});

// إنشاء تطبيق (رابط أو ZIP)
router.post('/apps', upload.fields([{ name: 'icon', maxCount: 1 }, { name: 'zip', maxCount: 1 }]), wrap(async (req, res) => {
  const lim = limitsFor(req.user);
  const count = db.prepare('SELECT COUNT(*) c FROM apps WHERE user_id=?').get(req.user.id).c;
  if (count >= lim.apps) {
    throw new UserError(effectivePlan(req.user) === 'expired' ? 'اشتراكك منتهٍ. جدّد اشتراكك للمتابعة.' : `وصلت إلى الحد الأقصى لخطتك (${lim.apps} تطبيقات).`, 403);
  }
  const b = req.body;
  const source = b.source === 'zip' ? 'zip' : 'url';
  const name = V.name(b.name);
  const color = V.color(b.color || '#0B7A63');
  const contact = V.contact(b.contact);
  const id = crypto.randomUUID();
  const pkg = String(b.package || '').trim() ? V.pkg(b.package) : `com.ghilaf.app${id.replace(/-/g, '').slice(0, 10)}`;
  if (db.prepare('SELECT 1 FROM apps WHERE package=?').get(pkg)) throw new UserError('معرّف الحزمة مستخدم في تطبيق آخر. اختر غيره.', 409);

  let urlV = null;
  if (source === 'url') {
    urlV = V.url(b.url);
  } else {
    const z = req.files && req.files.zip && req.files.zip[0];
    if (!z) throw new UserError('ارفع ملف ZIP لموقعك.');
    extractSite(z.buffer, sitesDir(id));
  }
  let hasIcon = 0;
  try {
    if (req.files && req.files.icon && req.files.icon[0]) { await saveIcon(req.files.icon[0].buffer, id); hasIcon = 1; }
    db.prepare(`INSERT INTO apps(id,user_id,name,package,source,url,color,contact,has_icon,version_code,version_name,status,created_at)
                VALUES(?,?,?,?,?,?,?,?,?,0,'1.0','active',?)`).run(id, req.user.id, name, pkg, source, urlV, color, contact, hasIcon, Date.now());
  } catch (err) {
    removeAppFiles(id);
    throw err;
  }
  res.json({ app: appDto(db.prepare('SELECT * FROM apps WHERE id=?').get(id)) });
}));

// تفاصيل تطبيق مع بناءاته
router.get('/apps/:id', (req, res) => {
  const a = getApp(req);
  const builds = db.prepare('SELECT * FROM builds WHERE app_id=? ORDER BY id DESC LIMIT 30').all(a.id);
  const hasKey = !!a.key_pass && fs.existsSync(keyPath(a.id));
  res.json({ app: { ...appDto(a), hasKey, keyPass: hasKey ? a.key_pass : null }, builds: builds.map((x) => buildDto(x)) });
});

// مفتاح توقيع التطبيق (واحد لكل تطبيق، ويلزم لكل تحديث)
router.get('/apps/:id/keystore', (req, res) => {
  const a = getApp(req);
  if (!a.key_pass || !fs.existsSync(keyPath(a.id))) throw new UserError('لم يُنشأ مفتاح لهذا التطبيق بعد. ابنِ التطبيق أولاً.', 404);
  res.download(keyPath(a.id), `${a.package}-upload-keystore.jks`);
});

// تعديل بيانات التطبيق (تحتاج بناءً جديداً لتظهر داخل التطبيق)
router.patch('/apps/:id', upload.single('icon'), wrap(async (req, res) => {
  const a = getApp(req);
  const b = req.body;
  const name = b.name !== undefined ? V.name(b.name) : a.name;
  const color = b.color !== undefined ? V.color(b.color) : a.color;
  const contact = b.contact !== undefined ? V.contact(b.contact) : a.contact;
  const url = a.source === 'url' && b.url !== undefined ? V.url(b.url) : a.url;
  let hasIcon = a.has_icon;
  if (req.file) { await saveIcon(req.file.buffer, a.id); hasIcon = 1; }
  db.prepare('UPDATE apps SET name=?,color=?,contact=?,url=?,has_icon=? WHERE id=?').run(name, color, contact, url, hasIcon, a.id);
  res.json({ app: appDto(db.prepare('SELECT * FROM apps WHERE id=?').get(a.id)) });
}));

// استبدال ملفات الموقع المستضاف (يظهر فوراً دون إعادة بناء)
router.post('/apps/:id/site', upload.single('zip'), wrap(async (req, res) => {
  const a = getApp(req);
  if (a.source !== 'zip') throw new UserError('هذا التطبيق مرتبط برابط وليس بملفات.');
  if (!req.file) throw new UserError('ارفع ملف ZIP.');
  extractSite(req.file.buffer, sitesDir(a.id));
  res.json({ ok: true });
}));

router.delete('/apps/:id', (req, res) => {
  const a = getApp(req);
  removeAppFiles(a.id);
  db.prepare('DELETE FROM apps WHERE id=?').run(a.id);
  res.json({ ok: true });
});

// طلب بناء جديد
router.post('/apps/:id/builds', wrap(async (req, res) => {
  const a = getApp(req);
  const owner = db.prepare('SELECT * FROM users WHERE id=?').get(a.user_id);
  const lim = limitsFor(owner);
  if (a.status !== 'active') throw new UserError('هذا التطبيق موقوف.', 403);
  const format = req.body.format === 'aab' ? 'aab' : 'apk';
  if (!lim.formats.includes(format)) {
    throw new UserError(effectivePlan(owner) === 'expired' ? 'اشتراكك منتهٍ. جدّد اشتراكك للمتابعة.' : `صيغة ${format.toUpperCase()} غير متاحة في خطتك.`, 403);
  }
  const vn = V.versionName(req.body.versionName || a.version_name);
  const used = db.prepare("SELECT COUNT(*) c FROM builds WHERE user_id=? AND created_at>=? AND status!='failed'").get(owner.id, monthStart()).c;
  if (used >= lim.builds) throw new UserError(`استهلكت عمليات البناء الشهرية (${lim.builds}).`, 403);
  if (db.prepare("SELECT 1 FROM builds WHERE app_id=? AND status IN ('queued','building')").get(a.id)) {
    throw new UserError('هناك عملية بناء جارية لهذا التطبيق. انتظر حتى تنتهي.', 409);
  }
  const create = db.transaction(() => {
    const vc = db.prepare('SELECT version_code FROM apps WHERE id=?').get(a.id).version_code + 1;
    db.prepare('UPDATE apps SET version_code=?, version_name=? WHERE id=?').run(vc, vn, a.id);
    return db.prepare('INSERT INTO builds(app_id,user_id,format,status,version_code,version_name,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(a.id, owner.id, format, 'queued', vc, vn, Date.now()).lastInsertRowid;
  });
  const id = create();
  res.json({ build: buildDto(db.prepare('SELECT * FROM builds WHERE id=?').get(id), true) });
}));

function getBuild(req) {
  const b = db.prepare('SELECT * FROM builds WHERE id=?').get(+req.params.id || 0);
  if (!b || (b.user_id !== req.user.id && req.user.role !== 'admin')) throw new UserError('عملية البناء غير موجودة.', 404);
  return b;
}

router.get('/builds/:id', (req, res) => res.json({ build: buildDto(getBuild(req), true) }));

router.get('/builds/:id/download/:kind', (req, res) => {
  const b = getBuild(req);
  const app = db.prepare('SELECT * FROM apps WHERE id=?').get(b.app_id);
  const map = {
    apk: [b.has_apk, 'app.apk', `${app.package}-${b.version_name}.apk`],
    aab: [b.has_aab, 'app.aab', `${app.package}-${b.version_name}.aab`],
    keystore: [b.has_key, 'upload-keystore.jks', `${app.package}-upload-keystore.jks`],
    icon: [b.status === 'ready', 'icon-512.png', `${app.package}-icon-512.png`],
  };
  const m = map[req.params.kind];
  const file = m && m[0] ? path.join(outDir(b.id), m[1]) : null;
  if (!file || !fs.existsSync(file)) throw new UserError('الملف غير متوفر. قد يكون حُذف بعد انتهاء مدة الحفظ.', 404);
  res.download(file, m[2]);
});

module.exports = { router, removeAppFiles, outDir, buildDto, appDto };
