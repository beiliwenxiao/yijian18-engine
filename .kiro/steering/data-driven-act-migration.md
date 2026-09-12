---
inclusion: fileMatch
fileMatchPattern: '{**/DataDrivenPrologueScene*,**/BaseGameScene*,**/TriggerActions*,**/game.project.json}'
---

# 数据驱动幕迁移（Act 迁移）

## 现状

所有运行时场景统一由 `DataDrivenPrologueScene` 大地图运行时承载。当前新战役仅接受 canonical `S01`–`S14`（大战场附属 chunk 为 `SXX-CNN`），旧 `s0-0`、`s2-1`、Act 类名及其 alias 均已退出内容事实；场景推进只允许 `_scene_order.json` 中登记的 canonical ID 和 `teleportToChunk()`。

## 旧 Act3 内容状态

旧 `trg_enter_act3`、`coin_artifact_intro`、`s2-1` 等六幕剧情数据已从新战役事实中删除，不得作为实现参考或兼容目标。新内容触发器必须使用 `S01`–`S14`，并按“项目行为定义 + 场景空间 binding”统一模型重新制作。

## 放置点覆盖机制

同一个 NPC 库定义在不同场景可以有不同交互：
```json
{
  "type": "ref", "kind": "npc", "ref": "zhangjiao",
  "group": "act3_npcs",
  "overrides": { "dialogueId": "coin_artifact_intro" }
}
```

`DataDrivenPrologueScene` 不再定义 `_spawnGroup/_spawnPlacements` 或持有 `_placements`。所有调用统一进入显式注册的 `context.services.placements`（`ScenePlacementRuntime`），由它等待世界加载、校验引用，并委托 `PlacementSpawner` 执行定义合并和实体创建；场景只注入 Blackboard 数据源、玩家/相机、火堆位置消费者和 Demo coordinator。`SanguoPlacementCoordinator` 维护 `_npcEntities` / `_groupEnemies` 的剧情索引副作用，不修改 Scene prototype，也不拥有实体集合。

编辑器支持：SceneEditorUI 的 ref 属性面板对 npc 类显示"本处覆盖"分组（对话ID/商店ID/交互半径/交互方式），`data-prop` 处理器走 `overrides.*` 嵌套分支。

## 关键事件源（已在 BaseGameScene 中接好）

| 事件 | 触发位置 | 用途 |
|---|---|---|
| `itemUsed{id}` | `BaseGameScene.onItemUsed` | 铜钱剑使用 → 切幕 |
| `equipItem{slot,item}` | `DataDrivenPrologueScene.onEquipmentChanged` | 装备武器 → 刷野狗 |
| `dialogueEnd{id}` | `SceneGameLoaderBridge` 对 `dialogueSystem.onEnd` 的唯一订阅 | 对话结束 → 给物品 |
| `sceneComplete{sceneId}` | 数据驱动触发器 `fire('sceneComplete')` | 区块流程推进 |

以上事件表示**已成立事实**，不是输入尝试：物品事件只能在库存、地面对象、checkpoint 与 state revision 全部提交成功后发布；位置事件只能在玩家实际 Transform 进入目标范围后发布；NPC `interact` 只能在对话或商店成功启动后发布。`TriggerSystem.fire()/fireById()` 返回的是 accepted/consumed，不是业务成功；需要成功结果时必须使用 `fireAndWait()`、`triggerSucceeded` 或 ledger。

## 攀爬 surface 与空间 trigger

- `semanticRole:'climbSurface'` 的 `radius` 必须覆盖引用该对象的空间 binding `radius`；交互 binding 已命中时，攀爬目标二次解析不得因更小的默认半径拒绝。
- 具体场景攀爬动作要将“已在攀爬”作为幂等成功返回；目标缺失、剧情前置不足或 ClimbSystem 拒绝必须返回稳定 `code`，不得以裸 `false` 退化成通用动作拒绝。

## 运行时约束

- 默认入口和微信小游戏入口只注册 `DataDrivenPrologueScene`。
- 不再注册 `Act1Scene` 别名，也不允许回退到 `ActNScene` 类名。
- `BaseGameScene` 直接继承框架 `Scene`，不再加载 `ActXData.json` 或提供按幕切场景逻辑。
- `spawnGroup` 动作需要场景中有对应 group 的 ref 放置点。
- 场景归属、触发器和传送目标统一使用 canonical `S01`–`S14`；大型战场附属 chunk 仅使用 `SXX-CNN`。
