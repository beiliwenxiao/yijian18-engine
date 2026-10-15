---
inclusion: fileMatch
fileMatchPattern: '{**/DialogueSystem*,**/NpcComponent*,**/DataDrivenPrologueScene*}'
---

# NPC 对话完成后的交互行为

## 机制

`DialogueSystem.endDialogue()` 在清除对话状态后、触发 onEnd 回调之前，将对话 id 写入 `completedDialogues` Set。

NPC 交互时检查 `dialogueSystem.hasCompleted(dialogueId)`：
- 未完成 → 正常开对话
- 已完成 + `NpcComponent.repeatableDialogue === true` → 允许重播
- 已完成 + 无商店/任务 → 飘忙碌台词，不再重播剧情

## NpcComponent 字段

```js
this.repeatableDialogue = config.repeatableDialogue === true; // 默认 false
this.idleText = config.idleText || '';  // 自定义忙碌台词，留空用默认模板
```

`getIdleText(npcName)` → 自定义 idleText 或 `"${name} 看了你一眼，继续忙事情去了。"`

## DialogueSystem API

- `hasCompleted(dialogueId)` → boolean
- `clearCompleted(dialogueId?)` → 清除完成标记（调试/重播用）
- `saveState()` / `loadState()` 包含 `completedDialogues` 数组

## DataDrivenPrologueScene._checkNpcInteract

交互优先级：
1. 可说话 → `startDialogue`
2. 有商店 → `openShop`
3. 对话已完成且无其他交互 → `_showNpcIdleText`（飘字 + 系统提示，2 秒节流）

## 注意事项

- `dialogueSystem.reset()` 只清当前对话状态，**不清除** completedDialogues
- 放置点 `overrides` 可覆盖 `dialogueId`（同一 NPC 在不同场景讲不同对话）
- `completedDialogues` 随存档持久化，读档后 NPC 不会把剧情重讲一遍
