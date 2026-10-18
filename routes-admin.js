const express = require('express');
const db = require('./db');
const { UserError } = require('./util');
const { PLANS } = require('./plans');
const { wrap } = require('./auth');
const { removeAppFiles } = require('./routes-apps');

const router = express.Router();

router.get('/stats', (req, res) => {
  const one = (sql, ...p) => db.prepare(sql).get(...p).c;
  const week = Date.now() - 7 * 86400000;
  const byStatus = {};
  for (const r of db.prepare('SELECT status, COUNT(*) c FROM builds GROUP BY status').all()) byStatus[r.status] = r.c;
  res.json({
    users: one('SELECT COUNT(*) c FROM users'),
    paidActive: one("SELECT COUNT(*) c FROM users WHERE plan!='free' AND plan_expires>?", Date.now()),
    expiringSoon: one("SELECT COUNT(*) c FROM users WHERE plan!='free' AND plan_expires BETWEEN ? AND ?", Date.now(), Date.now() + 7 * 86400000),
    apps: one('SELECT COUNT(*) c FROM apps'),
    newUsers7d: one('SELECT COUNT(*) c FROM users WHERE created_at>?', week),
    builds7d: one('SELECT COUNT(*) c FROM builds WHERE created_at>?', week),
    buildsByStatus: byStatus,
  });
});

router.get('/users', (req, res) => {
  const q = `%${String(req.query.q || '').trim().toLowerCase()}%`;
  const rows = db.prepare(`SELECT u.id,u.email,u.name,u.role,u.plan,u.plan_expires,u.disabled,u.created_at,
      (SELECT COUNT(*) FROM apps a WHERE a.user_id=u.id) AS apps
      FROM users u WHERE lower(u.email) LIKE ? OR lower(u.name) LIKE ? ORDER BY u.id DESC LIMIT 200`).all(q, q);
  res.json({ users: rows.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, plan: u.plan, planExpires: u.plan_expires, disabled: !!u.disabled, createdAt: u.created_at, apps: u.apps })) });
});

// تفعيل اشتراك يدوي: الخطة + تاريخ الانتهاء + إيقاف الحساب
router.post('/users/:id', wrap(async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(+req.params.id || 0);
  if (!u) throw new UserError('المستخدم غير موجود.', 404);
  const plan = req.body.plan !== undefined ? String(req.body.plan) : u.plan;
  if (!PLANS[plan] || plan === 'expired') throw new UserError('خطة غير معروفة.');
  let expires = u.plan_expires;
  if (plan === 'free') {
    expires = null;
  } else if (req.body.planExpires !== undefined) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(req.body.planExpires));
    if (!m) throw new UserError('تاريخ الانتهاء بصيغة YYYY-MM-DD.');
    expires = Date.UTC(+m[1], +m[2] - 1, +m[3], 23, 59, 59);
  }
  if (plan !== 'free' && !expires) throw new UserError('حدد تاريخ انتهاء الاشتراك.');
  const disabled = req.body.disabled !== undefined ? (req.body.disabled ? 1 : 0) : u.disabled;
  if (u.id === req.user.id && disabled) throw new UserError('لا يمكنك إيقاف حسابك أنت.');
  db.prepare('UPDATE users SET plan=?, plan_expires=?, disabled=? WHERE id=?').run(plan, expires, disabled, u.id);
  if (disabled) db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  res.json({ ok: true });
}));

router.get('/apps', (req, res) => {
  const rows = db.prepare(`SELECT a.id,a.name,a.package,a.source,a.status,a.created_at,u.email
      FROM apps a JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 300`).all();
  res.json({ apps: rows.map((a) => ({ id: a.id, name: a.name, package: a.package, source: a.source, status: a.status, createdAt: a.created_at, owner: a.email })) });
});

// إيقاف التطبيق فوراً: يظهر للمستخدمين رسالة انتهاء الاشتراك
router.post('/apps/:id', wrap(async (req, res) => {
  const status = req.body.status === 'suspended' ? 'suspended' : 'active';
  const r = db.prepare('UPDATE apps SET status=? WHERE id=?').run(status, String(req.params.id));
  if (!r.changes) throw new UserError('التطبيق غير موجود.', 404);
  res.json({ ok: true });
}));

router.delete('/apps/:id', wrap(async (req, res) => {
  removeAppFiles(String(req.params.id));
  db.prepare('DELETE FROM apps WHERE id=?').run(String(req.params.id));
  res.json({ ok: true });
}));

router.get('/builds', (req, res) => {
  const st = ['queued', 'building', 'ready', 'failed'].includes(req.query.status) ? req.query.status : null;
  const rows = db.prepare(`SELECT b.id,b.app_id,b.format,b.status,b.error,b.created_at,b.finished_at,a.name AS app_name,substr(b.log,-4000) AS log
      FROM builds b JOIN apps a ON a.id=b.app_id ${st ? 'WHERE b.status=?' : ''} ORDER BY b.id DESC LIMIT 100`).all(...(st ? [st] : []));
  res.json({ builds: rows.map((b) => ({ id: b.id, appId: b.app_id, appName: b.app_name, format: b.format, status: b.status, error: b.error, createdAt: b.created_at, finishedAt: b.finished_at, log: b.log })) });
});

router.post('/builds/:id/retry', wrap(async (req, res) => {
  const b = db.prepare('SELECT * FROM builds WHERE id=?').get(+req.params.id || 0);
  if (!b) throw new UserError('عملية البناء غير موجودة.', 404);
  if (b.status !== 'failed') throw new UserError('يمكن إعادة المحاولة للعمليات الفاشلة فقط.');
  db.prepare("UPDATE builds SET status='queued', error=NULL, log='', finished_at=NULL WHERE id=?").run(b.id);
  res.json({ ok: true });
}));

module.exports = { router };
