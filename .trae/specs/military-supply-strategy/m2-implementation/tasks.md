# M2 配给与押运 · 执行清单

> 依据：[spec.md](spec.md) · 完成后在本文件勾选并追加「实施记录」

## A. 数据与 schema

- [x] `CanonicalSchemas.js`：新增 `CONVOY_SCHEMA`；`GAME_PROJECT_LIBRARY_SCHEMA` 加 `convoys`；`GAME_PROJECT_SCHEMA` 加 `supply`
- [x] `Registry.js`：`STANDARD_REGISTRY_KINDS` 加 `convoys`
- [x] `game.project.json`：新增 `supply` 块（额度表/修正项/负重/映射/ambush）
- [x] `library.json`：新增 `convoys[]`（convoy.light_cart → vehicle.s14.lastCart + 现有黄巾兵）

## B. 引擎系统

- [x] `src/systems/SupplySystem.js`（额度/共享池/订单/随身/取消/快照）
- [x] `src/systems/ConvoySystem.js`（装配/装车/出发/指令/卸货/伏击结算/追回/快照）

## C. 接线

- [x] `SceneGameplaySystemAssembler.js`：构造 + `gameplay.supply`(507) / `gameplay.convoy`(508) + fields + 命令注册
- [x] `SanguoGameLoaderCoordinator.js`：投影 `config.supply` / `config.convoy`
- [x] `ObjectiveTypeRegistry.js`：`supply.requisition` / `supply.escort`
- [x] 触发器事件白名单核查（application event 直通 `fireCoordinated` + `consumeTaskEvent`，无白名单，零改动）

## D. 测试

- [x] `SupplySystem.test.js`（11 例）
- [x] `ConvoySystem.test.js`（13 例）
- [x] `M2Content.test.js`（7 例：convoy schema / 模板引用 / supply 配置 / resourceItems / 两个任务目标类型）
- [x] 单测命令全绿
- [x] 全量 `npx vitest run` 无新增失败（存量 7 文件 12 例失败已在 HEAD 基线复现，见实施记录）

## E. 回报

- [x] M2 完成回报（含已知遗留：M1 触发器核查、M3/M4 物理生成、M6 伏击战斗、UI 接线）
- [x] 仅提交本里程碑文件

## 实施记录（2026-11-10）

1. **测试**：`SupplySystem.test.js` 11 例、`ConvoySystem.test.js` 13 例、`M2Content.test.js` 7 例全绿；
   `test/objectiveTypeRegistry.test.js` 的内置目录断言按 M2 新增目标类型更新（唯一被 M2 改变的存量断言）。
2. **全量回归**：`npx vitest run` = 176 通过 / 7 文件失败（12 例）。已用 HEAD 版本文件复跑基线，
   `taskGraphWoodProgress`(6) / `DefinitionRepository`(1) / `HostBackendDefaults`(1) / `ItemRuntimeFactory`(1)
   在基线上同样失败；两个 `gameEditorDataDrivenArchitecture*.property.test.js` 的 golden 差异只涉及
   `s_5_8~s_5_11` 场景与 S02 触发器命名，与 M2 无关。**M2 无新增失败**。
3. **与 spec 的差异**：
   - 任务目标 `supply.requisition` 的 identityFields 由 `items` 改为 `cityId` + `progressBy:'quantity'`
     （TaskGraph `shallowMatch` 精确匹配，`items` 对象不可命中），spec §4.3 已同步。
   - 未注册 SnapshotManager provider：旧存档缺 `gameplay.supply` 会被 required 校验拒绝，违反零回归；
     快照仅在系统 API 层（captureRuntime/serialize）提供，与 M1 production 现状一致。
   - `convoy.assemble` 未传 `cargoId` 时由 `vehicleEntityId` 派生 `${vehicleEntityId}:cargo`，
     保证快照往返后能重新绑定货舱。
4. **遗留（不属 M2）**：M1 `ProductionSystem` 的 captureRuntime/serialize 未接任何 checkpoint；
   配给所 UI 与 placement 未接；押运队载具/护卫物理生成归 M3/M4；真实伏击战斗归 M6；编辑器表单后置。
