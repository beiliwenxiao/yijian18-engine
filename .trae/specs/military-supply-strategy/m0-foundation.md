# M0 底座 · 实施级设计

> 状态：实施级设计（未动代码）· 2026-11-09
> 归属：[阶段总表](tasks.md) M0 行 · 决策依据 [decisions.md](decisions.md)
> 定位：M0 是 M1~M7 的硬前置。**只做"接线 + 数据 + 纯函数"，不接任何运行时调用点**，因此可独立验收、零行为变化。

---

## 1. 现状实证（勘察结论，含 2 处旧结论修正）

| # | 事实 | 证据 | 对 M0 的影响 |
|---|---|---|---|
| 1 | `FORMATION_SCHEMA` / `HERO_SCHEMA` / `UNIT_SCHEMA` / `POSITION_SCHEMA` **已存在** | `src/data/schema/CanonicalSchemas.js`（FORMATION 约 :103-115、HERO 约 :90-102、UNIT 约 :78-88） | **M0 不用写这三套 schema**，只需接线 + 补字段（`class`/`tier`/`dealMultiplier`） |
| 2 | 注册表 kind 清单是硬白名单 | `src/core/Registry.js:50-53` = npcs/enemies/items/equipment/shops/classes/skills/vehicles/buildings/resourceNodes/armies | 新增 5 个 section 必须改这一处 |
| 3 | `DefinitionRepository` 按 `snapshot.definitions` 的 **kind 泛化索引**，不做白名单 | `src/core/DefinitionRepository.js:328-371`（`for (const [kind, definitions] of Object.entries(...))`） | library.json 多出未注册的 section **不会报错**，但也拿不到 Registry → 静默失效风险，需校验兜底 |
| 4 | 引用校验只有 resourceNodes.itemId 等少量 | `src/core/DefinitionRepository.js:233` 一带 | 需新增 formations/heroes 引用校验（M0 核心价值之一） |
| 5 | library.json 现有 17 个 section，**无** `recipes/unitTypes/formations/heroes/ranks` | `example/sanguo_zhangjiao/project/library.json`（items/equipment/enemies/npcs/shops/classes/vehicles/buildings/resourceNodes/armies/combatSkills/craftSkills/gatherSkills/players/skeletonParts/talents） | 5 个 section 全部新建 |
| 6 | 7 份 battle 配置共 **14 行**含 `formationIds` 与 `commanderHeroId`（= 28 个悬空引用） | `config/battles/S03/S04/S05/S07/S11/S12/S13.json`，各 2 行（attackerArmy/defenderArmy） | 需造 14 个 formation + 14 个 hero 定义（或降级） |
| 7 | **`outcomePriority` 已全部配好**（旧 tasks.md「全项目未配」结论**不成立**） | 7 份 battle 全部有该键；`BattleSystem.js:218-219` 已做非空 + 字段完整性校验 | M0 该项从"补齐数据"改为"**加加载期强制校验 + 回归用例**"，工作量下降 |
| 8 | `coin` 无统一常量，资源类型 enum 硬编码 2 处 | `CanonicalSchemas.js:144`（RESOURCE_NODE_SCHEMA）、`:195`（RESOURCE_NODE_DEFINITION_SCHEMA）= `['wood','iron','food','herb','stone']`；**全项目无 `RESOURCE_IDS`** | 需新建资源常量模块，但 **coin 不能进采集节点 enum**（钱不是采出来的） |
| 9 | `CITY_SCHEMA.resources` 是 integer map，**天然支持 coin 键** | `CanonicalSchemas.js:367-395` + `ARMY_SCHEMA` 同款 validate | 城库 coin 零 schema 改动 |
| 10 | 新 library section 还需登记"配置消费路径"，否则报未消费告警 | `src/core/ConfigConsumptionRegistry.js:313-322`（逐条 `registerPath('library.xxx[*].**')`） | 5 个 section 各加一条注册 |
| 11 | `CombatModifierPipeline` 不存在 | 全项目 grep 无此类 | 新建纯函数模块（M0 只写 + 单测，不接线） |

---

## 2. 五项交付与改动顺序

