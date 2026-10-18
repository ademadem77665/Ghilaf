const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const cfg = require('./config');
const { UserError, V } = require('./util');
const { PLANS, effectivePlan, limitsFor, monthStart } = require('./plans');

const COOKIE = 'gh_sid';
const DAY = 86400000;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const secure = cfg.PUBLIC_URL.startsWith('https') ? '; Secure' : '';

function parseCookies(h) {
  const o = {};
  (h || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) { try { o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* تجاهل */ } }
  });
  return o;
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires) VALUES(?,?,?)').run(sha(token), userId, Date.now() + 30 * DAY);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 86400}${secure}`);
}

function clearSession(req, res) {
  const t = parseCookies(req.headers.cookie)[COOKIE];
  if (t) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(t));
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

function loadUser(req, res, next) {
  req.user = null;
  const t = parseCookies(req.headers.cookie)[COOKIE];
  if (t) {
    const r = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?').get(sha(t), Date.now());
    if (r && !r.disabled) req.user = r;
  }
  next();
}

const requireAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'سجّل الدخول أولاً.' }));
const requireAdmin = (req, res, next) => (req.user && req.user.role === 'admin' ? next() : res.status(403).json({ error: 'غير مسموح.' }));

// حماية CSRF: الطلبات التي تغيّر البيانات يجب أن تأتي من نفس الموقع
function originCheck(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const o = req.headers.origin;
  if (o && o !== new URL(cfg.PUBLIC_URL).origin && o !== `${req.protocol}://${req.headers.host}`) {
    return res.status(403).json({ error: 'طلب مرفوض.' });
  }
  next();
}

function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => { const n = Date.now(); for (const [k, a] of hits) { const f = a.filter((t) => n - t < windowMs); f.length ? hits.set(k, f) : hits.delete(k); } }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const a = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    if (a.length >= max) return res.status(429).json({ error: 'محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.' });
    a.push(now);
    hits.set(req.ip, a);
    next();
  };
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function meDto(u) {
  const eff = effectivePlan(u);
  const lim = PLANS[eff];
  const apps = db.prepare('SELECT COUNT(*) c FROM apps WHERE user_id=?').get(u.id).c;
  const builds = db.prepare("SELECT COUNT(*) c FROM builds WHERE user_id=? AND created_at>=? AND status!='failed'").get(u.id, monthStart()).c;
  return {
    id: u.id, name: u.name, email: u.email, role: u.role,
    plan: u.plan, planLabel: (PLANS[u.plan] || PLANS.free).label, planExpires: u.plan_expires,
    effectivePlan: eff, limits: lim, usage: { apps, builds },
  };
}

const router = express.Router();
const authLimiter = limiter(20, 10 * 60 * 1000);

router.post('/register', authLimiter, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (name.length < 1 || name.length > 60) throw new UserError('أدخل اسمك (حتى 60 حرفاً).');
  const email = V.email(req.body.email);
  const pass = String(req.body.password || '');
  if (pass.length < 8 || pass.length > 128) throw new UserError('كلمة المرور من 8 إلى 128 حرفاً.');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new UserError('هذا البريد مسجّل من قبل. سجّل الدخول.', 409);
  const role = cfg.ADMIN_EMAIL && email === cfg.ADMIN_EMAIL ? 'admin' : 'user';
  const hash = await bcrypt.hash(pass, 10);
  const id = db.prepare('INSERT INTO users(email,name,pass_hash,role,created_at) VALUES(?,?,?,?,?)').run(email, name, hash, role, Date.now()).lastInsertRowid;
  createSession(res, id);
  res.json({ user: meDto(db.prepare('SELECT * FROM users WHERE id=?').get(id)) });
}));

router.post('/login', authLimiter, wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const ok = u && !u.disabled && (await bcrypt.compare(String(req.body.password || ''), u.pass_hash));
  if (!ok) throw new UserError('البريد أو كلمة المرور غير صحيحة.', 401);
  createSession(res, u.id);
  res.json({ user: meDto(u) });
}));

router.post('/logout', (req, res) => { clearSession(req, res); res.json({ ok: true }); });

router.get('/me', (req, res) => res.json({ user: req.user ? meDto(req.user) : null }));

module.exports = { router, loadUser, requireAuth, requireAdmin, originCheck, limiter, wrap, meDto, limitsFor };
