# M3 执行清单（随行小队 + 武装单位/指令 + 存档与倒地掉落）

> 依据：[spec.md](spec.md) · **状态：3A/3B 已完成（2026-11-10），3D 待开工**
> 每批完成勾选；M3 全绿后再一次性提交，只含本里程碑文件。

## A. 数据与 schema

- [x] `CanonicalSchemas.js`：`ARMY_STATE_SCHEMA`、`COMPANION_SQUAD_SCHEMA`；`GAME_PROJECT_SCHEMA` 加 `armyOrders` / `companionRule`
- [x] `game.project.json`：`companionRule`（初值/补位 8s/charge 4s/10×10/士气表）；`armyOrders` 随 3B 落地
- [x] `CommandStateComponent.js`：`ARMY_STANCES` 补 `escort`/`charge`（追加在末尾，保序零回归）
- [x] 文档偏差登记：`ranks` 事实源沿用 `library.json`（03 §3.1 过期表述）

## B. 3A 随行小队（第 1 批）

- [x] `CompanionSquadSystem.js`（容量/五档/士气账/补位/charge 4s/快照）
- [x] `SceneCompanionSquadFlow.js`（实体登记/补位生成/HUD/1-5 键/escort 跟随）
- [x] `CompanionGridHud.js`（10×10 + 五档行 + 状态）
- [x] `ArmyCommandSystem.js`：`charge` 档参数 + `getCompanionGridOffset` 阵型偏移导出 + `applyStanceToArmy`（军团选择排除 companion 防双源）
- [x] 押运队薄适配：`convoy.assemble` 可选生成载具 + 护卫登记（缺省不变）
- [x] 载具落点校验（§6.1）：`resolveSpawnPosition` 适配器 + 就近可站立点 + `vehicleSpawnBlocked` 失败返回
- [x] `CompanionSquadSystem.test.js` / `CompanionGridHud.test.js`
- [x] M2 24 例回归（assemble 缺省行为）

## C. 3B 武装单位与指令（第 2 批）

- [x] `ArmyOrderSystem.js`（armyStates/五指令/战略刻/部署 commit+temp+锁/将令/快照）
- [x] `SceneArmyOrderFlow.js`（同步/刻驱动/遭遇委托/命令桥）
- [x] 命令：`unit.order`、`unit.order.cancel`、`unit.setFormation`、`army.deploy.commit`、`army.deploy.temp`、`battle.deploy.lock`、`unit.battleOrder`、`army.form`、`army.disband`
- [x] 事件：`unit.orderIssued/Completed/Failed`、`army.deployLocked`、`army.battleOrderIssued`
- [x] 将令身份单点解析 `_resolveBattleIdentity` + **显式 TODO(M6)**（support 映射与允许集合放宽点）
- [x] `ArmyOrderSystem.test.js`
- [x] 接线：`transport` → `convoy.load`+`dispatch`；`camp` → 既有建造命令
- [x] 3A 顺延：补位实体重生成（蓝图缓存 + `spawnCompanionMember` 适配器 + 倒地成员不移出名册）

## D. 3D 存档与倒地掉落（第 3 批）

- [ ] 快照 provider `gameplay.armyStrategic`（**可选**，旧档缺省空态）
- [ ] `DownedDropService.js` + `inventory.dropAll`（1~3 件/穿戴 excl/`cause:'story'` 豁免/`ownerId`+2 天/夺回）
- [ ] `LootPickupBehavior.js`（NPC 拾取 + `_carriedLoot` + 击杀返还）
- [ ] `CombatSystem` 倒地入口单点钩子
- [ ] `DownedDropService.test.js` / `LootPickupBehavior.test.js`

## E. 内容与接线

- [x] `SceneGameplaySystemAssembler.js`：`gameplay.companion`(509) + 命令 + fields/dispose（`gameplay.armyOrder`(510) 随 3B）
- [x] `SanguoGameLoaderCoordinator.js`：companion 规则/统率/官职适配器（军/战/载具完整适配随 3B/3D）
- [x] `M3Content.test.js`（配置/官职/状态 schema）
- [ ] 场景集成：五档 + 护主；押运队装配→装车→出发→卸货；读档后继续下令