顺序原则：**先让 schema 和 kind 认识新数据 → 再补数据 → 再开校验 → 最后写 pipeline**。每一步都能独立跑测试。

### Step 1 · 扩注册表 kind（改 1 行清单）

| 文件 | 改动 |
|---|---|
| `src/core/Registry.js:50-53` | `STANDARD_REGISTRY_KINDS` 追加 `'recipes','unitTypes','formations','heroes','ranks'` |

- 副作用：`createStandardRegistries` 自动多出 5 个 `Registry` 实例，`gameLoader.registries.formations` 立即可用。
- 验证：`Registry` 单测 + 新增断言"5 个 kind 均有 Registry 实例"。

### Step 2 · schema 补字段 + 新增 2 套

| 文件 | 改动 |
|---|---|
| `src/data/schema/CanonicalSchemas.js` | ①`UNIT_SCHEMA` 加 `class`(enum melee/cavalry/ranged)、`tier`(int≥1)、`upgradeFrom`(array)、**`dealMultiplier`(object：逐兵种攻方倍率)**、`damageTakenFrom`(object) ②`FORMATION_SCHEMA` 加 `modifiers`(object，P3：无 counters) ③新增 `RECIPE_SCHEMA`（输入/输出/工时/失败档）④新增 `RANK_SCHEMA`（`value` 0~100 / `title` / `kind` 固定 `post`）——定稿阶梯 21 级，100 = 大将军 |
| `src/data/schema/ContentSchemas.js` | 若编辑器/校验走 ContentSchemas，同步 5 个 kind 的 schema 映射 |

- **全部新字段 `required: false`** → 旧数据零影响。
- 验证：schema 单测（缺字段通过 / 越界失败）。

### Step 3 · 资源常量收敛（coin）

| 文件 | 改动 |
|---|---|
| `src/data/ResourceIds.js`（新） | `RESOURCE_IDS = ['wood','iron','food','herb','stone','coin']`；`RESOURCE_NODE_TYPES = RESOURCE_IDS.filter(k => k !== 'coin')`；`isResourceId(k)` |
| `src/data/schema/CanonicalSchemas.js:144,195` | 两处字面量 enum 改引用 `RESOURCE_NODE_TYPES`（保持不含 coin，行为不变） |
| 城库侧 | **零改动**——`CITY_SCHEMA.resources` 已是 integer map |

- 为什么不一刀切把 coin 加到两个 enum：会让"铜钱矿点"成为合法数据，语义错误。
- 验证：schema 单测 + 全量加载（旧 resourceNodes 仍通过）。

### Step 4 · 补 5 个 section 数据 + 消 28 处悬空引用

**4.1 library.json 新增 5 个空数组**（必须先建，否则 Registry 取到 undefined）：

```jsonc
"recipes": [], "unitTypes": [], "formations": [], "heroes": [], "ranks": []
```

**4.2 造 14 个 formation 定义**（一战斗一攻一守）

命名与 battle 里现有 id 严格一致，**不删引用只补定义**（保留战斗配置的阵法意图，M5 直接消费）：

| battle | 需补的 formation id |
|---|---|
| S03 | `formation.s03.yellow_turban.vanguard` / `formation.s03.han_garrison.line` |
| S04 | `formation.s04.yellow_turban` / `formation.s04.han` |
| S05 | `formation.s05.yellow_turban.vanguard` / `formation.s05.han.ambush` |
| S07 | `formation.s07.yellow_turban.delay_lines` / `formation.s07.han.pursuit` |
| S11 | `formation.s11.yellow_turban.three_lanes` / `formation.s11.han.three_lanes` |
| S12 | `formation.s12.han.siege` / `formation.s12.yellow_turban.yamen` |
| S13 | `formation.s13.yellow_turban.retreat` / `formation.s13.han.pursuit` |

最小合法定义（满足 FORMATION_SCHEMA 必填）：

```jsonc
{
  "schemaVersion": 2,
  "id": "formation.s03.yellow_turban.vanguard",
  "name": "黄巾先军·锋矢",
  "unitIds": ["unit.spear", "unit.shield", "unit.archer"],   // 先指向 3 个基础兵种
  "rows": 3, "columns": 3,
  "strategy": "wedge",
  "modifiers": { "attack": 1.15, "defense": 0.95 }           // P3：只有加成，无克制
}
```

