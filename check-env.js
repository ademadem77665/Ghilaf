// يفحص جاهزية جهازك للبناء الحقيقي: npm run check
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const cfg = require('../server/config');

const isWin = process.platform === 'win32';
let bad = 0, warn = 0;
const ok = (m) => console.log('  ✓ ' + m);
const no = (m) => { bad++; console.log('  ✗ ' + m); };
const wn = (m) => { warn++; console.log('  ⚠ ' + m); };

console.log('\nفحص البيئة:\n');

const nodeMajor = +process.versions.node.split('.')[0];
nodeMajor >= 20 ? ok(`Node ${process.versions.node}`) : no(`Node ${process.versions.node} قديم. ثبّت Node 20 أو أحدث.`);

fs.existsSync(path.join(cfg.ROOT, '.env')) ? ok('ملف .env موجود') : no('ملف .env غير موجود. انسخ .env.example إلى .env وعدّله.');
cfg.ADMIN_EMAIL ? ok(`المدير: ${cfg.ADMIN_EMAIL}`) : wn('ADMIN_EMAIL فارغ، لن يكون لديك حساب مدير.');

if (/localhost|127\.0\.0\.1/.test(cfg.PUBLIC_URL)) wn(`PUBLIC_URL=${cfg.PUBLIC_URL}. الهاتف لا يصل إلى localhost، فلن يتحقق التطبيق من الاشتراك. استعمل عنوان حاسوبك في الشبكة أو دومين (راجع README).`);
else ok(`PUBLIC_URL=${cfg.PUBLIC_URL}`);

if (cfg.BUILD_DRY_RUN) {
  wn('BUILD_DRY_RUN=1: وضع الاختبار مفعّل، لن تُنتج تطبيقات حقيقية. تخطّيت فحص أدوات البناء.');
} else {
  console.log('\nأدوات البناء:\n');
  const j = spawnSync('java', ['-version'], { shell: isWin, encoding: 'utf8' });
  if (j.status !== 0) no('Java غير موجود. ثبّت JDK 17 أو أحدث.');
  else {
    const m = /version "(\d+)(?:\.(\d+))?/.exec(j.stderr || j.stdout || '');
    const major = m ? (+m[1] === 1 ? +m[2] : +m[1]) : 0;
    major >= 17 ? ok(`Java ${major}`) : no(`Java ${major || '؟'} قديم. المطلوب 17 أو أحدث.`);
  }
  spawnSync('keytool', ['-help'], { shell: isWin }).status === 0 ? ok('keytool') : no('keytool غير موجود (يأتي مع JDK). أضف مجلد bin الخاص بـ JDK إلى PATH.');

  const sdk = cfg.ANDROID_HOME;
  if (!sdk) no('ANDROID_HOME غير مضبوط في .env.');
  else if (!fs.existsSync(sdk)) no(`مجلد Android SDK غير موجود: ${sdk}`);
  else {
    ok(`Android SDK: ${sdk}`);
    fs.existsSync(path.join(sdk, 'platforms', `android-${cfg.TARGET_SDK}`)) ? ok(`منصة android-${cfg.TARGET_SDK}`) : no(`ينقص: sdkmanager "platforms;android-${cfg.TARGET_SDK}"`);
    const bt = path.join(sdk, 'build-tools');
    fs.existsSync(bt) && fs.readdirSync(bt).length ? ok('build-tools') : no(`ينقص: sdkmanager "build-tools;${cfg.TARGET_SDK}.0.0"`);
    fs.existsSync(path.join(sdk, 'licenses', 'android-sdk-license')) ? ok('تراخيص SDK مقبولة') : no('لم تُقبل التراخيص. شغّل: sdkmanager --licenses');
  }
  fs.existsSync(path.join(cfg.ROOT, 'android-template', 'gradle', 'wrapper', 'gradle-wrapper.jar')) ? ok('Gradle Wrapper') : no('Gradle غير مجهّز. شغّل: npm run setup');
}

console.log(`\n${bad ? `✗ ${bad} مشكلة تمنع البناء الحقيقي.` : '✓ كل شيء جاهز.'}${warn ? ` (${warn} تنبيه)` : ''}\n`);
process.exit(bad ? 1 : 0);
