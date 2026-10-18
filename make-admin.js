// يجعل حساباً موجوداً مديراً: npm run make-admin -- you@example.com
const db = require('../server/db');
const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) { console.error('الاستعمال: npm run make-admin -- you@example.com'); process.exit(1); }
const r = db.prepare("UPDATE users SET role='admin' WHERE email=?").run(email);
if (!r.changes) { console.error('لا يوجد حساب بهذا البريد. سجّل في الموقع أولاً ثم أعد المحاولة.'); process.exit(1); }
console.log('تم. هذا الحساب أصبح مديراً: ' + email);
