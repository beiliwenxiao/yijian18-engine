# 军需接线与 UI 批次（wiring-implementation）

> 目标：把已实现但不可玩的 M6/M7/M9 接到场景、存档与 UI。
> 计划：`.trae/documents/军需接线与UI批次-实施计划.md`。
> 约束：每批自带测试、零回归、不碰 `vitest.config.js`；方案取舍记在本文件。

## 决策记录

| # | 决策 | 理由 |
|---|------|------|
| D1 | 粮草权威 = `FoodLedgerSystem`；`ArmyOrderSystem` 单位仅提供初始 roster/morale，结算后回写 `supply/morale/manpower` | 避免两套库存双写；M9 已把 `army.supply.food` 作为单一事实源 |
| D2 | `aiSupplyEfficiency` 只在 `autoResupply` 适配器乘算；AI 判定 = `factionId !== 'yellow_turban'`，缺省 1.0 | M9 约定；不在服务内分叉规则 |
| D3 | 存档落点 = 黑板 `warState.logistics`（`foodLedger/cityAdmin/battleSettlement/reputation`），随 `checkpoint.warState` 落盘；另注册 `gameplay.warLogistics` provider 作为恢复顺序兜底 | 不改 `CHECKPOINT_SCHEMA`；旧档缺子键空态恢复 |
| D4 | 粮草条新增 `SupplyStatusBar`；城池卡/战果卡扩展现有组件 | 复用既有 UI 生命周期与输入 |
| D5 | 接管身份入口并入 `BattleResultView`（`entry` 命令），由 `SceneBattleRuntime` 转发 `BattleEntryService.joinBattle` | 战果/入场同屏 |
| D6 | 军营容器用适配器包 `camp.stock` 实现 `exportItems/loadItems`，`campId` 注册；存取走 `FoodLedger.deposit/withdraw` | 注册表只认 Inventory API；不复制库存 |

## 批次 1：系统挂载、配置与 AI 适配器（已完成）

- `game.project.json` 新增顶层 `logistics` 块（日耗/士气/逃散/烧掠/抢掠/军营容量 + `aiSupplyEfficiency: 1.0`）。
- `SceneGameplaySystemAssembler`：
  - 构造并注册 `gameplay.logistics`(513) / `gameplay.cityAdmin`(514) / `gameplay.battleSettlement`(515) / `gameplay.reputation`(516) / `gameplay.battleEntry`(517)，均带 `disposeHook`。
  - `fields` 投影 `logistics/cityAdmin/battleSettlement/reputation/battleEntry`。
  - 命令：`army.supply.deposit|withdraw`、`army.raze|forage|regroup`、`city.recruit|attack|transport|siege.begin|capture`、`battle.entry.join|leave`、`battle.settle`、`battle.supply.recover`、`battle.redeem`。
  - `armyLogisticsAdapter` 从 `ArmyOrderSystem` 取初始编制并回写；`scene.syncFoodLedgerArmies` 供日结后同步。
- `WarLogisticsAdapters.js`：`toLogisticsArmy` / `createArmyLogisticsAdapter` / `createAutoResupplyAdapter` / `createCityWarAdapters`。
- `SanguoGameLoaderCoordinator`：读取 `project.logistics`；构建五套系统配置 + 黑板 `warState` 读写适配（`battleLedgers`/`supplyCaches`）。
- 测试：`WarLogisticsAdapters.test.js` 6 例全绿；五个领域服务 82 例全绿。

## 批次 2：存档落点 `checkpoint.warState`（已完成）

- `WarLogisticsSnapshot.js`：`createWarLogisticsSnapshot` / `applyWarLogisticsSnapshot` / `readWarLogistics` / `writeWarLogistics`。
- 落点：黑板 `warState.logistics`（`schemaVersion + foodLedger/cityAdmin/battleSettlement/reputation`），随 `checkpoint.warState` 落盘；`SceneCityWarStateBridge` 的 project/write 原样透传，不覆盖 `battles/casualties`。
- 恢复：装配完成即从黑板回灌；`gameplay.warLogistics` provider（`required:false`）在恢复顺序不确定时用自己的段兜底。
- 旧档兼容：无 `warState.logistics` → 空态放行、不拒档；`CHECKPOINT_SCHEMA` 零改动。
- 测试：`WarLogisticsSnapshot.test.js` 6 例全绿（含真实 `FoodLedgerSystem` 往返）。

## 批次 3~5

（执行中补充记录）