**4.3 造 14 个 hero 定义**（commanderHeroId 指向）：

`hero.sun_xia` / `hero.s13.han_commander` / `hero.s12.han_commander` / `hero.zhang_bao` /
`hero.zhang_liang` / `hero.s11.han_commander` / `hero.s07.yellow_turban_captain` /
`hero.s07.han_commander` / `hero.zhang_mancheng` / `hero.qin_jie` / `hero.bocai` /
`hero.s04.han_commander` / `hero.zhangjiao` / `hero.s03.han_commander`

最小合法定义：`{ schemaVersion:2, id, name, unitId, level, stats:{command:...}, rankId }`
（`stats.command` = P1 的**统率值**，取值 40~90 分批给；`rankId` 指向 `ranks[]`，
官职取 **校尉 35 ~ 骠骑将军 95** 分批，**大将军 100 只给玩家/终局人物**，皇帝/王爵档均已取消）。

**4.4 造基础兵种 7 条**（unitTypes，供 formations 引用 + M5 克制取用）：
`unit.spear` / `unit.shield` / `unit.heavy` / `unit.light_cav` / `unit.heavy_cav` / `unit.horse_archer` / `unit.archer`。

倍率按 [decisions.md](decisions.md) §3.2（骑兵压制）+ §3.3（特例层）**逐兵种显式抄进 `dealMultiplier`**，不写任何大类规则：

```jsonc
// 三条骑兵：把压制倍率写进自己的 dealMultiplier（枪兵列 = Q1 定稿方案 A 的 0.8）
"unit.light_cav":   { "dealMultiplier": { "unit.shield":1.3, "unit.heavy":1.1, "unit.archer":1.4, "unit.spear":0.8 } },
"unit.heavy_cav":   { "dealMultiplier": { "unit.shield":1.4, "unit.heavy":1.2, "unit.archer":1.4, "unit.spear":0.8, "unit.light_cav":1.2, "unit.horse_archer":1.25 } },
"unit.horse_archer":{ "dealMultiplier": { "unit.shield":1.1, "unit.heavy":1.05, "unit.archer":1.0, "unit.spear":0.8, "unit.light_cav":0.8, "unit.heavy_cav":0.8 } },
// 枪兵：反骑（唯一例外 X1）追加 E2 特例
"unit.spear":       { "dealMultiplier": { "unit.light_cav":1.3, "unit.heavy_cav":1.3, "unit.horse_archer":1.3, "unit.shield":1.15, "unit.heavy":0.85 } }
```

- **Q1 已定稿 = 方案 A**，枪兵 6 格按上表一次填满，**不再留空、不再加 `_todo` 标记**。
- 步兵侧的 `dealMultiplier` 只填特例（E2~E6），其余留空即 1.0。

**4.5 造 21 条官职阶梯**（ranks，decisions §2-P1 表逐行抄）：

`rank.wusheng`(0 白身) / `rank.wuzhang`(5 伍长) / `rank.shizhang`(10 什长) / `rank.dubo`(15 都伯) /
`rank.tunzhang`(20 屯长) / `rank.junhou`(25 军侯) / `rank.quzhang`(30 曲长) / `rank.xiaowei`(35 校尉) /
`rank.zhonglangjiang`(40 中郎将) / `rank.yamenjiang`(45 牙门将) / `rank.pianjiangjun`(50 偏将军) /
`rank.pijiangjun`(55 裨将军) / `rank.zaohao`(60 杂号将军) / `rank.sian`(65 四安将军) / `rank.sizhen`(70 四镇将军) /
`rank.sizheng`(75 四征将军) / `rank.sifang`(80 四方将军) / `rank.weijiangjun`(85 卫将军) / `rank.cheqi`(90 车骑将军) /
`rank.piaoqi`(95 骠骑将军) / `rank.dajiangjun`(100 大将军)

