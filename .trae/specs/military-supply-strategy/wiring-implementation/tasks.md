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

## 批次 3：UI 批次 A（粮草条 + 城池卡）（已完成）

- 新增 `src/ui/SupplyStatusBar.js`：canvas 只读 HUD；`normalizeSupplyEntries/resolveSupplyTone/formatSupplyText` 为纯函数。军团显示「还剩 N 日」（∞ → 粮草充足），军营显示「存粮 N」；`<3 日` 或 `state !== normal` 转红（军营空库存转红）。
- `CityStateSummaryPanel`：默认高度按内容调整（非 compact 176 / compact 144）；`setSnapshot` 新增 `siegeStatus`、`stockDays`，仅在提供时渲染「城况」行，旧调用布局零变化。
- 接线：`S09RefugeeFlow.installSupplyStatusUI/updateSupplyStatus` 从 `FoodLedgerSystem` 投影（`queryDays` + camps）；`SanguoProgressionPresentationCoordinator` 与城市摘要并列安装；城市摘要读取 `cityAdministrationService.getCity` 的围城/存粮字段。
- 偏差：军营条目展示「存粮 N」而非「还剩 N 日」——`queryDays` 只对军团编制有意义，军营没有消耗主体；<3 日红色阈值沿用军团语义。
- 测试：`SupplyStatusBar.test.js` 5 例全绿（含城况行零变化）。

## 批次 4：UI 批次 B（战果卡 + 接管身份）（已完成）

- `src/ui/BattleResultView.js`：抽取纯函数 `buildBattleResultLines`（参战方式/接管身份/资源转移/城市损毁/战败账/逃亡账/散兵/辎重/时间推进）与 `buildBattleResultActions`（追回辎重取首个 cacheId、收拢散兵、非当前身份的接管切换）。动态高度与按钮行布局，`handleInput` 点击按钮 → `onCommand({type,...})`，继续按钮仍发 `close`。无军需字段的旧快照行数与文案零变化。
- `src/core/scene/SceneBattleRuntime.js`：`warLogistics` 端口（`recoverSupply/regroup/joinBattle/resolveArmy/describeBattle`）。`handleResultCommand` 转发到领域服务、成功后即时更新面板快照；失败码转中文提示；服务缺失静默降级。`_buildResultSnapshot` 把 `describeBattle` 的两本账/散兵/辎重/身份并入结果快照（战果冻结与重开两条路径）。`_resolveBattleArmy` 在无 battleId→armyId 映射时把 null 交给端口，内容层回落到玩家军团。
- `S03S14BattleCoordinator`：注入 `warLogistics` 端口；新增 `_describeBattleResult`（读 BattleSettlement 账本/辎重、FoodLedger 散兵池、BattleEntry 当前身份，身份选项 `takeover/observe`——support 需本人到场，不在战果卡提供）与 `_resolvePlayerArmy`（黄巾、非 AI 优先）。
- 决策偏差：散兵/辎重/身份均按玩家军团过滤（战果卡默认操作对象），而非全局；`regroup` 结果读取 `returned` 字段（服务实际返回名）。
- 测试：`BattleResultView.test.js` 6 例 + `SceneBattleRuntime.resultCommands.test.js` 5 例全绿；`src/ui` + `src/core/scene` 回归 30 文件 / 282 例全绿。

## 批次 5

（执行中补充记录）
