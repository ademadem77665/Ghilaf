const fs = require('fs');
const path = require('path');
const db = require('./db');
const cfg = require('./config');
const { buildApp } = require('../builder/build');

let running = 0;
const CONCURRENCY = 1; // Gradle ثقيل على الذاكرة؛ ارفع الرقم فقط إن كان السيرفر قوياً

async function runBuild(b) {
  running++;
  const app = db.prepare('SELECT * FROM apps WHERE id=?').get(b.app_id);
  if (!app) { db.prepare("UPDATE builds SET status='failed', error=?, finished_at=? WHERE id=?").run('التطبيق محذوف.', Date.now(), b.id); running--; return; }
  db.prepare("UPDATE builds SET status='building', log='' WHERE id=?").run(b.id);
  let log = '';
  let lastFlush = 0;
  const flush = (force) => {
    if (force || Date.now() - lastFlush > 2000) {
      lastFlush = Date.now();
      db.prepare('UPDATE builds SET log=? WHERE id=?').run(log.slice(-200000), b.id);
    }
  };
  const onLog = (s) => { log += s.endsWith('\n') ? s : s + '\n'; flush(false); };
  try {
    const r = await buildApp({ app, build: b, onLog });
    flush(true);
    if (r.newKey) db.prepare('UPDATE apps SET key_pass=? WHERE id=?').run(r.keyPass, app.id);
    db.prepare("UPDATE builds SET status='ready', error=NULL, key_pass=?, has_apk=?, has_aab=?, has_key=1, finished_at=? WHERE id=?")
      .run(r.keyPass, r.apk ? 1 : 0, r.aab ? 1 : 0, Date.now(), b.id);
  } catch (err) {
    onLog('خطأ: ' + (err && err.message));
    flush(true);
    db.prepare("UPDATE builds SET status='failed', error=?, finished_at=? WHERE id=?")
      .run((err && err.userMessage) || (err && err.message) || 'فشل البناء.', Date.now(), b.id);
  } finally {
    running--;
  }
}

function tick() {
  if (running >= CONCURRENCY) return;
  // الأقدم أولاً. (لإعطاء أولوية للخطة الاحترافية يمكن ربط الجدول بجدول المستخدمين هنا)
  const b = db.prepare("SELECT * FROM builds WHERE status='queued' ORDER BY id LIMIT 1").get();
  if (b) runBuild(b).catch((e) => console.error('worker error', e));
}

function cleanup() {
  const cutoff = Date.now() - cfg.KEEP_DAYS * 86400000;
  const old = db.prepare("SELECT id FROM builds WHERE status='ready' AND finished_at<? AND (has_apk=1 OR has_aab=1 OR has_key=1)").all(cutoff);
  for (const b of old) {
    fs.rmSync(path.join(cfg.DATA_DIR, 'outputs', String(b.id)), { recursive: true, force: true });
    db.prepare("UPDATE builds SET has_apk=0, has_aab=0, has_key=0, key_pass=NULL, log='' WHERE id=?").run(b.id);
  }
  db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
  if (running === 0) fs.rmSync(path.join(cfg.DATA_DIR, 'work'), { recursive: true, force: true }); // مخلّفات بناء متوقف
}

function start() {
  db.prepare("UPDATE builds SET status='queued' WHERE status='building'").run(); // استئناف ما انقطع بإعادة تشغيل السيرفر
  setInterval(tick, 2000).unref();
  setInterval(cleanup, 6 * 3600 * 1000).unref();
  setTimeout(cleanup, 10000).unref();
}

module.exports = { start };
