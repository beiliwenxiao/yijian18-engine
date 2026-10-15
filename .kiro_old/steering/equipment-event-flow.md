---
inclusion: fileMatch
fileMatchPattern: '{**/BaseGameScene*,**/SceneInventoryFlow*,**/SceneEquipmentFlow*,**/ItemLifecycleService*,**/PlayerInfoPanel*,**/BackpackPanel*,**/InventoryPanel*,**/EquipmentSystem*,**/DataDrivenPrologueScene*}'
---

# 装备变更事件流

## 统一出口

所有装备/卸下操作最终必须走 `BaseGameScene.onEquipmentChanged(messages, info)` 出口，否则数据驱动事件源 `equipItem`/`unequipItem` 不会发出。

## 面板交互与命令路径

| 路径 | 调用链 | 交互约定 |
|---|---|---|
| 背包快捷装备 | `InventoryPanel.handleSlotLeftClick → onIntent('item.equip') → BaseGameScene.submitItemIntent → CommandGateway` | 仅桌面左键保持直接装备的快捷行为；UI 不直接改库存或装备组件。 |
| 统一物品操作菜单 | `InventoryPanel.requestItemActionMenu` / `PlayerInfoPanel.handleMouseClick → BackpackPanel.openItemActionMenu → BackpackPanel._activateMenuAction` | 桌面右键、移动端短按、手柄焦点上的 A/X 均打开同一菜单；背包装备显示“装备、丢弃”，已装备物品显示“卸下”。 |
| 装备槽快捷卸下 | `PlayerInfoPanel.handleMouseClick → BaseGameScene._handleEquipmentSlotClick → SceneInventoryFlow.unequip → onIntent('item.unequip')` | 仅桌面左键保持直接卸下；菜单中的“卸下”仍走同一权威命令。背包满时命令零修改并显示容量反馈。 |
| 拾取弹窗点“装备” | `SceneItemGainedFlow → item.equip → CommandGateway` | 与背包菜单的“装备”共用同一权威事务与装备变化出口。 |

`BackpackPanel` 是背包、装备槽、菜单与手柄焦点的唯一 UI 所有者。菜单只保存 `{ kind, itemId, instanceId, slotIndex?|slotType? }` 稳定身份，异步命令完成前不得保留渲染坐标或物品对象引用。其 `handleInput()` 必须从 `SceneInputFlow.onModalInput()` 进入，以优先消费键鼠、触屏和手柄输入，禁止另建设备旁路。

无 `PanelLayout` 的回退状态下，`PlayerInfoPanel` 与 `InventoryPanel` 必须分别使用组合 `BackpackPanel` 的 character/inventory 命中分区；有各自 section 部件时才共享组合面板设计坐标。section 包围盒由全部部件并集生成，inventory 的标题或横向分隔线可能与 character 装备槽区域重叠，因此鼠标点击必须先路由 character，再路由 inventory；否则 `InventoryPanel` 会在空白处返回已消费，使装备槽收不到右键。真实背包格应位于 character bounds 之外。`PanelLayout` 的加载不得被 `UILayout` 失败或缺失短路。`InputManager.getMouseButton()` 在 `mouse.clicked` 生命周期内必须保留按下时的按钮值，避免 `mouseup` 把右键误判为左键。

`SceneInventoryFlow` 只负责 UI 输入准入、命令提交后的面板重绑和容量失败反馈；不得在 `PlayerInfoPanel`、`InventoryPanel` 或 Demo 场景中直接调用 `EquipmentComponent` / `InventoryComponent` 改写业务状态。

## 真实属性与只读投影

- `StatsComponent` 与 `EquipmentComponent` 是角色当前属性和装备的实时事实源。`PlayerInfoPanel`、组合面板中的 `InventoryPanel` 必须优先读取 live 组件；`itemLifecycle` projection 只在实体缺少对应组件时作只读回退，不能用命令时刻的旧投影覆盖伤害、成长、读档或装备提交后的新状态。
- `EquipmentSystem` 在改变槽位前捕获旧装备总加成，槽位提交后以“新加成 - 旧加成”差量更新 live Stats。禁止通过 `resetToBaseStats()` 重建装备属性，因为该方法会清除职业/成长 `attributeEffects`；元素攻防同样必须按差量更新，避免重复装卸累积。
- 非载具移动以 live `StatsComponent.speed` 为速度事实，并在其上应用可选状态效果；载具继续使用自己的 `MovementComponent.speed`。不得为了同步面板再复制一份角色属性到 UI 或 MovementComponent。
- 属性差量必须留在装备领域 commit 内，与槽位和库存一起被 `ItemLifecycleService` 的 actor/equipment 快照回滚；`onEquipmentChanged` 仍仅作提交后的事件与表现出口。

## 原子装备与卸下边界

`ItemLifecycleService` 是 `item.equip` 与 `item.unequip` 的唯一领域入口：

- 装备按 `(itemId, instanceId)` 从库存定位，使用 `SceneEquipmentFlow.resolveSlot()` 和 `EquipmentComponent` 最终校验确定真实槽位；替换旧装备、自动卸下冲突弹药、checkpoint 或 revision 任一步失败均必须回滚。
- 卸下先预检背包完整容量，再移出真实槽位并加入背包；容量不足时必须保留原装备，不能产生半完成状态。
- 成功时 `ItemLifecycleService` 必须提交 `preparedStateRevision` 并返回相同的 `stateId/stateRevision`。其 UI、trigger 与表现 `finalize` 必须作为 `postCommit` 交给 `LocalAuthorityAdapter`，仅在 revision 校验、提交后事件发布和 operation ledger 封账后 best-effort 执行；不得在 handler 返回前同步调用 `BaseGameScene.onEquipmentChanged()`，否则内容回调若恢复 authority 快照会使已提交 revision 在校验窗口被覆盖。`postCommit` 抛错只记录诊断，不得把已经提交的命令改为失败。`info` 形态固定为 `{ slot, item, oldItem, action:'equip'|'unequip' }`。

## DataDrivenPrologueScene.onEquipmentChanged

- 装备时 fire `'equipItem'`，卸下时 fire `'unequipItem'`（分开事件，避免卸下武器误触发刷怪）。
- 真实槽位 `mainhand` 归一化为内容侧逻辑名 `weapon`（触发器配置用 `weapon`）。
- 优先用 `info.slot`/`info.item`，没有时才兜底推断。

## EquipmentSystem API

`EquipmentSystem` 仅由 `ItemLifecycleService` 等领域流程调用：

```js
equipmentSystem.equipItem(entity, slotType, equipment)  // → 被替换的旧装备 | null
equipmentSystem.unequipItem(entity, slotType)           // → 被卸下的装备 | null
```

UI 不得调用不存在的 `equipmentSystem.unequip`，也不得以该 API 绕过库存预检、checkpoint、state revision 或事件出口。

## 槽位名映射

| 内容侧/编辑器 | EquipmentComponent 真实槽位 |
|---|---|
| weapon / mainhand | `mainhand` |
| shield / offhand / ammo | `offhand` |
| armor | `armor` |
| helmet | `helmet` |
| necklace | `necklace` |
| accessory | `accessory` |

槽位映射唯一由 `SceneEquipmentFlow.resolveSlot()` 维护；`InventoryPanel` 只提交物品身份，不得复制 `slotMap`。
