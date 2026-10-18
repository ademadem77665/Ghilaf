#!/usr/bin/env bash
# تجهيز المشروع كاملاً داخل GitHub Codespaces (بلا تثبيت أي شيء على جهازك)
# الاستعمال:  bash scripts/codespace-setup.sh بريدك@example.com
set -e
cd "$(dirname "$0")/.."

ADMIN="$1"
if [ -z "$ADMIN" ]; then echo "اكتب بريدك بعد اسم السكربت، مثال: bash scripts/codespace-setup.sh me@gmail.com"; exit 1; fi

SDK="$HOME/android-sdk"

echo "1/5 فحص Java..."
if ! command -v java >/dev/null 2>&1 || [ "$(java -version 2>&1 | head -1 | sed -E 's/.*"([0-9]+).*/\1/')" -lt 17 ]; then
  sudo apt-get update -y && sudo apt-get install -y openjdk-17-jdk
fi
java -version 2>&1 | head -1

echo "2/5 تنزيل أدوات أندرويد (مرة واحدة)..."
mkdir -p "$SDK/cmdline-tools"
if [ ! -d "$SDK/cmdline-tools/latest" ]; then
  curl -fsSL -o /tmp/cmdtools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  unzip -q /tmp/cmdtools.zip -d "$SDK/cmdline-tools"
  mv "$SDK/cmdline-tools/cmdline-tools" "$SDK/cmdline-tools/latest"
  rm /tmp/cmdtools.zip
fi
yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true
"$SDK/cmdline-tools/latest/bin/sdkmanager" "platform-tools" "platforms;android-36" "build-tools;36.0.0"

echo "3/5 تثبيت مكتبات المشروع..."
npm install --no-audit --no-fund

echo "4/5 كتابة ملف .env..."
[ -f .env ] || cp .env.example .env
setenv() { # يستبدل القيمة إن وُجد المفتاح، وإلا يضيفه
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}
setenv ADMIN_EMAIL "$ADMIN"
setenv ANDROID_HOME "$SDK"
setenv BUILD_DRY_RUN 0
if [ -n "$CODESPACE_NAME" ]; then
  D="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  setenv PUBLIC_URL "https://${CODESPACE_NAME}-3000.${D}"
  setenv SITES_URL "https://${CODESPACE_NAME}-3001.${D}"
  # يجعل المنفذين عامّين ليصل إليهما هاتفك (التطبيق يسأل السيرفر عن الاشتراك)
  gh codespace ports visibility 3000:public 3001:public -c "$CODESPACE_NAME" >/dev/null 2>&1 || \
    echo "تنبيه: اجعل المنفذين 3000 و3001 Public من تبويب PORTS يدوياً."
fi

echo "5/5 فحص الجاهزية..."
npm run check || true
echo
echo "تم. شغّل الآن:  npm start"
