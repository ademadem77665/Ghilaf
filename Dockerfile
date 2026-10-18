# بيئة جاهزة للبناء الحقيقي على سيرفر (VPS): JDK 17 + Android SDK + Node 22
FROM eclipse-temurin:17-jdk-jammy

ENV DEBIAN_FRONTEND=noninteractive \
    ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    TARGET_SDK=36

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates unzip git \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

# أدوات سطر أوامر أندرويد (إن تغيّر رقم الإصدار في الرابط فخذ الأحدث من developer.android.com/studio#command-line-tools-only)
RUN mkdir -p $ANDROID_HOME/cmdline-tools && cd /tmp \
    && curl -fsSL -o tools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
    && unzip -q tools.zip -d $ANDROID_HOME/cmdline-tools && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
    && rm tools.zip \
    && yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses > /dev/null \
    && $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platform-tools" "platforms;android-${TARGET_SDK}" "build-tools;${TARGET_SDK}.0.0"

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
RUN npm run setup   # يجهّز Gradle Wrapper داخل قالب أندرويد

# تشغيل بمستخدم عادي وليس root
RUN useradd -m ghilaf && mkdir -p /app/data /home/ghilaf/.gradle && chown -R ghilaf:ghilaf /app /opt/android-sdk /home/ghilaf
USER ghilaf

EXPOSE 3000 3001
CMD ["node", "server/index.js"]
