const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
const db = new Database(path.join(cfg.DATA_DIR, 'ghilaf.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  plan TEXT NOT NULL DEFAULT 'free',
  plan_expires INTEGER,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS apps(
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  package TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT,
  color TEXT NOT NULL,
  contact TEXT,
  has_icon INTEGER NOT NULL DEFAULT 0,
  version_code INTEGER NOT NULL DEFAULT 0,
  version_name TEXT NOT NULL DEFAULT '1.0',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_apps_package ON apps(package);
CREATE INDEX IF NOT EXISTS idx_apps_user ON apps(user_id);
CREATE TABLE IF NOT EXISTS builds(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  format TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  version_code INTEGER NOT NULL,
  version_name TEXT NOT NULL,
  log TEXT NOT NULL DEFAULT '',
  error TEXT,
  key_pass TEXT,
  has_apk INTEGER NOT NULL DEFAULT 0,
  has_aab INTEGER NOT NULL DEFAULT 0,
  has_key INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_builds_status ON builds(status);
CREATE INDEX IF NOT EXISTS idx_builds_app ON builds(app_id);
`);

// ترقية قواعد بيانات أُنشئت قبل إضافة مفتاح التوقيع لكل تطبيق
if (!db.prepare('PRAGMA table_info(apps)').all().some((c) => c.name === 'key_pass')) db.exec('ALTER TABLE apps ADD COLUMN key_pass TEXT');

module.exports = db;
