// يجهّز Gradle Wrapper داخل قالب أندرويد (مرة واحدة): npm run setup
// 1) يستعمل gradle المثبّت عندك إن وُجد، وإلا ينزّله تلقائياً من gradle.org
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');
const AdmZip = require('adm-zip');
const cfg = require('../server/config');

const isWin = process.platform === 'win32';
const T = path.join(cfg.ROOT, 'android-template');
const jar = path.join(T, 'gradle', 'wrapper', 'gradle-wrapper.jar');

function has(cmd, args) {
  const r = spawnSync(cmd, args, { shell: isWin, encoding: 'utf8' });
  return r.status === 0;
}

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ghilaf-setup' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).href, dest, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const total = +res.headers['content-length'] || 0;
      let got = 0, last = 0;
      const f = fs.createWriteStream(dest);
      res.on('data', (d) => {
        got += d.length;
        if (total && Date.now() - last > 1500) { last = Date.now(); process.stdout.write(`\r  ${(got / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB`); }
      });
      res.pipe(f);
      f.on('finish', () => f.close(() => { process.stdout.write('\n'); resolve(); }));
      f.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  if (fs.existsSync(jar)) { console.log('✓ Gradle Wrapper جاهز من قبل.'); return; }
  if (!has('java', ['-version'])) {
    console.error('✗ لم يُعثر على Java. ثبّت JDK 17 أو أحدث ثم أعد المحاولة (راجع README).');
    process.exit(1);
  }

  let gradle = null;
  if (has('gradle', ['-v'])) {
    gradle = 'gradle';
    console.log('استعمال gradle المثبّت على جهازك.');
  } else {
    const dir = path.join(cfg.DATA_DIR, 'tools');
    const home = path.join(dir, `gradle-${cfg.GRADLE_VERSION}`);
    const bin = path.join(home, 'bin', isWin ? 'gradle.bat' : 'gradle');
    if (!fs.existsSync(bin)) {
      fs.mkdirSync(dir, { recursive: true });
      const zip = path.join(dir, `gradle-${cfg.GRADLE_VERSION}-bin.zip`);
      console.log(`تنزيل Gradle ${cfg.GRADLE_VERSION} (نحو 130 ميغابايت، مرة واحدة)...`);
      await download(`https://services.gradle.org/distributions/gradle-${cfg.GRADLE_VERSION}-bin.zip`, zip);
      console.log('فك الضغط...');
      new AdmZip(zip).extractAllTo(dir, true);
      fs.rmSync(zip, { force: true });
      if (!isWin) fs.chmodSync(bin, 0o755);
    }
    gradle = bin;
  }

  // نولّد الـ wrapper في مجلد مؤقت فارغ حتى لا نحتاج تنزيل مكتبات أندرويد الآن
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghilaf-wrapper-'));
  fs.writeFileSync(path.join(tmp, 'settings.gradle'), "rootProject.name = 'wrapper-gen'\n");
  console.log(`توليد Gradle Wrapper (${cfg.GRADLE_VERSION})...`);
  // نمرّر رابط التوزيعة صراحة ونعطّل فحص الرابط، فلا يحتاج الأمر اتصالاً بالإنترنت الآن
  const r = spawnSync(gradle, ['wrapper', '--gradle-distribution-url', `https://services.gradle.org/distributions/gradle-${cfg.GRADLE_VERSION}-bin.zip`, '--no-validate-url', '--no-daemon', '--console=plain'],
    { cwd: tmp, shell: isWin, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    console.error('✗ فشل توليد Gradle Wrapper.');
    process.exit(1);
  }
  fs.mkdirSync(path.join(T, 'gradle', 'wrapper'), { recursive: true });
  for (const f of ['gradlew', 'gradlew.bat']) fs.copyFileSync(path.join(tmp, f), path.join(T, f));
  for (const f of fs.readdirSync(path.join(tmp, 'gradle', 'wrapper'))) {
    fs.copyFileSync(path.join(tmp, 'gradle', 'wrapper', f), path.join(T, 'gradle', 'wrapper', f));
  }
  if (!isWin) fs.chmodSync(path.join(T, 'gradlew'), 0o755);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('✓ تم. أول بناء حقيقي سينزّل Gradle ومكتبات أندرويد (بضع مئات من الميغابايت، مرة واحدة).');
})().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
