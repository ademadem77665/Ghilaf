const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const JAVA_KW = new Set(['abstract','assert','boolean','break','byte','case','catch','char','class','const','continue','default','do','double','else','enum','extends','final','finally','float','for','goto','if','implements','import','instanceof','int','interface','long','native','new','package','private','protected','public','return','short','static','strictfp','super','switch','synchronized','this','throw','throws','transient','try','void','volatile','while','true','false','null','_']);

const V = {
  name(v) {
    v = String(v || '').trim();
    if (!/^[\p{L}\p{N} _.\-]{1,30}$/u.test(v)) {
      throw new UserError('اسم التطبيق من 1 إلى 30 حرفاً، ويقبل الحروف والأرقام والمسافة والشرطة والنقطة فقط.');
    }
    return v;
  },
  pkg(v) {
    v = String(v || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,4}$/.test(v) || v.length > 100 || v.split('.').some((s) => JAVA_KW.has(s))) {
      throw new UserError('معرّف الحزمة غير صالح. مثال صحيح: com.mycompany.myapp');
    }
    return v;
  },
  url(v) {
    v = String(v || '').trim();
    let u;
    try { u = new URL(v); } catch { throw new UserError('الرابط غير صالح. اكتبه كاملاً مع https://'); }
    if (!['http:', 'https:'].includes(u.protocol) || v.length > 500) throw new UserError('الرابط يجب أن يبدأ بـ https:// أو http://');
    if (u.username || u.password) throw new UserError('لا يُسمح بكلمة مرور داخل الرابط.');
    return u.href;
  },
  color(v) {
    v = String(v || '').trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw new UserError('اللون يجب أن يكون بصيغة #RRGGBB');
    return v.toUpperCase();
  },
  contact(v) {
    v = String(v || '').trim().slice(0, 200);
    if (/[\u0000-\u001f]/.test(v)) throw new UserError('نص التواصل يحتوي رموزاً غير مسموحة.');
    return v;
  },
  versionName(v) {
    v = String(v || '1.0').trim();
    if (!/^\d{1,3}(\.\d{1,3}){0,2}$/.test(v)) throw new UserError('رقم الإصدار مثل 1.0 أو 1.2.3');
    return v;
  },
  email(v) {
    v = String(v || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 200) throw new UserError('أدخل بريداً إلكترونياً صحيحاً.');
    return v;
  },
};

const ALLOWED_EXT = new Set(['.html','.htm','.css','.js','.mjs','.json','.map','.txt','.xml','.webmanifest','.png','.jpg','.jpeg','.gif','.webp','.avif','.svg','.ico','.woff','.woff2','.ttf','.otf','.eot','.mp3','.mp4','.webm','.ogg','.wav','.pdf']);
const MAX_FILES = 2000;
const MAX_TOTAL = 100 * 1024 * 1024;

// فك ZIP بأمان: يمنع Zip Slip، ويحدد الحجم والعدد والأنواع، ويشترط index.html
function extractSite(buf, dest) {
  let zip;
  try { zip = new AdmZip(buf); } catch { throw new UserError('تعذّر قراءة ملف ZIP. تأكد أنه غير تالف.'); }
  const all = zip.getEntries().filter((e) => !e.isDirectory);
  if (all.length === 0) throw new UserError('ملف ZIP فارغ.');
  if (all.length > MAX_FILES) throw new UserError(`عدد الملفات أكبر من ${MAX_FILES}.`);

  const norm = all
    .map((e) => ({ e, name: e.entryName.replace(/\\/g, '/').replace(/^\/+/, '') }))
    .filter((x) => !x.name.startsWith('__MACOSX/') && path.posix.basename(x.name) !== '.DS_Store');

  let prefix = '';
  if (!norm.some((x) => x.name === 'index.html')) {
    const tops = new Set(norm.map((x) => x.name.split('/')[0]));
    if (tops.size === 1) {
      const t = [...tops][0];
      if (norm.some((x) => x.name === t + '/index.html')) prefix = t + '/';
    }
  }
  if (!norm.some((x) => x.name === prefix + 'index.html')) {
    throw new UserError('لم نجد index.html في جذر الملف. ضعه في المستوى الأول داخل ZIP.');
  }

  const tmp = dest + '.tmp-' + crypto.randomBytes(4).toString('hex');
  fs.mkdirSync(tmp, { recursive: true });
  let total = 0;
  try {
    for (const { e, name } of norm) {
      if (!name.startsWith(prefix)) continue;
      const rel = name.slice(prefix.length);
      if (!rel) continue;
      const parts = rel.split('/');
      if (parts.some((p) => p === '' || p === '.' || p === '..' || p.includes(':'))) throw new UserError('الملف يحتوي مسارات غير آمنة.');
      if (!ALLOWED_EXT.has(path.extname(rel).toLowerCase())) throw new UserError(`نوع الملف غير مسموح: ${rel}`);
      const target = path.join(tmp, ...parts);
      if (!target.startsWith(tmp + path.sep)) throw new UserError('الملف يحتوي مسارات غير آمنة.');
      const data = e.getData();
      total += data.length;
      if (total > MAX_TOTAL) throw new UserError('الحجم بعد فك الضغط أكبر من 100 ميغابايت.');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
    }
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(tmp, dest);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

module.exports = { UserError, V, ...V, extractSite };
