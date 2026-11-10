# M5 执行清单（阵法与地势）

> 依据：[05-formation-terrain.md](../05-formation-terrain.md) · 上游 master [tasks.md](../tasks.md)
> 施工约束：M1~M4 文件只做增量；不碰 `vitest.config.js`（并行会话）；每批自带测试。

## A. 5A 数据（M0 已铺底，本批补齐）

- [x] `library.json` 已有 14 阵型 / 14 武将 / 兵种表（M0 占位），不改既有 `strategy` 值
- [x] 规范策略模板落在引擎 `STRATEGY_TEMPLATES`（line/wedge/crane/fishscale/circle/echelon），
      历史值 `ambush/pursuit/three_lanes/siege/hold/retreat` 经 `STRATEGY_ALIASES` 映射，不产生告警
- [x] `FORMATION_SCHEMA` 补 `sceneTags` / `terrainPreference` / `stanceByRole` / `stackOffsets` /
      `rowSlots` / `source`；`HERO_SCHEMA` 补 `aura` / `deploySlot`
- [x] **偏差**：`rows` 在 schema 保持 INTEGER（M0 内容用 number + unitIds），结构化行定义放
      `rowSlots`，`FormationResolver` 两者同义读取（有单测锁定）

## B. 5B 部署（提交 `d746cdfd`）

- [x] `src/systems/FormationResolver.js`（新，纯函数）：策略归一、rows 三级来源（显式 / 旧数字 /
      模板）、`combat` 修正派生、`stanceByRole`、地形三态提示、非致命校验
- [x] `buildDeploySlots`（2.5D：行距 56 / 列距 44，窄行居中）+ `assignDeploySlots`（同兵种优先，
      超出槽位的实体 `slot=null` 不丢）
- [x] `BattlefieldRuntimeSystem.start` 可选 `formations` / `deployments`：按阵营解析、写
      `entity.deploySlot` / `formationStance`；`deployments` 进 `serialize`/`deserialize`（旧档缺字段 → `{}`）；
      snapshot 仅在存在部署时补 `formation` 字段
- [x] 测试：`FormationResolver.test.js` 18 例 + `BattlefieldRuntimeSystem.formation.test.js` 7 例
- [x] 两入口现状：大地图默认部署与 PRE_BATTLE 临时覆盖/设为默认由 M3 的
      `ArmyOrderSystem.commitDeployment/applyTempDeployment/setFormation/lock` 承担，本批只补
      「按阵型把实体摆到槽位」的执行端；**偏差**：主将实体化留模块 6
- [x] **偏差**：`stanceByRole` 只写 `entity.formationStance`，不强制改写 AI 姿态（零回归）；
      接敌锁死沿用 M3 `lockDeployment`

## C. 5C 地势（提交 `97f581b9`）

- [x] `TerrainCombatResolver.js`（新）：`terrainCombat` 区 → `{attack,defense,range,speed}`；
      多层连乘、`unitTypeFilter` / `side` 过滤、`range` 只对远程兵种生效
- [x] `ZoneEffectSystem.resolveTerrainCombat(x, y, context)` 纯查询；逐帧状态机跳过 `terrainCombat` 区
- [x] `WarEffectAggregator.js`（新）：S10 五项战争效果聚合提引擎，S10 改为委托；含损毁改乘
      `destroyedDefenseMultiplier`、`Number(null)=0` 的逐条等价语义
- [x] 测试：`TerrainCombatResolver.test.js` 8 例 + `WarEffectAggregator.test.js` 6 例；
      S10 相关回归 65/65
- [x] **偏差**：`CombatSystem` 本批不接线（零回归优先），地形修正先以 API 供交战/命中处按需取用

## D. 5D 编辑器（提交 `b443736d`）

- [x] `LibraryEditor` 内容库新增「兵种 / 军阵 / 武将」三个类别（模板字段与 schema 对齐）
- [x] `FormationResolver.validateFormation` 提供非致命告警（未知策略 / 行宽不一致 / 未知兵种 /
      空阵型），供编辑器与内容校验复用
- [ ] 待办：场景编辑器 buffZone 面板的「地势战斗」勾选与表单（本轮以 JSON 域编辑，见 §E 遗留）

## E. 遗留

1. 场景编辑器 buffZone「地势战斗」可视化表单（当前只能编辑专属 JSON 域）。
2. `CombatSystem` 接线 `CombatModifierPipeline`（含 formation/hero aura/terrain 三层）需单开
   「战斗数值接入」批次，带开关与逐项回归。
3. 主将实体化 / `aura` 实装 / `formationBonus` 结算留模块 6（武将）。
4. 14 条既有阵型的 `strategy` 仍是历史值（走别名），若要收敛为 6 规范值需一次内容迁移 + GOLDEN 刷新。

## 进度锚点（2026-11-11 · M5 完成）

- 提交：`d746cdfd`（5B）、`97f581b9`（5C）、`b443736d`（5D）
- 测试：新增 39 例全绿（18+7+8+6）；引用 S10 的回归 65/65；schema/内容回归 38/38
- 下一步：M6（武将 / 主将体系）
