const express = require('express');
const db = require('./db');
const cfg = require('./config');
const { effectivePlan } = require('./plans');
const { limiter } = require('./auth');

// هل التطبيق مسموح له بالعمل الآن؟
function licenseInfo(appId) {
  const r = db.prepare(`SELECT a.status AS app_status, u.id AS uid, u.disabled, u.plan, u.plan_expires, u.role
                        FROM apps a JOIN users u ON u.id = a.user_id WHERE a.id = ?`).get(appId);
  if (!r) return { active: false, reason: 'not_found' };
  if (r.app_status !== 'active') return { active: false, reason: 'suspended' };
  if (r.disabled) return { active: false, reason: 'account_disabled' };
  if (effectivePlan(r) === 'expired') return { active: false, reason: 'subscription_expired' };
  return { active: true, reason: 'ok' };
}

const router = express.Router();
// التطبيق يسأل هذا العنوان عند كل فتح
router.get('/license/:appId', limiter(120, 60 * 1000), (req, res) => {
  const info = licenseInfo(String(req.params.appId).slice(0, 64));
  res.set('Cache-Control', 'no-store');
  res.json({ active: info.active, reason: info.reason, graceDays: cfg.GRACE_DAYS });
});

module.exports = { router, licenseInfo };
