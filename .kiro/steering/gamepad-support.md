---
inclusion: fileMatch
fileMatchPattern: '{**/input/**,**/InputManager.js,**/GamepadPanel.js,**/MovementSystem.js,**/Xbox360Profile.js,**/GamepadManager.js,**/UIEditor.js}'
---

# 手柄支持（Xbox 360 / W3C Standard Gamepad）

跨端手柄输入实现，遵循引擎 `src/core/input/` 分层。仅在编辑输入相关文件时加载本文档。

## 模块位置

| 文件 | 职责 |
|---|---|
| `src/core/input/Xbox360Profile.js` | W3C standard 按钮/轴索引常量、默认绑定表、UI 绘制布局、按钮标签与功能说明 |
| `src/core/input/GamepadManager.js` | Gamepad API 轮询器（采集层），`destroy()` 精确移除浏览器监听 |
| `src/core/input/SceneInputFlow.js` | 场景帧首 poll、弹窗优先消费、战斗意图、输入路由与正常帧末清帧 |
| `src/core/scene/SceneInputBindings.js` | 热键、手柄配置加载、连接/断开回调与生命周期注销 |
| `src/ui/GamepadPanel.js` | 手柄示意 UI（表现层，纯 Canvas） |
| `src/core/InputManager.js` | 内置 GamepadManager，与键盘状态取或 |
| `src/systems/MovementSystem.js` | 通过 `getMoveAxis()` 支持摇杆模拟量移动 |

## 核心约定

### 1. Gamepad API 是轮询式，必须帧首 poll
`GameEngine.update` 开头调 `inputManager.pollGamepads()`，在任何 `isKeyDown/isKeyPressed` 读取**之前**。放到帧末（`InputManager.update()` 清帧处）会读到上一帧状态。

### 2. 手柄状态独立存放，查询时与键盘取或
手柄虚拟键存在 `_padDown/_padPressed/_padReleased`，**不写进** `this.keys`，避免污染键盘的按下/释放沿判定。`isKeyDown` 等做 `键盘 || 手柄` 合并。这样键盘和手柄可同时使用、互不干扰。

### 3. 虚拟键名必须对齐 InputManager.keyMap 的输出
绑定表的值是项目已用的虚拟键名（`up/down/left/right`、`skill1..skill7`、`e/c/b/v/q/escape/space`），不是原始物理键。改绑定时对照 `keyMap` 与各系统实际读取的键名（如 CombatSystem 的 `skillKeyMap`/`potionKeyMap` 用 `skill1..skill7`）。

### 4. 专用战斗动作与普通虚拟动作分流
攻击、格挡、技能轮盘与释放由 `GamepadCombatController` 解释，不注入普通虚拟键；跳跃是例外，`JUMP_ACTION ('jump')` 作为虚拟键与键盘空格共用 `SceneFramePipeline → JumpChargeController → jumpByDirection()` 的蓄力跳链路。

默认 Y 绑定 `JUMP_ACTION`：按住的前 0.2 秒为短跳预备阶段，松开时按角色当前朝向执行短跳；超过 0.2 秒才进入正式蓄力，并在总按住 1 秒时蓄满。只有正式蓄力阶段才以玩家为中心显示最大可达的虚线范围，左摇杆在当前蓄力允许距离内移动已有的落点小圈，推杆幅度决定落点远近。`MovementSystem.isMoveInputSuppressed` 仅在 `JumpChargeController.isCharging()` 为真时消费玩家移动意图并停止残余移动；松手后立即恢复左摇杆的普通移动语义。轻功与投掷是手柄技能轮盘的固定选项：LB 选择，RB 按住时由右摇杆瞄准、松开释放。轮盘选项由 `SceneCombatActions.getGamepadSkillOptions()` 在普通 `combat.skills` 后追加，仍复用 `FlightSystem` / `WeaponRenderer` 的既有动作入口，不把它们伪装为 Demo 的战斗技能定义。

