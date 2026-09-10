---
inclusion: fileMatch
fileMatchPattern: '{**/weapp/**,**/PlatformProfile*,**/BackendConfig*,**/pickBackend*}'
---

# 微信小游戏适配

## 架构

走"适配层"方案：`weapp/adapter/` 在引擎代码加载前注入全局 shim，把小游戏 API 伪装成浏览器全局对象，引擎源码不需要修改。

```
weapp/
├── game.js              ← 小游戏入口
├── game.json            ← 横屏配置
├── project.config.json  ← 微信开发者工具配置（需填 AppID）
├── build.js             ← 一键构建（node weapp/build.js）
├── entry.js             ← Vite 构建入口（自动生成）
├── adapter/             ← 浏览器 API shim
│   ├── index.js         ← 统一注入入口
│   ├── canvas.js        ← createElement('canvas') → wx.createCanvas
│   ├── image.js         ← new Image → wx.createImage
│   ├── audio.js         ← Audio → wx.createInnerAudioContext
│   ├── storage.js       ← localStorage → wx.getStorageSync
│   ├── fetch.js         ← fetch → 本地文件/网络请求
│   ├── event.js         ← 触摸事件转发 + window shim
│   ├── performance.js   ← performance.now 兜底
│   └── misc.js          ← navigator/location/raf/Event 等
├── src/                 ← 构建产物（bundle.js）
└── assets/              ← 构建时复制的静态资源
```

## API 映射表

| 引擎代码 | 适配层转译为 |
|---|---|
| `document.createElement('canvas')` | `wx.createCanvas()` / `wx.createOffscreenCanvas()` |
| `new Image()` | `wx.createImage()` |
| `new Audio()` | `wx.createInnerAudioContext()` |
| `localStorage` | `wx.getStorageSync/setStorageSync` |
| `fetch('file.json')` | `fs.readFileSync(path, 'utf-8')` |
| `fetch('https://...')` | `wx.request()` |
| `canvas.addEventListener('touchstart')` | `wx.onTouchStart()` 转发 |
| `performance.now()` | `wx.getPerformance().now()` |
| `navigator.getGamepads` | 不存在（`isSupported()` 返回 false） |

## 关键约定

- 所有实现都要考虑微信小程序的兼容。
- 小游戏**无 DOM**：`document.getElementById` 返回 null，DOM UI（教程面板、触屏按钮）需迁移到 Canvas 绘制
- 小游戏**无键盘**：`window.addEventListener('keydown')` 空跑不报错，依靠触屏虚拟摇杆
- `PlatformProfile.detectHost()` 识别 `weapp`，`BackendConfig` 强制 2D，`pickBackend` 不加载 three.js
- 包体限制：主包 4MB，大资源放 CDN
- ES Module：小游戏基础库 3.0+ 支持，如遇问题改 CommonJS
- `game.json` 已设 `"deviceOrientation": "landscape"`

## 构建流程

```bash
node weapp/build.js
```

1. Vite 打 bundle → `weapp/src/bundle.js`
2. 复制资源 → `weapp/assets/`
3. 微信开发者工具打开 `weapp/` 目录

## .gitignore 规则

保留源码（adapter/game.js/build.js 等），排除构建产物：
```
weapp/src/
weapp/assets/
weapp/vite.config.weapp.js
weapp/node_modules/
weapp/project.private.config.json
```
