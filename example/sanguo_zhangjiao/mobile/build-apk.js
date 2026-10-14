// 调用 Android 工程的 gradlew 构建 debug APK，并拷贝到 release/ 目录
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const androidDir = path.resolve(__dirname, 'android');
const releaseDir = path.resolve(__dirname, 'release');

if (!fs.existsSync(androidDir)) {
  console.error('[build-apk] 未找到 android/ 工程，请先运行: npx cap add android');
  process.exit(1);
}

const isWin = process.platform === 'win32';
const gradlew = isWin ? 'gradlew.bat' : './gradlew';

console.log('[build-apk] 开始构建 debug APK ...');
try {
  execSync(`${gradlew} assembleDebug`, {
    cwd: androidDir,
    stdio: 'inherit'
  });
} catch (e) {
  console.error('[build-apk] gradlew 构建失败。请确认已安装 Android SDK 且设置了 ANDROID_HOME。');
  process.exit(1);
}

// 拷贝产物
const apkSrc = path.resolve(
  androidDir,
  'app/build/outputs/apk/debug/app-debug.apk'
);
if (!fs.existsSync(apkSrc)) {
  console.error(`[build-apk] 未找到 APK 产物: ${apkSrc}`);
  process.exit(1);
}

fs.mkdirSync(releaseDir, { recursive: true });
const apkDest = path.resolve(releaseDir, 'ZhangjiaoUprising.apk');
fs.copyFileSync(apkSrc, apkDest);

console.log(`[build-apk] 构建完成，APK 输出: ${apkDest}`);
