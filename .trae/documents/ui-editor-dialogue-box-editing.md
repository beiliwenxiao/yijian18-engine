# UI 编辑器：对话框编辑功能设计

## Context

当前对话 UI 只有一种布局（左侧 100×100 头像 + 文本），由 `DialogueBox` 硬编码，无法在 UI 编辑器中调整位置大小，也没有旁白/半身像/全身像等叙事演出形态。目标：

1. **UI 编辑器（ui-editor.html）** 新增「对话框」编辑：4 种对话框类型（旁白对话、NPC头像对话、NPC半身对话、NPC全身对话）各自可编辑**位置与大小**（样式用代码默认值，已与用户确认）。
2. **对话编辑器（dialogue-editor.html）** 中每个对话可编辑**对话框类型**与对应的**头像 / 半身像 / 全身像美术资源**（对话级粒度，已与用户确认；节点级 `portrait` 字段保留作头像覆盖）。

## 数据模型

对话级新字段（存 `game.project.json` 的 `dialogues[]`，与现有节点字段平级）：

```json
{
  "id": "dialogue.s02.prologue",
  "title": "山道抉择",
  "presentation": {
    "boxType": "portrait",              // narration | portrait | halfBody | fullBody（缺省 portrait = 现有行为）
    "portraitImage": "assets/images/zhangjiao.png",
    "halfBodyImage": "",
    "fullBodyImage": ""
  },
  "nodes": { "...": "现有节点结构不变" }
}
```

图片路径为相对游戏入口的路径；留空表示该对话不用该形态。节点 `portrait`（现有）优先于 `presentation.portraitImage`。

## 实施步骤

### 1. DialogueSystem 透传 presentation — `src/systems/DialogueSystem.js`

`registerDialogue`（L83-93）白名单中增加 `presentation: dialogueData.presentation || null`。`startDialogue` 已保存 `this.currentDialogue`，DialogueBox 可直接读取。

### 2. DialogueBox 四种布局渲染 — `src/ui/DialogueBox.js`

- 新增 `setLayoutRects(rects)`：接收 `{ narration, portrait, halfBody, fullBody }` 四组 `{x,y,width,height}`（UI 编辑器保存的矩形）；未设置时用现有硬编码默认。
- `render()` 时按 `this.dialogueSystem.currentDialogue?.presentation?.boxType || 'portrait'` 选择布局与矩形。
- 四种类型的渲染差异（在现有 renderBackground/renderPortrait/renderSpeaker/renderText 基础上参数化）：
  - **narration**：无头像区，文本区全宽；speaker 显示为「旁白」时用灰蓝色弱化标题；矩形高度较矮。
  - **portrait**：现有布局不变（左侧方形头像）。
  - **halfBody**：左侧立绘区放宽（按矩形高度自适应，约 0.75 宽高比），speaker/文本/选项右移。
  - **fullBody**：文本框靠左，全身立绘画在自身矩形的右缘区域、底对齐（不参与 Y 排序，纯 UI 层）。
- 图片解析优先级：节点 `portrait`（先当路径、再当 PortraitsConfig key）→ `presentation.portraitImage` → canvas 手绘回退。`halfBodyImage` / `fullBodyImage` 构造时懒加载为 `Image`。
- 头像/立绘资源映射表扩展：`options.portraits` 继续可用，新增构造参数 `presentationImages`（由场景从 PortraitsConfig/manifest 传入，可选）。

### 3. UIEditor 新增对话框组件 — `editor/UIEditor.js`

- `DEFAULT_COMPONENTS.desktop`（canvas 1280×720）与 `.mobile`（1280×600）各新增 4 个组件，`kind: 'dialogue'`：

| id | label | desktop 默认 | mobile 默认 |
|----|-------|--------------|-------------|
| dialogue-narration | 旁白对话 | x190 y520 w900 h150 | x190 y430 w900 h140 |
| dialogue-portrait | 头像对话 | x290 y245 w700 h230 | x390 y280 w500 h170 |
| dialogue-halfbody | 半身对话 | x290 y300 w700 h300 | x340 y260 w600 h260 |
| dialogue-fullbody | 全身对话 | x120 y280 w700 h230 | x190 y220 w600 h200 |

- `_injectStyles` 增加 `.uie-comp.dialogue` 预览样式（深色底、棕金边框、左上头像/右侧立绘占位块），区分 narration（全宽横幅样式）。
- 属性面板、拖拽、缩放、保存（`_mergeLayout` 百分比转换 → `UILayout.desktop/mobile.json`）全部复用现有通用逻辑，无需改动。

### 4. 运行时布局接线 — `src/core/scene/ScenePanelLayout.js`

`applyUILayout`（L392-425，现有挂载点）中增加：

```js
scene.dialogueBox?.setLayoutRects?.({
  narration: loader.getRect('dialogue-narration', width, height),
  portrait: loader.getRect('dialogue-portrait', width, height),
  halfBody: loader.getRect('dialogue-halfbody', width, height),
  fullBody: loader.getRect('dialogue-fullbody', width, height)
});
```

### 5. 对话编辑器表单 — `editor/DialogueGraphEditor.js`

- `_renderDetail`（L359-372）顶部区域（起始节点之前）新增「对话框演出」分组：
  - 对话框类型下拉：`portrait 头像对话（默认）/ narration 旁白对话 / halfBody 半身对话 / fullBody 全身对话`
  - 三个路径输入框：头像图 portraitImage、半身图 halfBodyImage、全身图 fullBodyImage（占位符提示相对路径，如 `assets/images/xxx.png`）
- `_commitDetail`（L496-516）写回 `d.presentation`；boxType 为 portrait 且三个路径全空时删除 `presentation` 字段，保持 JSON 干净。
- 保存复用现有 `canonicalSession.patch('dialogues', ...)` 流程（L71-106）。

### 6. 演示数据（可选，便于验证）

给 `game.project.json` 中 `dialogue.s01.wake`（纯旁白）配置 `boxType: "narration"` 作为验收样例；其余对话缺省走 portrait 现状。半身/全身图暂无现成美术，验证时可用现有 `assets/images/zhangjiao.png` 占位。

## 复用清单

- 布局保存/加载：`replaceCanonicalFile`（editor/CanonicalTransactionClient.js）、`UILayoutLoader.getRect`（src/ui/UILayoutLoader.js L97）
- 组件拖拽/属性/保存：UIEditor 现有通用组件逻辑（L749-802、save L1296）
- 对话保存：`canonicalSession.patch('dialogues')`（DialogueGraphEditor L71-106）
- 头像加载：DialogueBox `portraitImages` 预加载模式（L74-88）

## 验证

1. `node --check` 全部改动 JS；`JSON.parse` 校验改动的 JSON。
2. `npx vitest run src/systems/DialogueSystem.test.js` 确认注册/播放无回归。
3. 浏览器端到端（TRAE-browseruse，http://localhost:3000 或 dev server）：
   - 打开 `editor/ui-editor.html` → 确认 4 个对话框组件出现在 PC/Android 两套布局中 → 拖拽调整 → 保存 → 检查 `config/UILayout.*.json` 写入 xPct/yPct。
   - 打开 `editor/dialogue-editor.html` → 选择任一对话 → 修改对话框类型与图片路径 → 保存 → 检查 `game.project.json`。
   - 运行游戏触发 `dialogue.s01.wake`（旁白样式）与带 portrait 的对话，确认布局来自 UI 编辑器配置、类型与美术生效。