- 全部 `kind: "post"`（纯军职），**没有爵位维度**——2026-11-09 裁定取消「王」级，爵位不建模。
- `ranks` 是**纯数据**：改名、增删级数、调档位都不动代码。

### Step 5 · 引用校验接上（M0 的核心收益）

| 文件 | 改动 |
|---|---|
| `src/core/DefinitionRepository.js`（:233 一带的校验区） | 新增：`battles` 若进入 definitions，则校验 `attackerArmy/defenderArmy.formationIds[*] → formations`、`commanderHeroId → heroes`；formations 的 `unitIds[*] → unitTypes` |
| `src/core/GameLoader.js:237-249` | `validatePlacementReferences` 不动（placement 层已通），battle 层校验放 DefinitionRepository |
| `src/systems/BattleSystem.js:218-219` | 保留现有校验，**补一条"缺失仅 warn 不阻断"**（防止老存档/老配置直接崩） |

- 校验策略：**M0 阶段先 warn 不 error**，M1 起对新建数据开 error（渐进，保零回归）。
- 验证：故意写错一个 formationId → 日志出现悬空告警且加载成功。

### Step 6 · ConfigConsumptionRegistry 登记

| 文件 | 改动 |
|---|---|
| `src/core/ConfigConsumptionRegistry.js:313-322` 一带 | 追加 5 条：`library.recipes[*].**` / `library.unitTypes[*].**` / `library.formations[*].**` / `library.heroes[*].**` / `library.ranks[*].**` |

- 不做这步的后果：新数据被报"未被消费的配置"，`ConfigConsumptionRegistry.test.js` 变红。

### Step 7 · CombatModifierPipeline 纯函数骨架

**文件**：`src/systems/CombatModifierPipeline.js`（新）

```js
/**
 * 战斗修正管道（纯函数，无状态、不依赖 ECS）
 * 四层乘算：兵种克制 × 阵法加成 × 地势 × 光环，各自 clamp 后总 clamp。
 * 克制层只做「查 attacker.dealMultiplier[defender.unitTypeId]」一次查表，不含大类规则。
 * M0 只写实现 + 单测，不接任何调用点（零行为变化）。
 */
export function resolveCombatModifier({ attacker, defender, formation, terrain, auras, config }) → {
  attackMultiplier, defenseMultiplier, breakdown: { counter, formation, terrain, aura, clamped }
}
```

- 结构约束（关键）：
  1. **不含任何兵种/大类 if 分支**——克制全部查 `unitTypes[].dealMultiplier` 表（decisions §3.6 的数据契约；"骑兵压制"只是这条数据，不是引擎规则）。
  2. 每层独立 clamp，再总 clamp `[0.4, 2.2]`（单层 `[0.6,1.6]`，取自 05 §12 #4）。
  3. 等级差衰减规则内置（攻方低 ≥2 级 → 克制 1.3→1.15 / 0.8→0.85）。
  4. `config` 全外部注入（clamp 区间 / 克制倍率 / 等级衰减阈值），无魔法数字。
  5. 缺任何输入 → 返回全 1.0（恒等元），保证老战斗接入后数值不变。
- 验证：单测覆盖 ①恒等（无输入=1.0）②`dealMultiplier` 逐兵种查表抽样（骑兵打刀盾 1.3 / 打弓 1.4、弓骑对射 1.0）③等级衰减 ④clamp 边界 ⑤breakdown 可读。

---

## 3. 数据迁移方式

| 对象 | 迁移策略 |
|---|---|
| 新增 5 个 library section | **纯追加**，不移动既有数据；空数组先占位（Registry 取得到空索引） |
| 28 处悬空引用 | **补定义，不删引用**。理由：battle 配置表达的是"这场仗该用什么阵法/谁指挥"的设计意图，删了就丢；M5 消费 formations 时直接用 |
| 既有 17 个 section | 零改动 |
| 存档 | **零迁移**。M0 全部新增都是定义层（library），不进 checkpoint；`blackboard.armyStates` 等运行时状态 M3 才引入 |
| 编辑器 | 内容库自动识别新 kind（列表/拖放/保存全链通用，army 已有先例）；M0 不另做表单 |