## F. 验收与回报

- [ ] 三批测试全绿
- [ ] 全量 `npx vitest run` 与基线对比（存量 7 文件 12 例失败），M3 无新增失败
- [ ] M3 完成回报（含顺延项与遗留）
- [ ] 仅提交本里程碑文件（不含 `vitest.config.js`）

## 实施记录

### 3A（2026-11-10，已完成）

- 新增：`src/systems/CompanionSquadSystem.js`、`src/ui/CompanionGridHud.js`、
  `src/core/scene/SceneCompanionSquadFlow.js` 及三个测试 + `src/core/M3Content.test.js`。
- 改：`CommandStateComponent`（姿态补 escort/charge，追加保序）、`ArmyCommandSystem`
  （charge profile 1.6x、`applyStanceToArmy`、`getCompanionGridOffset`、选择/点选排除 companion）、
  `ConvoySystem`（载具生成 + §6.1 落点校验，失败 `vehicleSpawnBlocked` / `vehicleSpawnUnavailable`）、
  `SceneGameplaySystemAssembler`（companion 系统/HUD/命令/fields/dispose + 载具生成与可通行校验适配）、
  `SanguoGameLoaderCoordinator`（companion 规则与统率/官职提供器）、`CanonicalSchemas`、
  `game.project.json.companionRule`。
- 测试：3A 相关 53 例全绿（CompanionSquad 10 / HUD 4 / Convoy 16 / M3Content 5 /
  M2Content 7 / Supply 11）；`test/armyCommandSystem.test.js` 39 例回归全绿。
- 已知遗留：3A 只做"护卫 AI 跟随"（复用 escort 姿态），未做武装单位/五指令（3B）；
  补位依赖同名实体存在（缺实体则放弃并已由领域层记账），实体重生成随 3B/3D。

### 3B（2026-11-10，已完成）

- 新增：`src/systems/ArmyOrderSystem.js`（armyStates 四 kind / 五指令 + 战术撤军 /
  500ms 战略刻 / 部署 commit+temp+接战锁 / 将令身份单点判定 / operationId 幂等 / 快照）、
  `src/core/scene/SceneArmyOrderFlow.js`（实体聚合同步 / 刻驱动 / 四执行器 /
  姿态下发 / blackboard.armyStates 入档与还原）、`src/systems/ArmyOrderSystem.test.js`。
- 改：`SceneGameplaySystemAssembler`（armyOrder 系统与 flow 构造、`gameplay.armyOrder` 共享系统
  order 510 + fields 投影 + dispose、9 条命令桥、`_spawnCompanionMember` 补位重建适配器）、
  `SceneCompanionSquadFlow`（成员蓝图缓存、倒地成员不出名册、补位走实体重建）、
  `SanguoGameLoaderCoordinator`（armyOrders 配置 + battleAgent/formationExists/getDay 适配）、
  `CanonicalSchemas.ARMY_STATE_SCHEMA`（全字段）、`game.project.json.armyOrders`、
  `M3Content.test.js`（3B 三例）。
- 测试：3B 22 例全绿（ArmyOrderSystem 14 / M3Content 8）；回归 10 文件 98 例全绿
  （CompanionSquad 10 / Supply 11 / Convoy 16 / HUD 4 / armyCommand 39 / M2Content 7 /
  ColdRestartReplayHarness 1 / armyDefaultStance 5 / RealCanonicalColdRestartReplay 5）。
  未改 `vitest.config.js` 与测试环境声明。
- 3A 顺延闭合：补位不再要求同名实体存在——首次登记缓存蓝图，实体被清理后
  `scene.spawnCompanionMember` 经 EntityFactory 重建友军实体（含 SquadMember/CommandState），
  成功即 `registerUnit` 接管；倒地成员实体消失只保留名册待 8s 补位，不入 dismiss。
- 已知遗留：`_resolveBattleIdentity` 目前按 BattleMode 推断（takeover/observe/unknown），
  M6 落地 support 身份时按文件内 TODO(M6) 三处改动；场景集成（读档后继续下令的实机验收）随 3D。
