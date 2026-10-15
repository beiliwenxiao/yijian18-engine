---
inclusion: manual
---

# H5 游戏打包成 Windows EXE 指南

> **重要：修改功能时，不要管 desktop 内的文件，因为那是打包为 exe 用的。**



## 适用场景
将基于 Vite + 原生 ES Module 的纯前端 Canvas 游戏（如 example/sanguo_zhangjiao）
打包成可直接运行的 Windows .exe 桌面程序。

## 技术选型结论
- 构建：Vite（项目已有）
- 桌面壳：Electron
- 打包工具：@electron/packager（不要用 electron-builder，见下方坑）
- 产物形态：免安装绿色版文件夹（含 exe），整个文件夹拷贝即可运行

## 工程结构（放在 demo 目录下，不污染引擎 src）
- example/sanguo_zhangjiao/vite.config.js        独立构建配置
- example/sanguo_zhangjiao/desktop/main.js       Electron 主进程
- example/sanguo_zhangjiao/desktop/copy-web.js   拷贝 web 产物到 game/
- example/sanguo_zhangjiao/desktop/pack.js       打包脚本
- example/sanguo_zhangjiao/desktop/package.json  依赖与脚本

## 关键技术点（踩坑记录）

### 1. 运行时字符串加载的资源不会被 Vite 自动打包
游戏里 `'assets/images/fire.webp'` 这类字符串路径不是 import 进来的，
Vite 默认不处理。必须在 vite.config.js 用插件在 closeBundle 阶段
把整个 assets 目录手动拷进 dist。

### 2. base 必须设为相对路径
vite.config.js 设 `base: './'`，保证产物在任意目录/本地服务器下都能加载。

### 3. ES Module 在 file:// 下会被 CORS 拦截（核心坑）
Vite 构建后 HTML 用 `<script type="module" crossorigin>`，
Electron 用 loadFile（file:// 协议）加载会失败。
解决：在 Electron 主进程内置一个仅监听 127.0.0.1 的极简静态 HTTP 服务器
（端口设为 0 由系统分配），用 loadURL 加载游戏。
既解决 module/CORS，也让资源相对路径正常工作。

### 4. 不要用 electron-builder（Windows 符号链接权限坑）
electron-builder 在 Windows 打包时会下载并解压 winCodeSign 工具，
其中含 macOS 的 .dylib 符号链接，普通用户无权创建符号链接，
报错 "Cannot create symbolic link : 拒绝访问"，打包失败。
改用 @electron/packager，它不涉及代码签名工具，直接成功。

### 5. 国内网络必须用镜像
直连 GitHub 下载 Electron 二进制会 ECONNRESET。
打包/安装时设置环境变量：
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
（electron-builder 另需 ELECTRON_BUILDER_BINARIES_MIRROR）

### 6. packager 的 overwrite 不可靠 + 排除 node_modules
- packager 的 overwrite=true 不会真正清空旧 release 目录，
  导致旧内容残留、ignore 看似不生效。
  必须在 packager 调用前手动 fs.rmSync 删除输出目录。
- 游戏运行时只需 main.js（Node 内置模块）+ game/ 静态资源，
  不需要任何 node_modules。设 prune:false 并用 ignore 排除 node_modules。

### 7. 默认开启 asar（资源保护的第一道门槛）
pack.js 默认设 `asar: true`，把 main.js 和 game/（含图片等资源）
打进单个 app.asar 归档文件。效果：
- 用户在安装目录 resources/ 下看到的是单个 app.asar，
  无法直接双击打开里面的 png，挡住"随手翻文件夹拷图"。
- 注意：这不是真正的加密。app.asar 可被 @electron/asar 等工具解包还原。
  如需更强保护，可在此基础上叠加"图片 XOR/AES 加密 + 运行时解密"。
- asar 内的文件仍可正常被代码以相对路径读取，游戏逻辑无需改动。

## 关于图片加密的结论
前端（含 Electron）的图片加密本质是"防君子不防小人"：
解密代码与密钥都在客户端，DevTools/内存抓取/逆向 JS 均可还原原图。
能挡住的是直接拷贝文件夹、批量提取资源；挡不住有心人逆向。
保护强度从低到高的可选层次：
1. asar 打包（默认已开，零成本）
2. asar + 图片 XOR（打包时变换字节，运行时解密成 Blob URL 喂给 img.src）
3. asar + AES-GCM（用 Web Crypto，安全性并不比 XOR 实质更高，解密更慢，一般不必）
改造接入点：src/core/AssetManager.js 的 loadImage，
以及散落的 new Image()+img.src 处（如 Scene1Terrain.js、BaseGameScene.js 火焰、DialogueBox 立绘），
需统一走带解密的加载入口。

## 打包命令
```
cd example/sanguo_zhangjiao/desktop
# 国内先设镜像（PowerShell）：
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm run dist
# 等价于：构建 web → 拷贝到 game/ → @electron/packager 打包
```

## 产物位置
example/sanguo_zhangjiao/desktop/release/ZhangjiaoUprising-win32-x64/ZhangjiaoUprising.exe
整个 win32-x64 文件夹为绿色免安装版。

## 已知事项
- exe 体积约 200MB（Electron 内置 Chromium 运行时的固有成本）。
- 当前用默认 Electron 图标，未配置自定义 .ico。
- 如需单文件安装包(Setup.exe)需用 electron-builder 的 nsis，
  并先解决 winCodeSign 权限（开启 Windows 开发者模式）。
