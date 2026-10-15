---
inclusion: manual
---

# 拾取与交互统一入口

## 拾取的四种触发方式（走同一套逻辑）

游戏中拾取地上物品有四种触发方式，全部复用 `PickupSystem` 的**范围拾取**（拾取玩家 `pickupRadius` 内的物品）：

1. **E 键**（PC 键盘）— `PickupSystem.update()` 检测 `isKeyDown('e')`
2. **交互按钮**（移动端）— index.html 里 `data-act="interact"` 按钮调用 `tapKey('e')` 模拟按 E
3. **触屏**（移动端）— 同交互按钮，`tapKey('e')`
4. **PC 左键点击物品** — `BaseGameScene.handlePickupClick()` 命中物品图标后调用 `PickupSystem.triggerPickup()`

## PickupSystem 结构（src/systems/PickupSystem.js）

- `update(...)`：检测 E 键 → 调用 `_tryPickup()`
- `triggerPickup(playerEntity, pickupItems, equipmentItems)`：外部触发一次拾取（PC 左键点击用），→ `_tryPickup()`
- `_tryPickup(...)`：核心逻辑（冷却检测 + 范围内批量拾取），E 键和左键共用

新增其它拾取触发方式时，统一调用 `triggerPickup()`，不要复制拾取逻辑。

## PC 左键点击拾取（BaseGameScene）

- `tryClickPickup(worldX, worldY)`：检测点击世界坐标是否命中可拾取物品图标（命中半径 30px），命中则触发范围拾取并移除掉落物实体
- `handlePickupClick()`：包装左键判定，命中物品时 `markMouseClickHandled()` 阻止本次左键攻击/投掷

### 关键坑：拾取判定必须在攻击判定之前
`MeleeAttackSystem.update()` 内部用 `isMouseButtonDown(0) && !isMouseClickHandled()` 触发攻击。而 `meleeAttackSystem.update()` 在 `handleUIClick()` **之前**调用。因此左键拾取判定 `handlePickupClick()` 必须放在 `meleeAttackSystem.update()` **之前**执行，命中物品时提前 `markMouseClickHandled()`，否则会先触发攻击。

调用顺序（BaseGameScene.update）：
```
updateMouseAngle → handlePickupClick() → meleeAttackSystem.update() → ... → handleUIClick()
```

### 安全条件
`handlePickupClick()` 在以下情况不拾取：
- 右键（移动，`getMouseButton() === 2`）
- 对话激活（`dialogueSystem.isDialogueActive()`）
- 背包/装备面板打开（点击交给 UI 处理）

## 鼠标操作约定（PC）
- **左键**：点物品 → 拾取；点空白 → 攻击（MeleeAttackSystem）
- **右键**：移动到目标位置（MovementSystem）
- **Ctrl+左键**：轻功瞬移（FlightSystem）
- **Shift+左键**：投掷武器

## 世界坐标获取
点击世界坐标优先用 `this.camera.screenToWorld(screenX, screenY)`，相机不存在时回退 `inputManager.getMouseWorldPosition()`（与 `_debugRightClick` 一致）。


## 获得物品弹窗

### 功能
已提交入包的装备（`equipment`）、可使用物品（`consumable && usable`）和工具（`tool`）进入 `SceneItemGainedFlow` FIFO 弹窗。窗口显示图标、名称、描述和装备对比，并按物品能力提供动作：

- 装备：`立即装备`、`放入背包`、`丢弃`。
- 可使用物品：`立即使用`、`放入背包`、`丢弃`。
- 工具或无立即操作物品：`放入背包`、`丢弃`。

“放入背包”只确认并继续下一件，绝不重复执行入包事务；“丢弃”统一提交 `item.drop`，由权威事务移除本次获得数量、创建地面物品，并仅在 checkpoint/state revision 成功后发布 `item.dropped`。立即装备/使用同样只经 `item.equip`/`item.use` 权威命令，禁止弹窗直接修改库存、角色属性或装备。

### 组件 `src/ui/ItemGainedPopup.js`（继承 UIElement）
- 正式 API：`show({ item, comparison, actions, remaining })` / `hide()`；`actions` 最多三个 `{ label, color, onClick }`，按数量均分按钮宽度。
- 旧 `primaryLabel/onPrimary/onStore/showStore` 仅作兼容转换；新代码必须使用 `actions`。
- `comparison`：`[{ name:'攻击', diff:+3 }, ...]`，diff>0 涨红↑、diff<0 跌绿↓。
- 复用 `ItemIconRenderer.drawIcon()` 绘制图标；`handleMouseClick` 负责动作命中并拦截弹窗范围内点击，防止穿透世界。

### 触发与队列
1. 物品必须先经 `ItemLifecycleService` 完整提交到库存，再通过 `item.picked` 的 application event 调用 `SceneItemGainedFlow.onItemGained(item, player)`；奖励同样在其权威库存事务提交后才可调用。
2. 每件物品先显示“获得”通知，再加入 FIFO；仅当当前弹窗不可见时显示队首。
3. 点击立即装备、立即使用或丢弃时，`SceneItemGainedFlow._advanceAfterDecision()` 先隐藏当前弹窗、等待对应命令完成，再显示下一件，避免同一角色的命令并发。失败仍保留已提交库存，并继续处理下一件。
4. 队列耗尽时隐藏弹窗并调用 `gainedPopupClosed` 流程回调；该 UI 回调不是库存成功的业务证据。

### 关键约束
- 弹窗中所有业务动作复用 `BaseGameScene.submitItemIntent()` → `CommandGateway` → `LocalAuthorityAdapter`；不创建第二条库存、装备、使用或丢弃路径。
- 装备成功的最终变化仍经 `BaseGameScene.onEquipmentChanged(messages, info)` 发出；使用和丢弃的表现只消费对应 committed application event。
- 对无 `instanceId` 的可堆叠物品，丢弃数量取本次获得数量；因同定义堆叠没有物理实例边界，不能承诺从既有堆叠中区分具体来源。

## 掉落物/无图源实体：sprite 图源留空避免刷警告（通用规则）
`renderEntity` 的序列帧分支条件是 `sprite.spriteSheet` 为真时才 `getAsset()`。若给实体设了**不存在的占位图名**（如 `'loot_sprite'`、`'npc_sprite'`），会每帧 `getAsset` 失败刷 `AssetManager: Image 'xxx' not found`。
**规则**：实体无真实图片来源时，`SpriteComponent` 的图源一律传空字符串 `''`（不要用占位名），使 renderEntity 跳过图片分支，落到 renderStyle 代码立绘 / 占位色块 / `renderPotionSprite`(loot) 等分支。
已修复点：`EntityFactory.createNPC`（无图→''）、`PickupSystem.createLootEntity`（`'loot_sprite'`→''）。`createProp` 本就用 `|| ''`。