RT 攻击 intent 必须沿 `GamepadCombatController → SceneCombatActions._performGamepadAttack() → attackByDirection()` 进入键鼠/触屏共用的基础攻击准入和执行链；`GamepadCombatController` 只在本次 RT holding 内缓存最后一个越过 `GamepadManager` 径向死区的 RS **单位方向**，归中不得把缓存覆盖为零。快按时若本次 holding 已有有效 RS 也使用该方向；没有有效 RS（含长按后归中）才回退 `getPlayerFacingVector()`，禁止把零向量默认成固定向右。释放只产出一次 intent 并立即清缓存；断连、模态/弹窗接管、玩家硬锁和场景退出统一调用 `cancelTransientState()`，清除 RT/RB/LT/LB 瞬态且不得补发陈旧攻击。禁止硬编码物理按钮索引、在按下沿另建直攻旁路，或绕过可改绑的 `ATTACK_ACTION`。

RT holding 的扇形方向锁由 `SceneCombatActions` 临时拥有：按住时实时投影缓存方向（无缓存则 facing），释放/取消时恢复进入前的锁值；实际 `performSectorAttack()` 使用的短锁必须在同步提交后通过 `finally` 恢复，冷却、缺弹、拒绝或异常都不得遗留永久 `sectorDirectionLocked`。载具武器仍走场景可选 `handleBasicAttackIntent(intent)`；Demo Scene 必须显式转发给历史 coordinator，武器席返回 `true` 即表示输入已消费，即使资源不足或 checkpoint 失败也不得回退成乘员个人攻击。

`BaseGameScene.isPlayerActionLocked()` 只表示死亡、灵魂、死亡/复活 pending、采集会话等所有世界动作共同拒绝的硬锁，不得包含 `CombatSystem.isInCombat()`；否则 RT intent 与 canonical `jump` 会同时被提前吞掉。基础攻击资格由 `canPerformBasicAttack()` 单独判断，普通跳跃在战斗中保持可用，灵魂/死亡状态仍同时拒绝攻击和跳跃。

`SceneInputFlow.onModalInput()` 可返回 `{ handled:true, allowMovement:true }`：路由仍在 `MODAL_UI` 层消费攻击、拾取、技能、跳跃与交互，并取消手柄战斗瞬态；只有 `MovementSystem` 继续读取键盘、触屏摇杆、手柄左摇杆和未消费的右键移动。该例外只适用于明确声明的紧凑灵魂复活确认，其他 modal 保持完整世界输入阻断。

### 5. 摇杆死区用径向死区 + 重标定
`_applyDeadzone` 把 `[deadzone,1]` 重映射到 `[0,1]`，避免死区边缘速度突跳。默认死区 0.22。扳机（LT/RT）是模拟量，按 `triggerThreshold`（默认 0.5）离散成按下/松开。

模态 UI 需要“仅左摇杆”导航时直接读取已过死区的 `gamepad.leftStick.x/y`，再应用 UI 导航阈值；不得使用 `getMoveVector()` / `getMoveAxis()`，因为两者会回退 D-pad。焦点切换采用“显示后先归中武装 + 方向锁存”，同方向持续推杆只触发一次，归中或直接反向后才能再次触发；生命周期隐藏/重显时必须重置锁存。物品获得弹窗固定使用左摇杆水平轴左右切换，D-pad 不参与该弹窗导航。

### 6. 移动优先用 getMoveAxis()
`MovementSystem.handleKeyboardInput` 先取 `inputManager.getMoveAxis()`（返回归一化方向 + magnitude 推杆量，手柄摇杆可轻推慢走），拿不到再退回逐键判断。`getMoveAxis` 不存在时（旧 InputManager / 测试替身）走兜底分支，测试不受影响。摇杆同时补出数字方向键（`up/left` 等），让只读 `isKeyDown('up')` 的朝向/动画代码也能跟随。

驾驶席不得另建输入旁路：`MovementSystem.setMoveIntentRouter()` 将同一个 axis/右键移动 intent 交给 `VehicleSystem.routeIntent()`；driver 路由到载具 MovementComponent，未乘载具或非 driver 仍路由到玩家。这样键盘、Android 虚拟摇杆、手柄左摇杆和 PC 右键点位移动共享同一移动提交链；右键只提交原始点位，不因碰撞自动执行 A* 绕障。

### 7. 组合键热键用 registerHotkey 的修饰键选项
`registerHotkey(id, keys, cb, { ctrl, shift, alt })`。需要组合键时用这个选项，不要另写 keydown 监听。

