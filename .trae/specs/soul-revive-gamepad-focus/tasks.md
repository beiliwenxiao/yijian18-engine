# Tasks：灵魂复活弹窗手柄焦点与左摇杆切换

依赖：`spec.md`（§2 决策已定，无需再讨论）

- [x] **T1 焦点解析兜底** — `src/ui/IrreversibleChoiceView.js` `open()`
  - `selectedId ?? focusId` 命中优先；否则首个非 `cancel` 项；再退 `choices[0]`。
  - 新增 `get focusedChoiceId()` 只读访问器。
  - 验收：T3 用例 1、2。

- [x] **T2 摇杆导航武装修复** — `src/ui/IrreversibleChoiceView.js`
  - `open()`：`_leftStickNavArmed = true`、`_leftStickBaselinePending = true`；`close()` 同步重置基线标志。
  - `handleInput()` 摇杆段按 spec §3.1 第 3 条替换（首帧采集基线 → 偏置不切换 → 松手后边沿触发）。
  - 验收：T3 用例 3、4、5。

- [x] **T3 单测** — 新建 `src/ui/IrreversibleChoiceView.test.js`（7 例，见 spec §4）
  - 命令：`npx vitest run src/ui/IrreversibleChoiceView.test.js`
  - 结果：7/7 通过。

- [x] **T4 回归** — `npx vitest run src/ui src/core/scene src/core/input`
  - 结果：262/263 通过；唯一失败 `src/core/input/GamepadManager.test.js > 摇杆归中时十字键接管移动，magnitude 记为 1` 属既有失败，本次未触碰 `GamepadManager`（`git diff --stat` 仅 `src/ui/IrreversibleChoiceView.js`）。

- [x] **T5 实机确认（手柄）** — `scripts/probe-soul-revive-gamepad.mjs`（虚拟手柄注入，走真实入口 `playerSoulRespawn.onAwaitConfirmation`）
  - 结果 PASS：弹出即 `variant=compact`、焦点 `revive`；打开时摇杆偏置不误切换；松手推右 → `cancel`；推左 → `revive`。
