# M1 验收清单（checklist.md）

> 对应 [spec.md](spec.md) 与 [tasks.md](tasks.md)。逐项以代码事实与测试结果核对。

## A. 内容数据

- [x] `library.json` recipes 含 `recipe.wood_arrow`、`recipe.wooden_shield`，station 指向 `station.workshop.carpenter`
- [x] 配方 inputs/outputs 的 itemId 全部可在 items 解析（`wooden_arrow`、`equipment.workshop.wooden_shield`）
- [x] `equipment.workshop.wooden_shield` 声明 `durabilityMax/durabilityPerHit/brokenMultiplier`
- [x] `currency.copper` 物品存在
- [x] `commands.json` 存在 `craft.production.<recipeId>` 两条 batchAdd 事务
- [x] `game.project.json` 的 `construction.workshop` / `construction.forge` 带 `stations[]`

## B. 建筑工位

- [x] `ConstructionSystem` 规范化 stations：id 唯一、kind ∈ craft/forge/repair、workerSlots ≥ 1
- [x] 未声明 stations 的旧建筑规范化为 `stations: null`（零回归）
- [x] 非法 kind / 重复 station id 被拒绝

## C. 生产系统

- [x] `ProductionSystem.start` 预扣 inputs + 工钱（铜钱）后才建 pending
- [x] 材料/工钱不足拒绝且不扣库存
- [x] 取消/失败只退材料不退工钱；幂等（operationId）不重复扣/退
- [x] 单工位互斥、熟练度校验、工位可用性由注入的 `resolveStation` 决定
- [x] 配方必须在该工位 `station.recipes` 白名单内
- [x] 到点转 `ready`，`commitOutput` 成功才清 pending；提交失败保持 ready 可重试
- [x] 锻造失败由注入 rng 决定，同种子同结果
- [x] `captureRuntime/restoreRuntime/serialize/deserialize` 往返一致（含 operations）

## D. 场景装配与 S01 接入

- [x] `SceneGameplaySystemAssembler` 创建 `scene.productionSystem` 并注册 `gameplay.production`（order 506）
- [x] 默认 `resolveStation` 从 ConstructionSystem 已建成结构解析工位
- [x] `scene.ammoService` 创建并挂到 `combatSystem`
- [x] `item.repair` 外层按 `payload.kind === 'equipment'` 分流，`ToolRepairService` 内部未改动
- [x] S01 `LEGACY_WORKSTATIONS` 白名单：旧工位走旧路径，新工位走 production
- [x] S01 开工→进度→`craft.production.*`→`commitOutput`→提示；`openProductionStation` 可打开面板

## E. 耐久 / 修复 / 箭矢

- [x] 出手扣 `durabilityPerUse`、受击扣 `durabilityPerHit`；未声明耐久零变化
- [x] 耐久归零后装备加成按 `brokenMultiplier`（默认 0.5）折损
- [x] `EquipmentRepairService` 报价按缺口推导，材料不足/非 repair 工位/满耐久被拒绝
- [x] 修复成功扣材料、回填耐久、写 checkpoint、发 `item.repair.committed` + `item.durability.repaired`
- [x] 武器未声明 `ammo` 时 `AmmoService` skipped；声明时按 `perShot` 扣背包或 `entity.ammoCount`
- [x] 无弹时本次攻击不结算（冷却已推进，不卡死）

## F. 任务目标

- [x] `ObjectiveTypeRegistry` 注册 `craft.item`（matcherType `production.completed`，progressBy `quantity`，身份 `itemId`）
- [x] 产出入库后发布 `production.completed`，payload 含 `itemId/quantity`；失败发布 `production.failed`

## G. 测试与回归

- [x] `ProductionSystem.test.js`（craft 主链）全绿
- [x] `ProductionSystem.forge.test.js`（锻造 + RNG）全绿
- [x] `EquipmentDurability.test.js` 全绿
- [x] `EquipmentRepairService.test.js` 全绿
- [x] `CombatAmmo.test.js` 全绿
- [x] `M1Content.test.js` 全绿
- [x] M1 相关面回归：14 个测试文件 / 73 例全绿（生产、装备、修复、弹药、任务图、战斗）
- [x] 全量 `npx vitest run` 已跑完：188 文件 / 2265 例，耗时 1004s。**不存在挂起用例**——此前"卡住"是误判（我采样的是 npx 包装进程 PID，vitest 子进程一直在跑；该套件本身需 ~17 分钟，其中 environment 347s + prepare 282s 为 jsdom 逐文件环境开销，真正执行测试仅 75s）
- [x] 全量失败 27 例 / 14 文件，逐文件复跑归因：**无一条由 M1 引入**（诊断中发现的 2 条 M1 问题已修：`recipes` 缺 `schemaVersion` 导致内容校验失败；`test/objectiveTypeRegistry.test.js` 目录快照未含新增 `craft.item`/`interact.entity`）
- [x] 既有失败清单（非 M1）：`test/s02ArmyPossession|s02WoundDebuff|s02ZhangjiaoSkills`（node:test 文件被 vitest 收集，报 "No test suite found"）、`ErrorHandler`/`MapSystem`/`UnitSystem`（缺 jsdom 声明：window/requestAnimationFrame 未定义）、`DefinitionRepository`（S02 对话 unreachable，存量内容接线）、`gameEditorDataDrivenArchitecture*` 两个 Property 用例（场景 s_5_8~s_5_11 与 S02 触发器改名、JS 审计行数基线）、`taskGraphWoodProgress`（S01 任务节点 id 已改）、`ItemRuntimeFactory`（DefinitionRepository capability 依赖校验）、`HostBackendDefaults`（历史基线）、`FlightSystem.elevation`（单跑同样失败）

## H. 提交边界

- [x] 仅纳入 M1 相关文件；未夹带动画/裙装等并行改动
- [x] 未执行 `git commit`（等待用户确认）
