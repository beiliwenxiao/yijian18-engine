---
inclusion: auto
description: UI 编辑器组件、布局配置与移动端和桌面端 UI 接线约定。
---

<!--
Copyright (c) 2026 Liu Xiao (beiliwenxiao)

@project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
@author    刘枭 (beiliwenxiao)
@email     beiliwenxiao@qq.com
@date      2026-01-14
@blog      https://blog.csdn.net/beiliwenxiao
@repo      https://github.com/beiliwenxiao/yijian18-engine
           https://gitee.com/coderaaa/yijian18-engine
-->

# UI 编辑器组件管理指南

## 概述

UI 编辑器（`editor/UIEditor.js`）用于可视化编辑移动端/PC端的 UI 按钮和面板布局。
编辑后保存为 JSON 配置：
- `example/sanguo_zhangjiao/config/UILayout.mobile.json`
- `example/sanguo_zhangjiao/config/UILayout.desktop.json`

游戏运行时通过 `UILayoutLoader` 和 `applyUILayoutToDom()` 读取配置并应用布局。

## 架构关系

### 移动端 DOM 组件需要同步三处

当新增、删除或修改移动端 DOM 按钮时，必须同步修改以下三处：

1. **`editor/UIEditor.js`** — `DEFAULT_COMPONENTS.mobile.components[]`（编辑器默认值）
2. **`config/UILayout.mobile.json`** — 已保存的布局配置
3. **`index.html`** — 两处：
   - HTML DOM 元素（按钮实际结构）
   - `applyUILayoutToDom()` 中的 `domIds` 映射表

### Canvas 面板类组件（非 DOM）

纯 Canvas 面板不进入 `index.html` 或 `domIds`。运行时统一由 `ScenePanelLayout.applyUILayout()` 使用 `UILayoutLoader.applyToCanvasPanel()` 或 `getRect()` 应用布局；`ScenePanelLayout` 通过 `context.ui.layout` 暴露给 `SceneRenderPipeline`，渲染器不得另存第二份布局状态。

### 组合 Canvas 面板内部布局

`UILayout.desktop/mobile.json` 只保存 `backpackPanel` 外框；属性、装备和物品栏内部部件的唯一事实源是两端共用的 `config/PanelLayout.json`，不得把 `bagTitle`、`bagSeparator` 等内部部件复制成 UILayout 顶层组件。`UIEditor` 加载时必须保留完整 PanelLayout 文档，并让索引映射继续引用 `panels[]` 原对象，保存时序列化完整文档，避免编辑白名单导致其他部件丢失。

UI 编辑器预览、虚线交互框和拖动反算必须共用 `BackpackPanel._applyScaledLayout()` 的变换：`contentScale = min(outerWidth / designWidth, outerHeight / designHeight)`，设计画布等比缩放后在外框中居中；拖动增量除以 `editorScale * contentScale` 才能写回 PanelLayout 内部坐标。目前 PC/Android 都投影 inventory 的 `bagTitle` 与 `bagSeparator`，修改任一视图都会影响同一对象。`line` 可以扩大编辑器命中框，但真实 `height` 只能在用户明确改值或缩放时变化。

### 双端 Canvas 屏幕 HUD

小地图、时间天气和战斗/灵魂状态徽章在 Android 与 PC 运行时都属于 Canvas，不因 mobile 平台改成 DOM：

| id | label | 运行时所有者 |
|----|-------|-------------|
| `minimap` | 小地图 | `Minimap`，由 `ScenePanelLayout` 直接应用矩形 |
| `timeWeatherBadge` | 时间/天气 | `SceneRenderPipeline` 读取 `context.ui.layout.getScreenHudRect()` |
| `combatStateBadge` | 战斗/灵魂状态 | `SceneRenderPipeline` 读取 `context.ui.layout.getScreenHudRect()` |
| `taskTracker` | 任务追踪 | `TaskGraphProjectionView` 只读当前玩家投影，`SceneRenderPipeline` 传入 `getScreenHudRect('taskTracker')` |

新增或调整这类双端 Canvas HUD 必须同步四处：

1. `DEFAULT_COMPONENTS.desktop.components[]`
2. `DEFAULT_COMPONENTS.mobile.components[]`
3. `UILayout.desktop.json`
4. `UILayout.mobile.json`

`UIEditor._mergeLayout()` 只遍历当前平台的 `DEFAULT_COMPONENTS`；只改 JSON 会让额外 ID 在加载合并时被丢弃。四项 HUD 不需要修改 `index.html` 或 `applyUILayoutToDom()`。天气与战斗徽章必须各自保存独立矩形，拖动其中一项不得再通过“小地图相对位置”隐式带动另一项；旧配置缺失时才允许使用相对小地图的 fallback。任务追踪不允许固定位置 fallback：`TaskGraphProjectionView` 只在 `ScenePanelLayout._screenHudRects.taskTracker` 存在时由渲染管线绘制，并且只读取当前玩家的 `TaskGraphSystem.getProjection()`。两类徽章的文字布局统一使用可选 `fontSize/textOffsetX/textOffsetY`：`fontSize:0` 或缺字段表示沿用自动字号，偏移只移动框内文字。字段必须沿 `UIEditor → UILayout JSON → UILayoutLoader.getRect() → ScenePanelLayout._screenHudRects → SceneRenderPipeline` 投影，渲染器禁止直接读取布局 JSON。