**回滚方式**：删掉 5 个 section 数组 + revert Registry 一行 → 回到当前状态，无残留（因为 M0 不写运行时状态）。

---

## 4. 零回归论证（逐项）

| 风险 | 为什么不会发生 |
|---|---|
| 新增 Registry kind 影响既有加载 | `createStandardRegistries` 只是多建 5 个空 Registry，既有 kind 的解析路径未改 |
| schema 加字段破坏旧数据 | 新字段全 `required:false`；`UNIT_SCHEMA` 等三套本就是可选字段为主 |
| coin 进资源 enum 影响采集 | coin **不进** `RESOURCE_NODE_TYPES`，采集链 enum 集合不变 |
| 补 formation/hero 定义影响战斗 | battle 配置里的 `formationIds` 目前**无人消费**（BattlefieldRuntimeSystem 只读 army 的 factionId/morale/resources）。补齐定义 = 把悬空变合法，行为不变 |
| 引用校验报 error 阻断加载 | M0 采用 **warn 不阻断**；error 留到 M1 新数据 |
| CombatModifierPipeline 影响战斗数值 | **没有任何调用点**（M5 才接线）。纯函数不 import 就被 tree-shake，运行时不存在 |
| ConfigConsumptionRegistry 新增路径 | 只增登记，不删不改既有登记 |

**判定标准**：M0 前后跑同一批场景冒烟，**实体数、伤害数值、战斗胜负、存档字节**四项完全一致。

---

## 5. 验收标准（M0 完成即可测）

### 5.1 自动化

| 测试 | 预期 |
|---|---|
| Registry 单测（新增 5 kind） | 5 个 Registry 实例存在；空库不抛错 |
| Schema 单测（UNIT/FORMATION/RECIPE/RANK） | 必填缺失报错；新可选字段缺省通过 |
| 引用校验单测 | 故意悬空的 formationId / commanderHeroId / unitId 各产生 1 条 warn |
| ResourceIds 单测 | `isResourceId('coin')=true`；`RESOURCE_NODE_TYPES` 不含 coin |
| CombatModifierPipeline 单测 | 恒等 / `dealMultiplier` 查表抽样 / 等级衰减 / clamp 边界 全绿 |
| ConfigConsumptionRegistry 测试 | 新 5 个 section 不报"未消费" |
| 既有全量回归 | 场景核心 + 存档 + EntityFactory + PlacementSpawner 全绿（基线 112 项不退） |

### 5.2 加载实例验证

```
加载 example/sanguo_zhangjiao：
  错误数 = 0
  警告中"悬空引用"类 = 0（28 处已补）
  registries.formations.size = 14
  registries.heroes.size = 14（+ 玩家主角若已在 players）
  registries.unitTypes.size = 7
  registries.ranks.size ≥ 1
```

### 5.3 行为验证

同一局 S01→S05 冒烟跑两遍（M0 前 / M0 后）：
- 敌我实体数量一致
- 同一段战斗的伤害序列一致
- 战斗结束判定一致（BattleSystem 未改逻辑）
- 存档快照 diff 为空

---

## 6. 工作量与风险

| 项 | 说明 |
|---|---|
| 代码改动 | 4 个文件小改（Registry / CanonicalSchemas / DefinitionRepository / ConfigConsumptionRegistry）+ 2 个新文件（ResourceIds / CombatModifierPipeline） |
| 数据改动 | library.json 加 5 section + 14 formation + 14 hero + 7 unitType；7 份 battle **零改动** |
| 主要风险 | ①14 个 formation 的 `unitIds` 指向 7 个新 unitType，若兵种 id 命名与 M5 观测点不一致会导致后期返工 → **兵种 id 在本步一次性定死**（`unit.spear` 等，见 decisions.md §3）②`classes`/`combatSkills` 已有注册表，`recipes` 与既有 `craftSkills` 语义需划清（recipes=制作配方，craftSkills=技能等级门槛，不合并） |
| 明确不做 | 不碰 `ArmyCommandSystem` / `BattleSystem` 结算逻辑 / `TutorialSystem`（P11 冻结）/ 性能线相关文件 |
