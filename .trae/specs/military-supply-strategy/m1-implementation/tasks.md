# M1 实施任务清单（tasks.md）

> 上游：[spec.md](spec.md) · [m1-foundation.md](../m1-foundation.md)
> 执行方式：按 T01→T12 顺序，每个任务独立可验证；每完成一个跑对应测试。

| ID | 任务 | 落点 | 完成判据 | 依赖 |
|---|---|---|---|---|
| ✅ T01 | 配方数据 + 新物品 | `library.json`（recipes 2 条、`equipment.workshop.wooden_shield`、`currency.copper`） | `M1Content.test.js` recipes 断言通过；M0 用例同步 | — |
| ✅ T02 | 建筑 `stations[]` 透传与校验 | `ConstructionSystem._normalizeDefinition`、`game.project.json`（workshop/forge） | 旧 6 定义规范化结果不变；stations 唯一性校验用例通过 | — |
| ✅ T03 | `ProductionSystem` 骨架（craft） | 新 `src/systems/ProductionSystem.js` | 单测 12 例（预扣/不足/退料/幂等/占用/熟练度/站台/快照）全绿 | T01,T02 |
| ✅ T04 | 锻造分支 + RNG（1C） | `ProductionSystem` forge 分支 | 同种子同结果；失败三档返还正确 | T03 |
| ✅ T05 | 装配 `ProductionSystem` | `SceneGameplaySystemAssembler`（构造/注册 order 506/fields）、`SanguoGameLoaderCoordinator`（config.production + resolveStation） | 场景启动无异常；`scene.productionSystem` 可读；快照含 pending | T03 |
| ✅ T06 | S01 legacy 白名单分派 | `S01S02SceneFlow`：`LEGACY_WORKSTATIONS`、`_createRecipeSnapshot` 分派、`handleRecipeCommand` 分派 | 烤肉/制皮/兑换走旧路径；新 stationId 走 production | T05 |
| ✅ T07 | 生产场景入口与领取 | `S01S02SceneFlow`：`_startProductionAction`/`_updateProductionProgress`/`_collectProduction`/`handleAction('openProductionStation')` | 开工→进度→`craft.production.*`→`commitOutput`；取消退料 | T06 |
| ✅ T08 | `craft.production.*` 命令数据 | `commands.json` 追加 2 条 `batchAdd` 事务 | 命令可解析；产出入库 | T01,T07 |
| ✅ T09 | 装备耐久（P17） | `EquipmentComponent.getBonusStats`、`EquipmentSystem.consumeDurability`、`CombatSystem` 两处调用 | `EquipmentDurability.test.js` 全绿；未声明耐久零变化 | — |
| ✅ T10 | 装备修复服务 + handler 分流（1B） | 新 `src/systems/EquipmentRepairService.js`、`SceneGameplaySystemAssembler` 分流器 | 报价/材料不足/非 repair 工位/修满用例全绿；工具修复零变化 | T02,T09 |
| ✅ T11 | 箭矢消耗（P16） | 新 `src/systems/AmmoService.js`、`CombatSystem` 远程结算前接入 | 无配置不扣；按 perShot 扣；无弹跳过；NPC 计数 | — |
| ✅ T12 | `craft.item` 任务目标 + 事件 | `ObjectiveTypeRegistry`、`production.completed` 发布 | 目标类型注册；`production.completed` 驱动计数 | T03 |
| T13 | 全量回归 + 冒烟记录 | — | `npx vitest run` 全绿（基线 112 项不退）；手工冒烟 7 步通过 | 全部 |

## 提交边界
只纳入 M1 文件（见 spec §7）；不纳入 `.tmp-*`、`scripts/tmp-*`、动画/裙装等并行改动；未经确认不 commit。

## 补丁记录 · 生产快照接线（2026-11-10）

- [x] `createProductionSnapshotProvider` + `gameplay.production`（`required:false`）注册（装配器导出）
- [x] `ProductionSystem`：开工/完成/取消退料后请求检查点
- [x] `S01S02SceneFlow._adoptPendingProductionStation`：读档后接管恢复的工单
- [x] `ProductionSystem.snapshot.test.js`：5 例（存档→读档→继续同一工单 / 旧档缺段 / 段不可用降级 / SnapshotManager 往返 / 检查点触发与失败不阻断）
- 细节与已知窄窗口见 [spec.md](spec.md) §8。回归：core 43 文件 446 例、生产 17 例、S01 场景流 11 例全绿（唯一失败为存量 `DefinitionRepository` unreachableDialogue）。

## 后续里程碑锚点（2026-11-10）

- 步骤 1 已推 gitee：`c0bfd1b`(M2) / `8cce967`(3A) / `0d81ad5`(3B) / `dde1105`(3D)，fast-forward 无分叉。
- 步骤 2（本节补丁）已提交，哈希见回报。
- 步骤 3 = **M4 大地图指挥**，仅出范围与实施计划（[04-worldmap-command.md](../04-worldmap-command.md)），**等用户确认后再写代码**；进度锚点写在 `.trae/specs/military-supply-strategy/m4-implementation/`（计划文档产出前该目录不存在）。