UI 编辑器的“保存到文件”同时写 UILayout/LoginLayout、共用 PanelLayout、手柄绑定和提示文案；每个写入必须把失败抛给 `save()` 聚合，任一子项失败都只能显示“部分保存失败”，不得被后续成功状态覆盖。成功/失败同时保留底部状态并显示自动消失的非阻塞反馈，禁止用 `alert()` 阻塞编辑流程。

`Minimap` 被 `UILayoutLoader` 命中时必须调用 `setLayoutManaged(true)`，使 `_tryBuildCache()` 只建立地图内容缓存而不按世界宽高比重写编辑器保存的 `width/height`。窗口 resize 只复用已经加载的 `scene.uiLayoutLoader` 重新计算百分比矩形，不得重新 fetch 配置，也不得无条件把小地图重置到右上角。任务 marker 每帧只读 `context.services.taskGraph` 的当前玩家投影：显式 `x/y` 按世界坐标使用；只有 `sceneId+targetId` 时依次从 `context.services.placements.inspectPlacement()` 和已投影场景对象解析统一空间锚点，无法解析必须省略 marker，不得猜测或伪造坐标。`Minimap.setTaskMarkers()` 只接收表现投影，不修改 TaskGraph、placement 或场景对象。

### 平台差异：mobile 交互按钮以 DOM 为主，desktop 控件以 Canvas 为主

- **移动端(mobile)** 交互按钮主要是 `index.html` 里的 DOM；上述双端屏幕 HUD 和 `PlayerStatusHUD` 等是 Canvas 例外。
- **PC 端(desktop)** UI 是 **Canvas 渲染的面板/控件**（PlayerInfoPanel、InventoryPanel、BottomControlBar 等），不涉及 index.html DOM 和 domIds。改动只需同步：
  1. `editor/UIEditor.js` — `DEFAULT_COMPONENTS.desktop.components[]`
  2. `config/UILayout.desktop.json`
  3. 对应 Canvas 面板组件代码 + `ScenePanelLayout` 的应用逻辑

## PC UI 组件列表（desktop，已拆分为独立小控件）

底部控制栏(BottomControlBar)已按“组件原子化”原则拆成 9 个独立可编辑控件，
不再是一个整体大面板。

| id | label | kind | 说明 |
|----|-------|------|------|
| playerInfoPanel | 角色/装备面板 | panel | 大面板，独立 |
| inventoryPanel | 背包面板 | panel | 大面板，独立 |
| pc-hp-orb | 血球 | button | 仅显示，不可点击 |
| pc-mp-orb | 蓝球 | button | 仅显示，不可点击 |
| pc-potion1 | 红瓶 | button | 药水快捷槽 |
| pc-potion2 | 蓝瓶 | button | 药水快捷槽 |
| pc-skill1 ~ pc-skill5 | 技能1~5 | button | 5 个技能槽 |
| equipmentPanel | 装备面板 | panel | PC 独立装备面板（属性/装备分离） |
| pc-char | 属性 | button | IconButton，快捷键 C，开关属性面板 |
| pc-equip | 装备 | button | IconButton，快捷键 V，开关装备面板 |
| pc-bag | 背包 | button | IconButton，快捷键 B，开关背包面板 |

> `pc-char`/`pc-equip`/`pc-bag` 是独立的 `IconButton`（`src/ui/IconButton.js`，支持 icon/label/hotkey），
> 不属于 BottomControlBar。仅桌面创建（移动端用 DOM 按钮），在 `BaseGameScene` 注册到 uiClickHandler，
> `_applyUILayout()` 用 `applyToCanvasPanel('pc-char'/'pc-equip'/'pc-bag', ...)` 定位，点击回调 `panel.toggle()`。

### 属性/装备分离（PC）

- **PlayerInfoPanel** 增加两个开关：`showEquipmentSection`（装备区）、`showAttributeSection`（属性区），
  竖版 `render` 按开关显示对应区块，标题随之变为“属性”/“装备”/“角色信息”。
- **PC 端**：属性面板 = `playerInfoPanel`（`showEquipmentSection=false`，只属性）；
  装备面板 = 第二个 `PlayerInfoPanel` 实例 `equipmentPanel`（`showAttributeSection=false`，只装备）。
  复用同一 PlayerInfoPanel 保证装备槽命名一致（不用 EquipmentPanel，其槽命名与装备组件不一致）。
- **移动端**：`playerInfoPanel` 保持 `showEquipmentSection=true`（属性+装备一体，即“装备栏”），不创建独立装备面板。
- 快捷键：C=属性、V=装备、B=背包（`registerHotkeys` 注册；E 已被拾取占用故装备用 V）。
- 卸装逻辑抽为 `BaseGameScene._handleEquipmentSlotClick()`，属性面板/装备面板共用。