- 判定在 `InputManager._modifiersSatisfied()`，只读 `this.keys`（**纯键盘状态**），不用 `isKeyDown()`。
- 原因：`isKeyDown()` 会并入手柄虚拟键，若项目把手柄按钮映射成修饰键，会误触发组合键。
- 需要屏蔽浏览器默认行为时，`handleKeyDown` 里按组合条件 preventDefault（如 `key === 'X' && event.ctrlKey`），不要整键拦截，否则该单键就被游戏吃掉了。
- 调试/工具类入口优先放调试面板按钮，不要占用键盘键位（手柄按键图就是这么处理的）。

### 8. 物理字母键在采集边界统一归一化
`InputManager` 对 `KeyboardEvent.code` 为 `KeyA`–`KeyZ` 的按键统一生成小写字母虚拟键，再应用 `keyMap`。禁止各业务消费者分别兼容 `e/E`、`q/Q` 等大小写；Caps Lock、Shift 和中文输入法不得改变游戏操作键，修饰键语义继续由独立 modifier 状态表达。`keydown` 与 `keyup` 必须调用同一个归一化入口，避免按下后无法释放。

## 平台支持

| 宿主 | 支持度 |
|---|---|
| web / electron | 完整（Chrome/Edge 下 Xbox 360 走 XInput，standard 映射） |
| capacitor(Android WebView) | 按钮/摇杆可用，震动多数机型不支持 |
| weapp(微信小游戏) | 无 Gamepad API，`isSupported()` 返回 false，全部降级 |

浏览器安全策略：手柄插上后需**先按一次任意键**才会出现在 `navigator.getGamepads()` 中。

## UI（GamepadPanel）

- HUD 常驻小指示：手柄连接即在左下角显示 🎮 + 手柄名，不受面板 `visible` 影响。
- 完整面板：由**调试面板**（反引号 `` ` `` 打开）里「手柄」分组的「🎮 Xbox 360 按键图」按钮切换，不占用键盘热键。左半画手柄图（摇杆帽随推杆偏移、按下的键呼吸高亮），右半是按键→功能映射表。
- 纯 Canvas 绘制无图片依赖（微信小游戏也能画）。面板内点击一律消费，防穿透。
- 手柄面板**不注册任何键盘热键**。F1 被系统/浏览器帮助占用，Ctrl+F1 也易与外部软件冲突，因此入口放在调试面板：
  - `DebugPanel` 的「手柄」分组里有 `#dp-gamepad-panel` 按钮，点击调 `scene.gamepadPanel.toggle()`；同组的 `#dp-gamepad-state` 每帧显示连接状态（读 `inputManager.gamepad.isConnected()` 与 `.info`）。
  - `InputManager.handleKeyDown` 的 preventDefault 白名单**不含 F1**，F1 完整交回系统。

## 默认按键映射

```
左摇杆/十字键  移动；Y 蓄力期间仅控制跳跃落点方向
RT 按住  攻击（快按=面向攻击；长按+右摇杆=精确朝向，松开释放）
RB 按住  释放当前所选技能（右摇杆瞄准，松开释放）
LB       切换技能（按住弹出环形轮盘；轻功、投掷也在轮盘中）
Y 按住  蓄力跳跃；松开起跳，蓄力时左摇杆控制落点
B        默认未绑定
LT 按住  格挡（按住期间生效，有时效/冷却）
A        拾取/交互/采集/确认对话
X        拾取/交互/采集/确认对话
十字键↑  红药水    十字键↓  蓝药水
Back 背包（属性+装备+物品）
Start 系统设置/登录菜单（默认绑定 `settings`，游戏内打开时自动存档并暂停）
RS 取消选中
按键图入口：调试面板（反引号打开）→ 手柄 → 🎮 Xbox 360 按键图
```

### 操作模型（三端同构）

| 操作 | PC | 手机 | 手柄 |
|---|---|---|---|
| 普通攻击 | 鼠标左键（方向=鼠标位置） | 攻击按钮按住→拖拽方向→释放 | RT 按住→右摇杆方向→释放 |
| 技能 | 数字键进入瞄准→鼠标指向→左键确认 | 技能按钮按住→拖拽→释放 | LB 选择轮盘项，RB 按住→右摇杆指向→释放 |
| 跳跃 | 空格按住蓄力，松开起跳 | 跳跃按钮按住蓄力，虚拟摇杆控制落点 | Y 按住蓄力，松开起跳；仅蓄力期间左摇杆控制落点 |
| 轻功 | Ctrl 进入瞄准→鼠标指向→左键确认 | 轻功按钮按住→拖拽位置→释放 | LB 选择“轻功”，RB 按住→右摇杆控制→释放 |
| 投掷 | Shift 进入瞄准→鼠标指向→左键确认 | 投掷按钮按住→拖拽方向→释放 | LB 选择“投掷”，RB 按住→右摇杆指向→释放 |
| 格挡 | Q 按住 | 格挡按钮按住 | LT 按住 |
| 切换技能 | 数字键直选 | 点击技能按钮 | LB 环形轮盘 |

