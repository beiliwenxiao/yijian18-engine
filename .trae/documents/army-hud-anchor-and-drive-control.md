# 军队操作条锚定按钮 + F/B 热键 + WASD/摇杆驾驶编组

## Context（背景与目标）

军队指挥系统已成熟（ArmyCommandSystem / ArmyCommandHUD / SceneArmyCommandFlow，M1-M5）：编组选择（武将/全军/前/左/中/右/后军）、姿态命令（跟随+4 战术）、Tab/LB 循环、RB 切命令、鼠标点选/框选、右键下令均已实现。本次补齐 4 个缺口：

1. 军队操作条目前**居中**显示 → 改为**右对齐锚定军队按钮**（按钮动则面板跟着动），按钮点击开关（已支持，保留）。
2. PC 热键 **F**（fight）开关军队操作条——当前该热键只有手柄 LS 动作，键盘键未绑。
3. 手柄热键 **B** 开关军队操作条——`PadButton.B` 当前是空绑定，无冲突。
4. 操作条开启且选中非武将编组时，**WASD/左摇杆改为驾驶选中编组**（直接移动军队）；
   关闭列表/切回武将后恢复控制武将。LB 切编组、RB 切次级选项已存在，不动。

已确认的裁定：
- 驾驶期间武将**原地站定**（战斗 AI 照常）。
- 松开 WASD/摇杆后被驾驶编组**原地驻守**（驻守点更新到当前位置，goal 清空）。

范围：2D 主项目 example/sanguo_zhangjiao + src/ 引擎层（3D 项目无军队系统，不动）。

## 改动清单

### 1. HUD 锚定军队按钮（src/ui/ArmyCommandHUD.js + src/core/scene/SceneArmyCommandFlow.js）

- `ArmyCommandHUD.layout(width, height, barWidth, editorRect, anchorRect)` 增加第 5 参
  `anchorRect`（军队按钮矩形 `{x,y,width,height}`）：
  - PC 默认分支（无 editorRect）：`this.x = anchorRect.x + anchorRect.width - this.width`（右对齐）、
    `_baseY = anchorRect.y - 8`（面板底边贴按钮上方，向上展开逻辑不变）。
  - `editorRect`（UI 编辑器 armyCommandHud 矩形）优先级不变，其次按钮锚定，最后回退居中。
  - 安卓分支不变。
- `SceneArmyCommandFlow.onResize()`（:121）：读 `this.scene.armyButton` 的实时矩形作为
  `anchorRect` 传入（按钮存在才传，触屏布局无按钮传 null）——按钮位置将来被 UI 编辑器移动时面板自动跟随。

### 2. PC 热键 F（src/core/scene/SceneInputBindings.js:49）

```js
this.inputManager.registerHotkey(
  'toggle_army_command', ['f', 'F', ARMY_COMMAND_ACTION], () => this.toggleArmyCommand?.(), { cooldown: 300 });
```
链路已通：`toggleArmyCommand` → `BaseGameSceneSetup.toggleArmyCommandHud()`（:378，翻转 hud.visible）。
F 键未占用（PickupPrompt 仅显示提示文字）。

### 3. 手柄热键 B

- `src/core/input/Xbox360Profile.js`：`DEFAULT_BINDINGS[PadButton.B]`：`NONE_ACTION` → `ARMY_COMMAND_ACTION`；
  `BINDING_DESCRIPTIONS[PadButton.B]`：`'—'` → `'军队操作条开关'`。
- `example/sanguo_zhangjiao/config/gamepad.json`：`bindings["1"]`：`""` → `"armyCommand"`
  （该文件会覆盖默认绑定，两处都要改）。B 注入 `armyCommand` 动作后走同一 `toggle_army_command` 热键。
- 注：config 里 LS（index 10）被覆盖为空，保持现状（B 为手柄主入口）。

### 4. WASD/左摇杆驾驶编组（核心新能力）

**ArmyCommandSystem（src/systems/ArmyCommandSystem.js）新增：**

