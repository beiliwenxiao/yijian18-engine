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

## 批次 5：军营粮草容器 + CargoTransferView 对接（已完成）

- 新增 `src/core/scene/CampStockContainerAdapter.js`：军营粮草容器适配器。`exportItems/loadItems` 满足容器契约；`buildSnapshot` 产出 CargoTransferView 快照（左「军团粮草」= armysupply.food，右「军营存粮」= camp.stock）；`transfer` 翻译为 `FoodLedgerSystem.deposit/withdraw`；`nextOperationId` 带 boot nonce，避免读档后序号重置撞旧账本。
- `SceneContainerInventoryRegistry`：新增**易失容器**（`registerVolatile`）——可 `resolve` / `nextOperationId`，但**不参与** `serialize/validate/restore`。这是不破坏旧档的关键：军营粮草权威在 `warState.logistics`，若把军营塞进旧档的 `containerInventories` 段，缺条目会让旧档校验直接失败。
- `SceneGameplaySystemAssembler`：装配时按 `logistics.camps` 播种军营，`scene.syncCampContainers/resolveCampContainer` 把每个军营注册为易失容器（注册表晚于装配创建时由 S01S02 补同步）；巷道 restore 后补同步；新增命令 `camp.register`、`camp.transfer`。
- `CargoTransferView`：左栏标题与「取回背包」按钮文案支持 `snapshot.inventoryLabel` 覆盖（缺省仍是「背包」，旧调用零变化）。
- 内容接线：`S02ArmyRescueFlow` 扎营完成即 `camp.register` 入库，并新增 `openCampSupply/handleCampSupplyCommand`（面板转移 → 账本存取 → 面板即时刷新）；`SanguoDomainCommandFacade` 增 `camp.openTransfer` 场景命令入口；`DataDrivenPrologueScene` 的 `CargoTransferView.onCommand` 增军营分支。
- 决策：军营面板只开放粮草——`deposit/withdraw` 对非食物资源没有扣减来源，放开会让资源凭空增减；面板左栏代表**军团随身粮**而非玩家背包（军营存取的对手方是军团编制）。
- 测试：`CampStockContainerAdapter.test.js` 8 例 + `SceneContainerInventoryRegistry.test.js` 4 例全绿。
- 遗留：`src/systems/items/ItemRuntimeFactory.test.js` 1 例失败为仓库既有问题（并行提交 `d47bf3c2` 的物品 capability 校验，未触碰本批文件），已在回报中标注。

## 批次 6：最终回归与汇总

- 提交序列：`3e11c69b`（系统挂载/命令/AI 适配）→ `f56de73c`（warState.logistics 存档）→ `d09f742c`（粮草条/城池卡）→ `ff3c4116`（战果卡/接管身份）→ `095c9c08`（军营容器/存取面板）。
- 最终回归：`src/core/scene` + `src/ui` + 五个军需领域服务测试 = **37 文件 / 376 例全绿**。
- 零回归承诺：`CHECKPOINT_SCHEMA` 未改；旧档缺 `warState.logistics` 子段走空态；`containerInventories` 校验路径未改（军营走易失容器）。`vitest.config.js` 与并行会话文件全程未提交。
- 偏差清单：
  1. 军营粮草条展示「存粮 N」而非「还剩 N 日」（军营无消耗主体）。
  2. 军营存取只开放粮草（非食物资源无扣减来源）。
  3. 战果卡接管身份只提供「接管/观战」；「随军」需本人到场，不在战果卡提供。
  4. 军营面板左栏代表「军团随身粮」，不是玩家背包。
  5. `camp.openTransfer` 目前是场景命令入口（供剧本/交互调用），未新增世界交互按键。
- 已知仓库既有失败（与本轮无关）：`src/systems/items/ItemRuntimeFactory.test.js > 非法 capability 发布 > DefinitionRepository 在发布前拒绝依赖缺失`。
