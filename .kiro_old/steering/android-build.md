---
inclusion: manual
---

# 安卓 APK 打包指南（Capacitor）

本项目使用 Capacitor 将 H5 游戏（示例 `sanguo_zhangjiao`）打包为 Android APK。

## 一、环境前提

| 项目 | 要求 | 本机实际 |
|------|------|----------|
| JDK | 17 | `E:\Program Files\Java\jdk-17.0.4`（JAVA_HOME 已设置） |
| Android SDK | cmdline-tools + platform-tools + platforms;android-34 + build-tools;34.0.0 | `H:\Android\Sdk` |
| Node / npm | 已安装 | npm 10.8.2 |
| Capacitor | 6.x | core / cli / android 已装 |

### Android SDK 目录结构（关键）
```
H:\Android\Sdk\
├── cmdline-tools\latest\bin\sdkmanager.bat   ← 注意必须有 latest 这层版本目录
├── platform-tools\
├── platforms\android-34\
└── build-tools\34.0.0\
```

> 解压 cmdline-tools 时务必用 Windows 自带解压或「只解一层」，
> 不要用会递归解包的工具（7-Zip/Bandizip 的「解压到」会把 jar 也解开），
> 否则 `lib\sdklib.jar` 会变成 `lib\sdklib\` 目录，导致
> `ClassNotFoundException: SdkManagerCli`。
> 验证正确：`dir H:\Android\Sdk\cmdline-tools\latest\lib\sdklib.jar` 能找到该文件。

## 二、关键配置文件

### capacitor.config.json（项目根目录）
```json
{
  "appId": "com.sanguo.zhangjiao",
  "appName": "三国张角传",
  "webDir": "dist/sanguo_zhangjiao",
  "server": { "androidScheme": "https" }
}
```
- `webDir` 必须指向 vite 实际产物目录 `dist/sanguo_zhangjiao`（不是 `dist`）。

### android/local.properties（Gradle 定位 SDK）
```
sdk.dir=H:\\Android\\Sdk
```

## 三、构建步骤

### 1. 构建 Web 产物
```cmd
npm run build
```
产物输出到 `dist/sanguo_zhangjiao/`。

### 2. 同步到 Android 工程
每次改了 web 产物或 Capacitor 配置后执行：
```cmd
npx cap sync android
```
（首次生成 android 工程用 `npx cap add android`，只需一次。）

### 3. 构建 Debug APK
在 `android` 目录下执行（临时注入环境变量，避免依赖全局设置）：
```cmd
cd android
set ANDROID_HOME=H:\Android\Sdk
set ANDROID_SDK_ROOT=H:\Android\Sdk
gradlew.bat assembleDebug --no-daemon
```

### 4. 产物位置
```
android\app\build\outputs\apk\debug\app-debug.apk
```

## 四、常见问题排查

- **命令在终端 Exit Code 一直为 -1 / 回显错乱**：是终端会话回显问题，命令本身可能已执行成功。用 `cmd /c "dir ..."` 单条核验真实落盘结果，不要轻信回显。
- **解压后目标目录为空**：检查源 zip 文件头是否为 `PK`（`50 4B`），并改用 Windows 自带解压重试。
- **`Could not determine SDK root`**：cmdline-tools 缺少 `latest` 版本层目录。
- **`ClassNotFoundException: SdkManagerCli`**：lib 下的 jar 被错误递归解包成了目录，需重新正确解压。
- **Gradle 找不到 SDK**：检查 `android/local.properties` 的 `sdk.dir`，或设置 `ANDROID_HOME` 环境变量。

## 五、发布版（Release APK，需签名与版本确认）

```cmd
cd android
gradlew.bat assembleRelease --no-daemon
```

- 根 `android/app/build.gradle` 当前只有 `versionCode 1`、`versionName "1.0"`，尚未建立经用户确认的发布版本语义；准备对外发布前必须先确认版本号，不能由工具自行猜测。
- Release signing 当前未配置。keystore、alias 和密码属于发布秘密，不得写入仓库，也不得用 debug key 冒充正式签名；应通过本机 Gradle properties 或 CI secret 注入，确认密钥方案后再接线。
- 未配置正式签名与版本策略前只能视为开发工程，不能标记为 Release Candidate。

## 六、移动端 UI 适配（sanguo_zhangjiao）

本节记录把 demo 适配安卓触屏的设计与改动点，方便后续维护。

### 移动端布局判定
`scenes/BaseGameScene.js` 构造函数里有 `this.isMobileLayout`：
```js
this.isMobileLayout = (typeof window !== 'undefined') &&
  (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
```
据此切换桌面/移动端 UI。

### 改动清单
1. **左下角虚拟摇杆**（替代原四向 D-pad）
   - HTML：`index.html` 的 `#touch-controls` 内 `#joystick-zone` + `#joystick-canvas`（透明圆形热区）。
   - 逻辑：`index.html` 的 `setupVirtualJoystick(pressKey, releaseKey, dirKey)`。
   - 原理：手指按下处作为摇杆中心，按手指方向绘制 90° 扇形圆周 + 圆周上方向小箭头；
     方向换算为 8 向，派发 `ArrowUp/Down/Left/Right` 键盘事件，**复用 InputManager / MovementSystem**，不改移动逻辑。
   - 死区 `DEAD_ZONE=18`，圆周半径 `RADIUS=70`，用 `requestAnimationFrame` 持续重绘。

2. **提示框字号缩小**
   - `index.html` CSS：`#tutorial-panel`/`#tips-panel` 的 `h3` 20→16px、`p` 18→14px、`.key` 18→14px。

3. **下方红球/蓝球/数字快捷键移动端隐藏 + 左上角新增玩家 HUD**
   - `src/ui/BottomControlBar.js` 新增 `showOrbs` / `showHotkeyNumbers` 选项（默认 true），
     render 时按开关跳过血球/蓝球和技能槽数字。移动端创建时传 `false`。
   - 新增框架组件 `src/ui/PlayerStatusHUD.js`：左上角头像 + 昵称 + 血条 + 蓝条，
     **复用已有 `HealthBar` / `ManaBar` 组件**。头像取 `SelectedCharacterStore` 的 `previewImage`。
   - 在 `BaseGameScene.js` 的 `initializeUIPanels()` 创建 `this.playerStatusHUD`（`visible: this.isMobileLayout`），
     并在 `createPlayerEntity`/`bindUIPanelsToPlayer` 调 `setPlayer`，在 `update`/`render` 中调用。

4. **去掉左上角 FPS 框**
   - `index.html` CSS：`#debug-panel` 增加 `display: none;`。

### 维护要点
- 新增的移动端 UI 都是引擎内可复用组件（PlayerStatusHUD）或现有组件加开关（BottomControlBar），
  符合"优先复用/补充到框架"的约定。
- 桌面版不受影响：`isMobileLayout` 为 false 时维持原样（显示血球、数字、FPS 走原逻辑）。

## 七、修改手机版本的工作流（重点：开发调试不需要每次打包）

> **修改手机版（UI/逻辑）时，绝大多数情况不需要重新打 APK。**

APK 里的 WebView 加载的是打包进去的静态 web 产物，但日常开发改的是 H5 代码。
调试有两种高效方式，都**不用走 3 分钟的 Gradle 打包**：

### 方式 A：浏览器 / Vite Dev Server 调试（最快，首选）
直接在桌面浏览器调试 H5，移动端布局可用 Chrome DevTools 设备模拟：
```cmd
npx vite --config example/sanguo_zhangjiao/vite.config.js
```
- 打开 DevTools → 切换设备模拟（触屏）即可触发 `isMobileLayout`，验证摇杆、HUD 等。
- 改代码热更新，无需打包。

### 方式 B：只重建 web 产物 + 同步（验证 WebView 内表现，仍不必每次出 APK）
```cmd
npx vite build --config example/sanguo_zhangjiao/vite.config.js
npx cap sync android
```
- 这一步把最新产物同步进 `android/app/src/main/assets/public`。
- 若设备已装过 APK 且用 live-reload/远程调试，可即时看到效果。

### 只有这些情况才需要重新打 APK（assembleDebug）
- 需要产出可分发/安装的安装包给别人测试时。
- 改了原生层：Capacitor 插件、`capacitor.config.json`、Android 权限、图标、包名等。
- 纯 H5 的 UI/逻辑改动**不在此列**，用方式 A/B 即可。

### 构建 demo web 产物的正确命令（易错点）
demo 有**独立 vite 配置**，根目录 `npm run build` 只会构建落地页，不会生成 `dist/sanguo_zhangjiao`：
```cmd
npx vite build --config example/sanguo_zhangjiao/vite.config.js
```
该配置 `emptyOutDir: true` 会清空并重建 `dist/sanguo_zhangjiao`，并自动拷贝 `assets`、`data`。

## 八、横屏策略（原生发布锁定，Web 保留兼容 fallback）

根 Android 工程是发布权威，`android/app/src/main/AndroidManifest.xml` 的 `MainActivity` 固定配置：
```xml
android:screenOrientation="landscape"
```
因此 Android 安装包由原生层锁定横屏；不得再把发布策略描述为“不锁方向、始终依赖 CSS 旋转”。

`example/sanguo_zhangjiao/index.html` 仍保留 `force-landscape`、`applyForceLandscape()` 与指针坐标变换，供普通移动浏览器、设备模拟和未受原生方向约束的宿主兼容。原生 WebView 已处于横屏时 `innerWidth >= innerHeight`，该 fallback 不会添加 `force-landscape`，页面保持正常坐标系。

### 维护要点
- Android 发布方向只修改根 `android/app/src/main/AndroidManifest.xml`；legacy mobile 工程不参与发布。
- 浏览器 CSS 旋转存在时必须继续复用 `InputManager.setPointerTransform()`，保证点击、触摸、虚拟摇杆与 Canvas 逻辑坐标一致。
- 若未来产品决策改为支持原生自由旋转，必须同时修改 Manifest、CSS fallback、指针映射和浏览器/真机验收，不能只改其中一处。

## 九、网页版 / 安卓版 UI 与文案分离架构（方案 B + 文案 B2）

网页版与安卓版是同一套游戏功能，但操作方式不同（键鼠 vs 触屏）。
为方便分别维护，UI 装配与提示文案按平台拆成两套，平台差异收敛到统一判定中心。

### 1. 平台判定中心（框架级）
`src/core/PlatformProfile.js`
- 统一判定平台：`PlatformProfile.platform`（'desktop' | 'mobile'）、`.isMobile` / `.isDesktop`。
- 判定依据：`ontouchstart` / `navigator.maxTouchPoints`。
- 支持 URL 覆盖调试：`index.html?platform=mobile` 或 `?platform=desktop`。
- `set(p)` / `redetect()` 供测试或环境变化时使用。
- **所有"按平台分两套"的逻辑都以此为唯一依据**，不要再各处写 ontouchstart 判断。

### 2. UI 装配策略（框架级，方案 B）
`src/ui/strategies/`
- `UIStrategy.js`：基类，定义平台差异接口：
  - `getBottomControlBarOptions()` → `{ showOrbs, showHotkeyNumbers }`
  - `isPlayerStatusHUDVisible()`、`isBottomControlBarVisible()`
  - `layoutPlayerStatusHUD(hud, w, h)`
- `DesktopUIStrategy.js`：显示底部血球/蓝球 + 数字快捷键，不显示左上 HUD。
- `MobileUIStrategy.js`：隐藏底部血球/数字键，显示左上角玩家 HUD。
- `index.js`：`createUIStrategy(platform?)` 工厂（不传按 PlatformProfile 自动判定）。

接入点：`example/sanguo_zhangjiao/scenes/BaseGameScene.js`
- 构造函数：`this.uiStrategy = createUIStrategy()`；`this.isMobileLayout` 保留为兼容字段。
- `initializeUIPanels()`：BottomControlBar 的 showOrbs/showHotkeyNumbers、
  PlayerStatusHUD 的 visible 都改由 `this.uiStrategy.*` 决定，**不再写 if (isMobileLayout)**。
- `onResize()`：调用 `this.uiStrategy.layoutPlayerStatusHUD(...)` 处理 HUD 布局。

新增平台（如平板）：加一个策略类 + 在 createUIStrategy 里分支即可，场景代码不动。

### 3. 提示/教程文案双文件（方案 B2）
每个配置拆成 `.desktop.js`（键盘措辞）和 `.mobile.js`（屏幕按钮措辞）两份，
原文件名作为**平台选择器**按 PlatformProfile re-export，下游 import 不变。

- 渐进式提示：
  - `config/ProgressiveTipsConfig.desktop.js`（W/A/S/D、E、B、V、N…）
  - `config/ProgressiveTipsConfig.mobile.js`（摇杆、【交互】、【背包】、【装备】、【前进】…）
  - `config/ProgressiveTipsConfig.js`（选择器，保留 getPrerequisites 等辅助函数）
- 基础教程：
  - `config/TutorialConfig.desktop.js` / `.mobile.js` / `TutorialConfig.js`（选择器）

**约束**：两套文案的 id / priority / triggerConditionId / prerequisites / nextTip
必须完全一致，**仅 text（必要时 description）按操作方式改写**。

### 4. 移除运行时文案替换
`example/sanguo_zhangjiao/index.html`
- 原 `localizeHintKeys` + `TOUCH_KEY_LABELS` 的"显示时正则把键盘键改写成屏幕按钮"逻辑已删除。
- `localizeHintKeys` 现为透传函数（保留作兼容入口）。文案正确性改由配置层（双文件）保证。

### 维护要点（重要）
- 改某平台**文案**：只编辑对应 `.desktop.js` 或 `.mobile.js`，互不影响。
- 改某平台**UI 行为**：编辑对应策略类（Desktop/MobileUIStrategy），场景代码不动。
- 改了 demo 后**纯 H5 改动不需重新打 APK**（见第七节），用 Vite Dev Server + `?platform=mobile` 调试移动端表现最快。
- 新增提示/教程条目时，记得**两套文案文件都要加**，且 id 等结构字段保持一致。
