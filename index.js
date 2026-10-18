const express = require('express');
const path = require('path');
const multer = require('multer');
const cfg = require('./config');
const db = require('./db');
const auth = require('./auth');
const license = require('./license');
const apps = require('./routes-apps');
const admin = require('./routes-admin');
const worker = require('./worker');
const { UserError } = require('./util');
const { PLANS } = require('./plans');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', cfg.PUBLIC_URL.startsWith('https') ? 1 : false);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  next();
});

app.use(express.json({ limit: '100kb' }));
app.use(auth.loadUser);
app.use('/api', auth.originCheck);

app.use('/api/auth', auth.router);
app.get('/api/config', (req, res) => res.json({
  supportEmail: cfg.SUPPORT_EMAIL, payInstructions: cfg.PAY_INSTRUCTIONS, sitesUrl: cfg.SITES_URL,
  plans: Object.fromEntries(Object.entries(PLANS).filter(([k]) => k !== 'expired')),
}));
app.use('/api', license.router);
app.use('/api/admin', auth.requireAuth, auth.requireAdmin, admin.router);
app.use('/api', auth.requireAuth, apps.router);
app.use('/api', (req, res) => res.status(404).json({ error: 'غير موجود.' }));

app.use(express.static(path.join(cfg.ROOT, 'public'), { extensions: ['html'], dotfiles: 'ignore' }));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof UserError) return res.status(err.status).json({ error: err.message });
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'الملف أكبر من 50 ميغابايت.' : 'تعذّر رفع الملف.' });
  }
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'طلب غير صالح.' });
  console.error(err);
  res.status(500).json({ error: 'حدث خطأ في الخادم. حاول مرة أخرى.' });
});

// خادم منفصل لملفات المواقع المرفوعة (أصل مختلف عن لوحة التحكم لعزل الأمان)
const sites = express();
sites.disable('x-powered-by');
sites.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
sites.use('/:appId', (req, res, next) => {
  const id = req.params.appId;
  if (!UUID.test(id)) return res.status(404).end();
  if (!license.licenseInfo(id).active) {
    return res.status(403).type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body dir="rtl" style="font-family:sans-serif;text-align:center;padding:4rem 1rem"><h2>حدث خطأ</h2><p>يرجى التواصل مع المطوّر أو تجديد الاشتراك.</p>');
  }
  express.static(path.join(cfg.DATA_DIR, 'sites', id), { dotfiles: 'ignore', index: 'index.html' })(req, res, next);
});

app.listen(cfg.PORT, () => {
  console.log(`\nغلاف يعمل:  ${cfg.PUBLIC_URL}   (منفذ ${cfg.PORT})`);
  console.log(`استضافة ملفات المواقع: ${cfg.SITES_URL}   (منفذ ${cfg.SITES_PORT})`);
  if (!cfg.ADMIN_EMAIL) console.log('تنبيه: لم تحدد ADMIN_EMAIL في .env، لن يكون هناك مدير. أو شغّل: npm run make-admin -- بريدك');
  if (cfg.BUILD_DRY_RUN) console.log('تنبيه: وضع الاختبار BUILD_DRY_RUN=1 مفعّل. لن تُنتج تطبيقات حقيقية.');
  console.log('شغّل "npm run check" للتحقق من جاهزية أدوات البناء.\n');
});
sites.listen(cfg.SITES_PORT);
worker.start();