### 环形轮盘（LB 技能选择器）

- LB **持续按住 200ms** 后弹出环形 UI（以玩家为中心），显示所有可用技能图标
- 右摇杆推向目标技能方向 → 高亮该技能
- LB **松开** → 确认选择，关闭轮盘，HUD 更新当前技能
- 轮盘开启期间通过 `isSkillWheelWorldPaused` 冻结世界模拟：ECS、移动、AI、战斗、剧情、计时器与环境更新均停止；**不得**改写 `isPaused`，`SceneInputFlow` 必须继续在帧首 poll 手柄，以便读取 LB 松开沿并解除暂停
- 快按 LB（< 200ms 无推杆）= 顺序切到下一个技能（不弹轮盘，适合快切）

### 攻击判定

- RT 快速按放（< 150ms）：本次按住期间有有效 RS 时按该方向攻击，否则按角色当前面向攻击
- RT 长按：进入攻击蓄力态，脚下显示扇形预览并缓存最后有效 RS 单位方向，松开只释放一次
- RS 回到死区不清除本次 RT 已缓存方向；整次按住均无有效 RS 时才回退角色面向
- 手柄断连、模态/弹窗接管、玩家硬锁或场景退出会取消本次攻击，不得在恢复输入后补发

### 自瞄技能特殊处理

`range === 0` 的技能（heal / meditation）在 RB 按下瞬间直接释放，不进入瞄准态。

`GamepadManager.setBinding(buttonIndex, key)` 可运行时改绑定；构造时传 `options.bindings` 覆盖默认。

## 编辑器绑定配置（UIEditor 手柄标签页）

UIEditor 的第三个标签页 `🎮 手柄`：
- 左侧表格：每个手柄按钮一行 + 下拉选择可绑定动作（分组：战斗/移动/技能/快捷/面板/其它）
- 右侧：摇杆死区 + 扳机阈值数值输入
- 保存到 `config/gamepad.json`（与 UILayout.desktop/mobile.json 同目录）
- 游戏运行时由 `SceneInputBindings.register()` 读取配置并调用 `GamepadManager.applyConfig(cfg)`；`BaseGameScene` 不再自行实现 `_loadGamepadConfig()`

### 可绑定动作清单（Xbox360Profile.BINDABLE_ACTIONS）

`ATTACK_ACTION`（攻击，走虚拟鼠标）、`SETTINGS_ACTION`（系统设置/登录菜单）、`NONE_ACTION`（无）、以及所有虚拟键名。`ACTION_LABELS` 提供中文名快速查表。

### 攻击键可配置

绑定值为 `ATTACK_ACTION`（`'attack'`）的按钮走虚拟鼠标左键。可以把攻击从 A 改到 RT 等：
- `GamepadManager.getAttackButtons()` → 所有绑定为 attack 的按钮索引列表
- `GamepadManager.isAttackDown()` / `isAttackPressed()` → 查询

## Demo 主循环与帧守卫

张角 demo 不走 `GameEngine`（自建主循环），所以由 `SceneInputFlow.beforeFrame()` 在任何场景输入读取前统一调用 `pollGamepads()`：
- `DataDrivenPrologueScene.update` 在读取 E/N/反引号前调用 `_beginInputFrame(deltaTime)`
- `SceneFramePipeline.run` 也调用 `beforeFrame`；flow 的帧守卫会跳过同帧重复编排

**帧守卫**：`SceneInputFlow._frameStarted` 防止整套输入流程重复执行，`InputManager._padPolledThisFrame` 防止底层重复 poll。正常帧由 `SceneInputFlow.flush()` 清输入并重置；转场提前返回只调用 `releaseFrame()`，不得调用 `InputManager.update()`。

## 测试

`src/core/input/GamepadManager.test.js` 用假 navigator（`options.nav` 注入）覆盖连接/断开、按钮沿、扳机阈值、摇杆死区、虚拟键映射。手柄真机行为需实际设备验证。
