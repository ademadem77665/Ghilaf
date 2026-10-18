const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// قراءة ملف .env بدون مكتبات خارجية
(function loadEnv() {
  const f = path.join(ROOT, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
})();

const e = process.env;
const PORT = +e.PORT || 3000;
const SITES_PORT = +e.SITES_PORT || PORT + 1;
const strip = (s) => String(s).replace(/\/+$/, '');

module.exports = {
  ROOT,
  PORT,
  SITES_PORT,
  PUBLIC_URL: strip(e.PUBLIC_URL || `http://localhost:${PORT}`),
  SITES_URL: strip(e.SITES_URL || `http://localhost:${SITES_PORT}`),
  DATA_DIR: path.resolve(ROOT, e.DATA_DIR || 'data'),
  ADMIN_EMAIL: (e.ADMIN_EMAIL || '').trim().toLowerCase(),
  SUPPORT_EMAIL: e.SUPPORT_EMAIL || 'support@your-domain.com',
  PAY_INSTRUCTIONS: e.PAY_INSTRUCTIONS || 'تواصل معنا لنرسل لك طريقة الدفع (CCP أو بريدي موب).',
  BUILD_DRY_RUN: e.BUILD_DRY_RUN === '1',
  ANDROID_HOME: e.ANDROID_HOME || e.ANDROID_SDK_ROOT || '',
  TARGET_SDK: +e.TARGET_SDK || 36,
  GRADLE_VERSION: e.GRADLE_VERSION || '8.11.1',
  KEEP_DAYS: +e.KEEP_DAYS || 30,
  BUILD_TIMEOUT_MIN: +e.BUILD_TIMEOUT_MIN || 25,
  GRACE_DAYS: +e.GRACE_DAYS || 7,
};