### BottomControlBar 子布局机制

- `BottomControlBar.applySubLayout(rects)`：接收各子控件矩形，
  计算整体包围盒设为 `this.x/y/width/height`，子控件坐标存为**相对包围盒左上角**
  （渲染/点击用 `this.x + slot.x` 还原为绝对坐标）。
- 有子布局(`_hasSubLayout=true`)时 `render` 不画整体背景条。
- `BaseGameScene._applyUILayout()`：底部控制栏优先读 `pc-*` 子控件布局并 `applySubLayout`；
  若 json 无子控件（旧数据），回退整体 `bottomControlBar` 布局（向后兼容）。
- **坑**：`applySubLayout` 必须更新面板包围盒 `width/height`，否则 `handleMouseClick`
  的 `containsPoint` 用默认 800×100 判断会导致超出范围的子控件点不中。
- skillSlots 数组映射：`[0,1]`=药水(pc-potion1/2)，`[2..6]`=技能(pc-skill1~5)。

## 组件类型

| kind | 说明 | 示例 |
|------|------|------|
| `zone` | 区域（虚线框） | 摇杆区 |
| `panel` | 面板 | HUD血条、背包面板 |
| `button` | 圆形按钮 | 攻击、技能、药瓶 |
| `bar` | 条形栏（已废弃） | ~~底部快捷栏~~ |

## 设计原则

### 组件应尽量原子化

- **不要**把多个独立功能合并成一个组件（如"底部快捷栏"包含6个按钮）
- **应该**让每个按钮/元素都是独立的可编辑组件
- 这样在 UI 编辑器中可以自由调整每个元素的位置和大小

### 按钮不应共用/切换

- **不要**让一个按钮在不同状态下切换功能（如攻击/交互共用）
- **应该**每个功能有独立的按钮，始终可见、始终可点

### PlayerStatusHUD 子组件独立布局

HUD 已拆分为4个独立子组件：
- `hud-avatar` — 头像
- `hud-name` — 昵称
- `hud-hp` — 血条
- `hud-mp` — 蓝条

`PlayerStatusHUD` 通过 `applySubLayout({ avatarRect, nameRect, hpRect, mpRect })` 接收独立位置。
当有子布局时，不画整体背景面板，各子元素自由定位。

## 当前 Android UI 组件列表（mobile）

| id | label | kind | 说明 |
|----|-------|------|------|
| joystick | 摇杆区 | zone | 虚拟摇杆区域 |
| hud-avatar | HUD头像 | button | 玩家头像 |
| hud-name | HUD昵称 | panel | 玩家昵称 |
| hud-hp | HUD血条 | panel | 生命值条 |
| hud-mp | HUD蓝条 | panel | 魔法值条 |
| act-attack | 攻击 | button | 普攻（瞄准模式） |
| act-block | 格挡 | button | 主动格挡（1秒，CD8秒） |
| act-skill3 | 技能3 | button | 火焰掌 |
| act-skill4 | 技能4 | button | 寒冰指 |
| act-skill5 | 技能5 | button | 烈焰掌 |
| act-flight | 轻功 | button | 轻功闪避 |
| act-interact | 交互 | button | NPC交互/拾取 |
| act-throw | 投掷 | button | 投掷武器 |
| act-axe | 采集 | button | 斧头/采集 |
| hb-hp | 红瓶 | button | 生命药水 |
| hb-mp | 蓝瓶 | button | 魔法药水 |
| hb-char | 装备 | button | 打开装备面板 |
| hb-bag | 背包 | button | 打开背包面板 |
| hb-skill6 | 回血 | button | 回血技能 |
| hb-skill7 | 打坐 | button | 打坐恢复 |

## 新增按钮的完整流程

1. 在 `index.html` 的 `#action-buttons` 或合适位置添加 HTML DOM
2. 在 `index.html` CSS 中添加默认定位样式
3. 在 `index.html` 的 `triggerAction()` 和/或 `doPress()` 中添加事件处理
4. 在 `index.html` 的 `applyUILayoutToDom()` 的 `domIds` 映射中注册
5. 在 `editor/UIEditor.js` 的 `DEFAULT_COMPONENTS.mobile.components[]` 中添加条目
6. 在 `config/UILayout.mobile.json` 的 `components[]` 中添加配置（含百分比值）

## 已废弃的模式

- ~~`bottom-hotbar` 整体栏~~ → 拆分为 hb-hp/hb-mp/hb-char/hb-bag/hb-skill6/hb-skill7（mobile）
- ~~`playerStatusHUD` 整体面板~~ → 拆分为 hud-avatar/hud-name/hud-hp/hud-mp（mobile）
- ~~`updateAttackButtonMode()` 攻击/交互切换~~ → 攻击和交互独立按钮
- ~~PC 端 `bottomControlBar` 整体面板~~ → 拆分为 pc-hp-orb/pc-mp-orb/pc-potion1/pc-potion2/pc-skill1~5（desktop，Canvas 面板）
