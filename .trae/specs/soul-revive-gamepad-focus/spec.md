# Spec：灵魂复活弹窗的手柄焦点与左摇杆切换

> 需求：灵魂复活时，手柄状态下自动焦点到「复活」按钮，可用左摇杆左右切换「取消 / 复活」。
> 状态：已实施 · 2026-11-07（单测 7/7、实机探针 PASS）

## 1. 现状实证

| 事实 | 位置 |
|------|------|
| 灵魂复活确认窗 = `IrreversibleChoiceView` compact 变体（`presentation.variant='compact'`、`allowMovement:true`、`allowCancel:true`） | `src/core/scene/SceneGameplaySystemAssembler.js` `onAwaitConfirmation`（约 L396-412） |
| 该快照已显式传 `selectedId: 'revive'`，`open()` 优先采用 → **HEAD 中默认焦点已是「复活」** | `IrreversibleChoiceView.open()`（L43-55）；提交 `f028089` |
| 左摇杆（阈值 0.5）/ 十字键左右 / 边沿触发已实现，compact 也启用 | `IrreversibleChoiceView.handleInput()`（L118-131） |
| 没有全局焦点/导航管理器；焦点 = `selectedId`，各视图自实现 | `src/ui/*`、`src/core/input/*` |
| 手柄对象每帧由 `SceneInputFlow.beforeFrame` 传入（`inputManager.gamepad`，含 `leftStick` / `isButtonPressed`） | `SceneInputFlow.js` L147-157 |

### 根因（本次要修的缺陷）

`open()` 把 `_leftStickNavArmed` 重置为 `false`，注释语义是"松手后重新武装、防连发"。但灵魂状态 `allowMovement:true`，玩家通常**推着摇杆边走边等倒计时**：弹窗出现时摇杆持续偏置 → `stickDirection !== 0` 分支永远走"未武装"路径 → 摇杆导航全程无效，必须先完全回中一帧再推才生效。

默认焦点本身没问题；`open()` 增加一条兜底（见 §3.1）保证任何调用方漏传 `selectedId` 时仍落在复活按钮上。

## 2. 取舍结论（先定，不再讨论）

| 决策点 | 结论 |
|--------|------|
| 焦点环 vs 鼠标 hover | 不引入第二套焦点视觉。`selectedId` 即焦点（现有金框高亮）；hover 不改变焦点；点击才吸附焦点，`immediate` 项当即提交。 |
| 手柄拔插时机 | 不做连接事件订阅。每帧直读 `gamepad.leftStick` / `isButtonPressed`：断连时 GamepadManager 归零，天然安全；插入后下一帧即可导航。 |
| 打开瞬间摇杆偏置 | **本次修复**：`open()` 直接武装，并把手势基线设为"首帧实际方向"——偏置不触发切换，松手后再推按边沿触发切换；持续推住不连发。 |
| compact 是否启用键盘 A/D 导航 | 保持禁用（`allowMovement` 下 A/D 用于世界移动）。 |
| 无 `selectedId` 时的默认焦点 | 依次回退：`snapshot.selectedId` → `snapshot.focusId` → 首个非 `cancel` 选项 → `choices[0]`。永不停留在「取消」。 |

## 3. 改动清单

### 3.1 `src/ui/IrreversibleChoiceView.js`

1. `open(snapshot)`：
   - 焦点解析改为：`snapshot.selectedId ?? snapshot.focusId`；不命中时取首个 `id !== 'cancel'` 的选项，再退 `choices[0]`。
   - `this._leftStickNavArmed = true`（不再等待回中）。
   - 新增 `this._leftStickBaselinePending = true`（首帧采集基线方向）。
2. `close()`：同步重置 `_leftStickBaselinePending = true`。
3. `handleInput()` 摇杆段改为：

```js
if (this._leftStickBaselinePending) {
  this._leftStickDirection = stickDirection;   // 偏置只作基线，不切换
  this._leftStickBaselinePending = false;
} else if (!this._leftStickNavArmed) {
  if (stickDirection === 0) this._leftStickNavArmed = true;
} else if (stickDirection !== 0 && stickDirection !== this._leftStickDirection) {
  this.moveSelection(stickDirection);
}
this._leftStickDirection = stickDirection;
```

   - 阈值 `LEFT_STICK_NAV_THRESHOLD = 0.5`、十字键 OR、A/X 确认、B 取消、鼠标逻辑全部不动。
4. 新增只读访问器 `get focusedChoiceId() { return this.selectedId; }`（供测试与后续 UI 复用，无行为变化）。

### 3.2 不改动

- `SceneGameplaySystemAssembler.js`：`selectedId: 'revive'` 已正确，保持原样。
- `SanguoSceneLifecycleCoordinator.handleModalInput`、`SceneInputFlow`：路由已正确传入 `gamepad`。
- 其它弹窗（`InteractionChoiceView` 等）：本次不动。

## 4. 新增测试 `src/ui/IrreversibleChoiceView.test.js`

1. compact 灵魂快照（含 `selectedId:'revive'`）打开后 `focusedChoiceId === 'revive'`。
2. 未传 `selectedId` 但选项为 `取消/复活` 时，焦点回退到 `revive`。
3. 打开时摇杆已偏置（`leftStick.x=-0.9`）：首帧不切换，之后松手（0）再推右 → 焦点变 `cancel`。
4. 持续推住摇杆（多帧同向）：只切换一次，不连发。
5. 十字键 `DPAD_RIGHT` 按下：焦点切换且循环。
6. 手柄 A 键：发出 `{ type:'selectChoice', choiceId:'revive' }`；B 键在 `allowCancel` 下发出 `{ type:'cancel' }`。
7. 非 compact 弹窗键盘 `left`/`right` 仍可切换（回归）。

## 5. 验证

- `npx vitest run src/ui/IrreversibleChoiceView.test.js`
- `npx vitest run src/ui src/core/scene src/core/input`（回归）
- 实机：手柄玩家在灵魂状态持续推摇杆等待 → 弹窗出现时焦点在「复活」，松手后左右推可切换，A 确认。