- `setHudVisibleProvider(fn)` — SceneArmyCommandFlow.attach 注入 `() => this.hud.visible`。
- `isArmyDriveActive()` — `hudVisibleProvider() === true && this.hasSquadSelection()`
  （`commander` 槽 `getSelectedUnits()` 返回空数组 → hasSquadSelection=false，天然排除武将槽）。
- `handleDriveInput(vx, vy, magnitude)` — 由 MovementSystem 每帧调用，内部管理状态迁移：
  - 激活中：记录 `_driveUnitIds`（选中单位 id 集）、`_driveActiveAt = now()`；
    对每个选中单位写 `movement.velocity = dir * (movement.speed × magnitude)` + walk 动画；
    `magnitude≈0` 时对选中单位 `_stop`。跳过 construction builders 与 `carryState === 'carrying'` 单位。
  - 由激活 → 失效（HUD 关闭/切回武将/清选择）：`endArmyDrive()`。
- `endArmyDrive()` — 对 `_driveUnitIds` 中单位：`command.goal = null`、
  `command.post = 当前位置`（原地驻守），清 `_driveUnitIds`。
- `_updateUnitStance`（:887）入口加守卫：单位 id 在 `_driveUnitIds` 且 `now() - _driveActiveAt < 250ms`
  时直接 return（姿态机不抢速度）；构建/搬运优先级高于驾驶（同现有守卫顺序）。
- 状态提示：`isArmyDriveActive()` 时 HUD 状态行显示「WASD/摇杆 驾驶中 · 关闭列表恢复武将」。

**MovementSystem（src/systems/MovementSystem.js handleKeyboardInput :512）拦截：**

在 `getMoveAxis()` 取轴之后、`_resolveMoveTarget` 之前：
```js
if (this.armyCommandSystem?.isArmyDriveActive?.()) {
  this._stopEntityMovement(playerEntity);   // 武将原地站定（战斗 AI 不受影响）
  this.armyCommandSystem.handleDriveInput(vx, vy, magnitude);
  return;
}
```
（`movementSystem.armyCommandSystem` 引用已由 SceneArmyCommandFlow.attach :82 注入。）

- 驾驶期间右键下令仍可设 goal，但姿态机被驾驶压制，松开后 goal 清空、原地驻守（符合已确认裁定）。
- 手柄：左摇杆轴已在 `getMoveAxis()` 合并（模拟量优先），拦截点同一处自动生效；LB 切编组/RB 切命令/A 确认逻辑不动。

### 5. 测试（test/armyCommandSystem.test.js 追加）

- `handleDriveInput`：选中编组后调用 → 单位 velocity 按方向/速度写入；magnitude=0 → 停止。
- 驾驶激活期间 `_updateUnitStance` 不覆盖被驾驶单位速度（escort 姿态不拉回）。
- `endArmyDrive`：goal 清空、post 更新为当前位置。
- HUD provider=false 或切回 commander 槽 → `isArmyDriveActive()` false，下一帧恢复姿态机。

## 验证

1. `node --check` 全部改动文件。
2. `npx vitest run test/armyCommandSystem.test.js` 全绿（含新增用例）。
3. 浏览器实测（S02 有 army.s02.guard 前军/后军编制）：
   - 点「⚔️ 军队」按钮/按 F/手柄 B → 操作条出现在按钮正上方、右边缘与按钮对齐；再按关闭。
   - 点击「前军」→ WASD 移动的是前军士兵，武将原地站定；松开 → 前军原地驻守。
   - 点「武将」或关列表 → WASD 恢复控制武将。
   - 手柄：LB 循环切编组、按住 LB + RB 切姿态、左摇杆驾驶编组。

## 不做的事

- 不改 3D 项目（无军队系统）。
- 不动 LB/RB/Tab/A 既有手柄指挥语义。
- 不做 HUD 注释里的「快速逃命」紧急按钮（原计划后做）。
