# 模块 5：阵法与地势建筑（策略口径统一 / 军阵 / 地形工事）

> 状态：设计稿 · 2026-11-08（**v2.4 修订 2026-11-09 第七次拍板**：①**部署权限判定键只留时机**——`battle.status === 'PRE_BATTLE'` 即可调、`DEPLOYED` 即 `DEPLOYMENT_LOCKED`，**不再看入场身份**；"敌方军团不可调"改走**数据归属判据**（非己方势力），与身份判据不是一回事（§6.3）；②**术语「参战」→「接管」**（takeover），三种身份 = 接管 / 支援 / 旁观（§6.3））
> （**v2.3 修订 2026-11-09**：①战前部署改为**两处入口**——大地图设默认值 + 进战场**接战前**可临时调整（带「设为默认值」勾选），接战即 `DEPLOYED` 锁死；②阵法强弱统一为**三类信息**（数值 / 场景标签 / 地形偏好），删除两两强弱声明与「强/弱标签 UI」，保留 P3 无克制定案。详见 §3.2、§6.1、§6.3、§8、§11 #12）
> （**v2.2 修订 2026-11-09**：**主将一律下场参战**——不同武将下场位置不同（猛将靠前 `front`、智将居中/后置 `mid`/`rear`），位置由「军团 → 战前部署」指定；主将光环**常驻**，仅主将阵亡或撤离/逃亡离场时失效；**战前部署锁定**——军团兵种构成 / 军团阵型（布阵）/ 主将位置在战斗中**任何身份都不能改**，战中只有「接管」身份可下**将令**（姿态切换 / 集火目标 / 撤退）。详见 §3.3、§6.1、§6.3 与 [模块 6](06-battle-plan-intervene.md) §3.6/§3.7）
> （v2.1 修订 2026-11-09：阵法保留为玩家可设置的攻防加成预设——玩家经武装单位「布阵」指令从 6 种阵法中选择一种挂上，加成经 `CombatModifierPipeline` 军阵层生效；行列部署模板与策略模板降为 AI 自动布阵内部数据，玩家不编辑。详见[模块 3 v2](03-army-squads.md) §3.2）
> 归属：[军需—配给—押运—军团体系总纲](spec.md) 模块 5
> 需求映射：「阵法（地势建筑 + 军阵），统一"策略/阵法"口径」（第四轮）

---

## 1. 现状盘点（实证）

| 能力 | 状态 | 实证 |
|---|---|---|
| 军阵 Schema | **已有定义，无运行时** | `FORMATION_SCHEMA`（`CanonicalSchemas.js:103-115`）：`id/name/unitIds/leaderHeroId/rows/columns/strategy` |
| 军阵数据 | **没有** | 全项目无 `formations` 注册表；`battles/*.json`（S03~S13）全部引用 `formationIds: ["formation.s03..."]`，**src 内没有任何代码读取它**（grep 只命中 schema） → 悬空引用 |
| 主将数据 | **没有** | `commanderHeroId: "hero.zhangjiao"` 等 14 处引用，无 `heroes` 注册表 |
| 战场部署 | **部分** | `BattlefieldRuntimeSystem.start({entities, playerEntity, playerFactionId})`（`:38`）——**扁平实体列表进战场**，不读 formations、不按行列布阵 |
| 战前判定 | **已有先例** | `battles/S12.json:15` `preBattleRules.friendlyMoraleZero`（士气 0 直接判负 + skipRealtimeBattle） |
| 小队姿态 | **已有** | `STANCE_PROFILES`（`ArmyCommandSystem.js:80-89`）8 姿态 + `squadPresets` 战前预设（`SceneArmyCommandFlow.js:146/236` 已接线） |
| 建筑战争效果字段 | **已有字段，消费方项目侧硬编码** | `warEffects` 存于 `construction.definitions`（`game.project.json:337/362/386/411`），**唯一消费处是 `S10ConstructionFlow._deriveS10ConstructionEffects()`（`:510-541`）**——项目侧，其他场景拿不到 |
| 区域效果 | **已有通用系统** | `ZoneEffectSystem`（`src/systems/ZoneEffectSystem.js`）：buffZone 多边形 + 5 种时序（instant+remove / instant+countdown / periodic+remove / periodic+countdown / delayed） |
| 工程物 | **已有（编程驱动）** | `ARMY_CONSTRUCTION_DEFS`（`ArmyCommandSystem.js:103-108`）：鹿角/挖坑/筑城/扎营 |
| 地形 shape 语义 | **已有** | `walkable` / `collide` / `jumpBlock`（可落脚优先、阻挡、仅拦跳跃三态） |
| 地形伤害/加成区 | **已有** | `buffZone`（场景 JSON 对象，`SceneTerrainCollision.collectBuffZones:895`） |

**结论：三块拼图各缺一角**——军阵有 schema 无数据无消费者；建筑效果有字段但消费在项目侧；地形加成有通用系统但没接到战斗结算。

---

## 2. 口径统一：「策略」是唯一上层词，三层各司其职

现状里"策略"被三处不同东西叫同一个名（`FORMATION_SCHEMA.strategy`、`armyOrders`、`STANCE_PROFILES`）。**统一口径如下，且只用一个词"策略（strategy）"**：

```
策略 strategy（玩家视角的一个词）
├─ 军团策略  armyOrder    —— 大地图/场上"这支军团要做什么"
│    move / attack / defend / transport / camp / formation（模块 3 armyOrders）
├─ 军阵策略  formationStrategy —— "兵怎么站、按什么路子打"
│    line / wedge / crane / fishscale / circle / echelon / snake（数据表，见 §3）
└─ 小队姿态  stance       —— "这一队此刻的接敌规则"
     assault / hold / advance / retreat / rescue / garrison / escort / flee（已有）
```

- **单一事实源**：三者都是数据表，都在 `game.project.json` / `library.json`，都不写死在代码分支里。
- **映射不是新造**：军阵策略 → 小队姿态的默认映射写进军阵定义（`stanceByRole`），例如鹤翼阵的 `wing` 行默认 `advance`、`center` 行默认 `hold`。
- **术语替换**：文档与 UI 里"阵法/阵型/战术"一律收敛为「军阵」+「策略」两个词，避免第三个说法。

---

## 3. 军阵（formation）数据表

### 3.1 结构（落在 `library.json.formations[]`，复用 `FORMATION_SCHEMA` 并扩展）

```jsonc
{
  "id": "formation.s03.yellow_turban.vanguard",
  "name": "黄巾先军·锋矢",
  "schemaVersion": 2,
  "factionId": "yellow_turban",           // 可选，用于筛选
  "strategy": "wedge",                     // 军阵策略（决定位置模板 + 修正）
  "rows": [                                // 行（从前往后；已有字段复用）
    { "line": 0, "role": "front", "slots": ["spear", "spear", "shield"] },
    { "line": 1, "role": "mid",   "slots": ["archer", "archer"] },
    { "line": 2, "role": "rear",  "slots": ["light_cavalry"] }
  ],
  "columns": 3,                            // 最大列数（布局解析用）
  "leaderHeroId": "hero.zhangjiao",        // 主将（heroes 表见 §3.3）
  "stanceByRole": {                        // 军阵策略 → 小队姿态的默认映射
    "front": "assault",
    "mid": "hold",
    "rear": "escort"
  },
  "modifiers": {                           // 军阵修正（乘算，见 §4）；无 counters 字段——定稿 P3
    "frontDefenseMultiplier": 1.15,
    "chargeImpactMultiplier": 1.2,
    "archerRangeMultiplier": 0.95
  },
  "stackOffsets": { "rowGap": 56, "colGap": 44 }   // 部署点间距（2.5D y 压缩）
}
```

- **`slots` 用兵种 id**：与模块 3 兵种表 `library.json.unitTypes[]` 同源（刀盾/枪/弓/轻骑/重骑/弓骑）。军阵只声明"哪行放哪些兵种"，具体哪个实体进哪个槽由部署算法决定。
- **`rows` 与 `unitIds` 二选一**：`unitIds` 是"点名指定单位"（剧情精确编队），`rows` 是"按兵种填充"（常规）。同存时 `unitIds` 优先。

### 3.2 军阵策略（6 种，纯数据）

| strategy | 名称 | 位置模板 | 修正要点（全为 `modifiers` 数值，**无克制**） | 适用场景标签 | 地形偏好 |
|---|---|---|---|---|---|
| `line` | 列阵 | 横排对齐 | 全向防御 +10%、正面抗冲 −15%（冲阵冲击打折） | **均衡**（无明显短板，通用） | 平原、隘口（正面宽度受限时抗冲最有用） |
| `wedge` | 锋矢 | 前窄后宽 | 冲锋冲击 +20%、侧翼防御 −15% | **突破**（撕开正面、斩将夺旗） | 平原、通路（需要冲刺距离） |
| `crane` | 鹤翼 | 两翼前伸 | 两翼攻击 +15%、中路防御 −10% | **包围**（两翼包夹、围歼残敌） | 平原、开阔地（两翼需要展开空间） |
| `fishscale` | 鱼鳞 | 层层叠进 | 持续接战耐久 +15%、各项均衡（无尖峰亦无短板） | **持久**（久战消耗、守待援） | 营地、林地（不需要机动空间） |
| `circle` | 圆阵 | 环形 | 全向防御 +25%、移动 −30%、侧后无防御减益（防包抄） | **防守**（被围、断后、护辎重） | 隘口、营地（狭窄地形把敌人挤到正面） |
| `echelon` | 雁行 | 斜线梯次 | 首次接敌 +15%、追击 +20%、侧翼攻击 +10% | **远程输出**（弓弩梯次开火、掩护追击） | 高台、河岸（视野与射界优先） |

> **定稿 P3：阵型之间不存在克制关系**，原「强于 `wedge` / 强于 `circle`」这类表述作废——强弱差异**只由两件事体现**：①上表的 `modifiers` 数值（同一场战斗里不同阵法给不同修正）；②「场景标签 + 地形偏好」与当前战场是否匹配（如圆阵用在开阔地会被机动性拖累，锋矢用在隘口冲不起来）。
>
> **三类信息，不写两两强弱**（v2.3 定稿，清除旧口径）：①数值修正（`modifiers`）；②适用场景标签（均衡/突破/包围/持久/防守/远程输出）；③地形偏好（高台/树林/隘口/河岸/营地）。UI 只展示这三类，**不展示"强于某阵/弱于某阵"**。

> **不做阵型升级树/熟练度**——军阵是"选择"不是"养成"，避免与模块 1 的熟练度系统打架。后续若要做，加 `formationMastery` 字段即可，不改结构。

> **数据字段补充**（上表两列落到 `formations[]`）：
> ```jsonc
> "sceneTags": ["breakthrough"],            // 适用场景标签：balanced | breakthrough | encircle | endurance | defense | ranged
> "terrainPreference": {                    // 地形偏好：fit=契合（数值不变，仅 UI 提示）miss=不契合（UI 警示，另行可配 penalty）
>   "fit": ["plain", "pass"],
>   "miss": ["forest"]
> }
> ```
> **地形偏好默认只做提示、不做数值惩罚**（避免与 §5.3 地势修正层重复计算）；若策划要惩罚，另加 `terrainPreference.penalty`（乘算，进 `CombatModifierPipeline` 的军阵层）。

### 3.3 主将 / 副将（补 `library.json.heroes[]`）

```jsonc
{
  "id": "hero.zhangjiao",
  "name": "张角",
  "factionId": "yellow_turban",
  "command": 68,                      // 统率（0~100）：领兵上限 = ⌊(统率+官职)/2⌋；同时 1 点=1 个可管武装单位（定稿 P1/P1b）
  "rankId": "rank.zaohao",            // 官职（0~100 共 21 级阶梯）：杂号将军=60，天公将军即按此档；100=大将军（唯一顶点，定稿 P1c）
  "aura": { "radius": 260, "moraleBonus": 8, "defenseMultiplier": 1.05 },
  "deploySlot": "mid",                // 默认下场位置 front | mid | rear（猛将 front、智将 mid/rear）；军团战前部署可覆盖（v2.2）
  "formationBonus": { "wedge": 1.1 }, // 擅长的军阵额外加成
  "skills": []                        // 介入战场的技能（模块 6 消费）
}
```

- 解决 `commanderHeroId` / `leaderHeroId` 的悬空引用：**这是纯补数据，不改引擎**。
- **主将一律下场参战**（v2.2 裁定，推翻原「主将不下场、只给光环」）：战斗展开为 LIVE 时，主将作为实体进入战场；**不同武将的下场位置不同**——猛将 `front` 靠前、智将/谋士 `mid`～`rear` 居中或后置。位置 = hero 的 `deploySlot` 默认值，可被**军团战前部署**覆盖（§6.3）。预演（PREVIEW）阶段不展开实体，主将按数值参数参与抽象结算。
- **光环常驻**：主将实体在场即光环生效（不区分是否玩家操控——旁观/支援时主将交 AI 接管，光环照旧）；只有**主将阵亡**或**撤离/逃亡离场**时，该军团 `aura` 归 1.0（军阵 `modifiers` 不受影响）。原「离场光环立即失效」是"主将不下场"时代的默认假设，已被替换为「在场即生效、离场才失效」，与"主将总在场上"自洽。
- 主将实体化只发生在 LIVE 展开（复用现有 hero/entity 管线）；预演与自动结算仍只读 `aura` / `formationBonus` 数值，**不生成实体**。
- **无主将的军团**（`commanderHeroId` 为空）：不下场主将、无光环（`aura` 层按 1.0），与旧行为一致；`deployment.commanderSlot` 留空。

### 3.4 消费链（谁读军阵）

```
battles/*.json  attackerArmy.formationIds[]
   → FormationResolver.resolve(formationId)          // 新，纯函数
   → 部署：BattlefieldRuntimeSystem._createInitialFactions 按 rows/columns 生成部署点
   → 主将：hero.deploySlot（front/mid/rear）落位，军团战前部署可覆盖（§6.3）
   → 修正：modifiers 进 evaluateOutcome 的 signals 加权
   → 姿态：stanceByRole → 单位 AI 姿态（v2.2 无分队概念，直接落单位行为）
```

- **部署输入三件套（战前部署，战中锁死）**：①兵种构成 `roster`；②军阵 `formationId` + `rows`；③主将/副将位置 `deployment.commanderSlot / deputySlots`。三者都在战前部署阶段一次定死（§6.3），战斗开始即冻结。

- **不替换** `BattlefieldRuntimeSystem`：只在其 `start({entities})` 前多一步"按军阵排序/打槽位标记"，实体仍是同一批。
- **场景实时链**也能用：`army.formation { armyId, formationId }` → 按 `rows` 重排阵型偏移（`ArmyCommandSystem` 的 `FORMATION_SPACING_X/Y` 换成 `stackOffsets`）。

---

## 4. 加成与克制的三层乘算

战斗结算的修正必须**只有一处**，否则四面漏风。定为：

```
最终修正 = 兵种克制(decisions §3：骑兵压制 + 特例层) × 军阵修正(§3.2/§3.1) × 地势修正(§5) × 主将光环(§3.3)
约束：
  - 每层单独 clamp 到 [0.6, 1.6]
  - 三层连乘后总修正 clamp 到 [0.4, 2.2]（防叠乘爆炸）
  - 全部为乘算，无加法项（加法项只存在于士气，见 §5.4）
```

- **主将光环层**：主将实体在场即计入（v2.2：主将一律下场 → 默认恒生效），主将阵亡或撤离离场才退化为 1.0；预演阶段按 `aura` 数值直接计入。

- **实现落点**：新增 `CombatModifierPipeline`（纯函数，`src/systems/battle/CombatModifierPipeline.js`），入参 `{ unitType, formation, terrain, heroAura, targetUnitType }`，出参 `{ attack, defense, speed, morale }` 修正系数。`CombatSystem` 与 `BattlefieldRuntimeSystem.evaluateOutcome` 共用同一个函数——**两条战斗链不再各写一套**。

---

## 5. 地势建筑

### 5.1 两类东西，分工明确

| 类别 | 载体 | 生命周期 | 例子 |
|---|---|---|---|
| **工事（工程物）** | `ARMY_CONSTRUCTION_DEFS` + `startConstruction`（`ArmyCommandSystem.js:766-795`） | 场景内、战役级，可被摧毁 | 鹿角、挖坑、筑城、扎营、拒马 |
| **建筑（永久）** | `construction.definitions`（`game.project.json:302-415`）+ `ConstructionSystem` | 跨日持久，有耐久/维修 | 箭塔、粮仓、城门、瞭望台 |

两者**共用 `warEffects` 字段语义**（`moraleBonus` / `hungerDrainMultiplier` / `enemyAdvanceSpeedMultiplier` / `friendlyCasualtyMultiplier` / `friendlyDefenseMultiplier` / `destroyedDefenseMultiplier`）。

### 5.2 warEffects 从项目侧提为引擎通用（关键改造）

现状：唯一消费方是 `S10ConstructionFlow._deriveS10ConstructionEffects()`（项目侧、S10 专用）。改造为：

```
新 src/systems/battle/WarEffectAggregator.js（纯聚合，无状态）
  aggregate({ structures, armyId?, factionId?, radius?, position? })
    → { moraleBonus, hungerDrainMultiplier, enemyAdvanceSpeedMultiplier,
        friendlyCasualtyMultiplier, friendlyDefenseMultiplier }
  规则：只聚合「同阵营 + 在半径内（缺省=全局）+ durability > 0」的建筑；
        建筑被毁时用 destroyedDefenseMultiplier 替换。
```

- `S10ConstructionFlow` 改为调 `WarEffectAggregator`（行为等价，删掉项目侧私有实现）。
- 新场景（S02 营地、S11 广宗）直接可用，不需要各写一份。
- **零回归**：聚合规则与 S10 现有实现逐项对齐（同一乘算、同一 alive 判定）。

### 5.3 地势（terrain）修正

不新造数据：直接用现有 `buffZone` 多边形（`SceneTerrainCollision.collectBuffZones:895`），只在 `effect` 里加战斗语义字段：

```jsonc
{ "type": "buffZone", "points": [[...]],
  "effect": {
    "kind": "terrainCombat",
    "tags": ["highGround"],                    // 高台
    "modifiers": { "archerRangeMultiplier": 1.25, "defenseMultiplier": 1.1 },
    "unitTypeFilter": ["archer", "crossbow"],  // 只对哪些兵种生效
    "sideFilter": "any"                        // any | friendly | enemy
  } }
```

| 地势 | 效果（默认值） |
|---|---|
| 高台 `highGround` | 远程射程 ×1.25、防御 ×1.1 |
| 树林 `forest` | 隐蔽 +30%（被发现半径 ×0.7）、骑兵速度 ×0.6 |
| 河岸/浅滩 `riverbank` | 重骑/轻骑速度 ×0.5、冲锋冲击 ×0.5 |
| 隘口 `pass` | 正面防御 ×1.3、侧翼无法展开（部署列数 −1） |
| 营地 `camp` | 士气 +8、饥荒消耗 ×0.8（与模块 3 扎营叠加取高，不叠乘） |

- **消费点统一**：`CombatModifierPipeline` 的 `terrain` 入参来自"实体所在 buffZone 的 terrainCombat 效果"；`ZoneEffectSystem` 继续管"进入/停留/离开"的时序，只是效果类型多一种。
- **不参与**：walkable/collide/jumpBlock 三态 shape 只管走位与跳跃（见 `.trae/rules/air-aim-jump-design.md`），不参与战斗结算——**两套语义不混用**。

### 5.4 士气是唯一加法项

```
军团士气 += Σ(warEffects.moraleBonus) + heroAura.moraleBonus + 扎营buff + 地势buff
         - 饥荒惩罚 - 战败惩罚
最终士气 clamp [0, 100]；士气 0 → 触发 factionMoraleBroken（BattlefieldRuntimeSystem 已有信号）
```

- `heroAura` 项**在整场战斗内常驻**（主将实体在场即计入，含旁观/支援时主将交 AI 的情况）；只有主将阵亡或撤离离场时才从公式中移除（§3.3）。
- 括号口径：`heroAura.moraleBonus` 是**加法**项；同 hero 的 `defenseMultiplier` / `formationBonus` 走 §4 乘算层，两者不混。

---

## 6. 状态机

### 6.1 军阵

```
DRAFT（策划定义，未指派）
  →(army.assignFormation / 大地图默认部署) ASSIGNED（军团已挂该军阵 + 默认部署可用）
  →(进入战场、尚未接战) PRE_BATTLE（战场内可临时调整；勾"设为默认"则回写 ASSIGNED 默认值）
  →(接战 battle.deploy.lock) DEPLOYED（按 rows/columns 打槽位，主将落 deploySlot；**锁死**）
  →(战斗结束) ASSIGNED（解锁，可重新部署）
  →(阵型被打崩：前排全灭 或 士气<30) BROKEN（修正全失效，退化为无阵型）
  →(整队/休整) ASSIGNED
```

> 状态名澄清（v2.3）：**`LOCKED` 不再是状态名**——"默认部署已提交"用 `deployment.committed: true` 表示（提交后仍可在 `PRE_BATTLE` 被本场临时覆盖，这就是两处入口的语义）；`DEPLOYMENT_LOCKED` 是**错误码**（接战后拒绝部署类命令时返回），不是状态。

- **战中锁死（v2.2/v2.3 裁定）**：`DEPLOYED`（接战起）期间，`formationId`、`rows`、`roster` 兵种构成、主将/副将位置（`deployment.*`）一律不可修改；`army.assignFormation`、`unit.setFormation`、`army.deploy.commit`、`army.deploy.temp` 在战斗中**一律拒绝**（忽略 + 提示"部署已锁定"），**任何入场身份都不能改，含接管身份**。
- **`PRE_BATTLE` 是唯一窗口**：战场已加载但**尚未接战**时，玩家可做一次临时调整（`army.deploy.temp`）；**一旦接战（第一个敌对单位进入交战 / 战斗计时开始）立即转 `DEPLOYED` 并锁死**，此后与"战中不可改"完全一致。
- **将令例外**：战中只允许「将令」——姿态切换、集火目标、撤退，且仅「接管」身份可下发（门控见 [模块 6](06-battle-plan-intervene.md) §3.6）。
- `BROKEN` 是战损结果、不是玩家操作；回 `ASSIGNED` 后（战斗已结束）才可重新部署。

### 6.2 工事

```
PLANNED → BUILDING（ConstructionSystem 进度）→ ACTIVE（warEffects 生效）
   → DAMAGED（耐久 < 50%，效果折半）→ DESTROYED（destroyedDefenseMultiplier 生效）
ACTIVE → 可维修（`repair` 命令，模块 1 修复链）
```

### 6.3 战前部署（部署类）vs 战中将令（将令类）

| 类别 | 内容 | 下达时机 | 战中能否改 | 下令身份 |
|---|---|---|---|---|
| **部署类（接战锁死）** | 军团兵种构成 `roster`、军团阵型 `formationId` + `rows`、**主将/副将位置 `deployment.commanderSlot / deputySlots`**、军阵策略 | 两个窗口：①大地图非战斗状态（设默认值）；②进战场**接战前的 `PRE_BATTLE`**（临时调整 + 可选回写默认） | **不能**（接战即锁，任何身份） | 军团主将 / 大地图「军团 → 战前部署」（入口 ①）/ 战场内 `PRE_BATTLE` 部署页（入口 ②）——②的权限判定键 = **`battle.status === 'PRE_BATTLE'`**（唯一时机门控，**不看入场身份**）；另加一条**数据归属判据**：军团须属己方势力才可调（敌方/友军 NPC 军团任何身份都不可调） |
| **将令类（战中可下）** | 姿态切换（进攻/防守/冲锋/撤退档）、集火目标、撤退（战术撤军） | 战斗中实时 | 能 | **仅「接管」身份**（takeover） |
| **战略指令（非战斗）** | 进攻 / 防守 / 运输 / 移动 / 扎营 | 大地图、军团未接战时 | 已接战时不可改（改走撤退将令） | 玩家（层级一，模块 3） |

- **部署是什么**：一场战斗"开打之前长什么样"——带哪些兵、怎么站位（军阵）、主将站哪一行。这三样在**接战前**定死（大地图默认 + `PRE_BATTLE` 可覆盖一次），战斗中任何身份都不能改（包括接管身份）；改只能等战斗结束回到 `ASSIGNED`。
- **将令是什么**：打起来之后"这一仗怎么打"——切姿态、指定集火目标、撤退。将令**不写** `ArmyState.order`（战略指令状态不动），只在本次战斗内生效。
- **为什么这样切**：部署是"编制与站位"（改了等于换一支军队），将令是"临阵指挥"（改了只影响这一仗的节奏）。前者锁死才能让战前决策有分量，后者放开才能让「接管」身份有存在感；也避免玩家在战斗中反复切阵法刷最优解。
- **入口定稿（v2.3 第六次拍板：两处入口）**——**大地图设默认值 + 进战场接战前可临时调整（带"是否设为默认"勾选）**：

| 入口 | 时机 | 动作 | 落到哪 |
|---|---|---|---|
| **① 大地图「军团 → 战前部署」** | 非战斗状态（军团未接战） | 设置**默认部署值**（兵种构成 / 阵法 / 主将位置） | 写 `armyStates[armyId].deployment`（默认值，随军团存档） |
| **② 进战场（接战前的 `PRE_BATTLE` 窗口）** | 战场已加载、**尚未接战** | 临时调整本次部署；界面给一个**「设为默认值」勾选项** | 不勾 → 只写本次 `battleDeploymentOverride`（打完即弃）；勾 → 同时回写 ① 的军团默认值 |

- **口径澄清（与 `DEPLOYMENT_LOCKED` 的关系，不冲突）**：入口 ② 的"调整"发生在**接战之前**（`PRE_BATTLE` 态），**一旦接战即转 `DEPLOYED` 并锁死**，此后任何身份不得再改——与既有「战中部署锁死」完全一致，只是把"锁死"的起点从"进入战场"精确到"接战"。
- **为什么从"只读确认页"升级为"可调整"**：玩家真到战场上才看得清地形（高地/隘口/林地，§5.3 地势修正直接影响阵法选择），此时允许改一次比"只能战前盲选"更符合策略手感；同时用"接战即锁"保住"部署不能被战斗中反复切换"的定力。
- **取舍说明**：若坚持"进入战场即锁"，则入口 ② 只能做只读确认页——但地形信息在战前不可见，等于把阵法选择变成盲选。**取"接战才锁"**；如后续发现有玩家靠反复进出战场刷部署，再加"每场仅可调整一次"或"调整需消耗行动点"的限制即可（不改结构）。
- **对模块 4 入口的影响**：大地图点武装单位 → 指令环里「布阵」升级为「战前部署」页签（兵种构成摘要 + 阵法选择（含场景标签/地形偏好，§3.2）+ 主将/副将位置），原「布阵」单项并入该页；非战斗状态可保存为默认值。
- **对模块 6 入口的影响**：`unit.joinBattle` 后进入 `PRE_BATTLE`（可调部署 + 勾选设为默认）→ 接战转 `DEPLOYED` 锁死。门控在 06 §3.6/§3.7，本文件只提供字段语义（`deployment.*` / `battleDeploymentOverride`）。

---

## 7. 数据落点

| 数据 | 落点 |
|---|---|
| 军阵定义 | `library.json.formations[]`（新注册表，`Registry.STANDARD_REGISTRY_KINDS` 加 `formations`） |
| 主将定义 | `library.json.heroes[]`（新注册表，`heroes` 键；含 `deploySlot` 默认下场位置） |
| **战前部署（默认值）** | `blackboard.armyStates[armyId].deployment { committed, commanderSlot, deputySlots }` + 同处 `formationId` / `roster`（大地图设的默认值，战中锁死，§6.3） |
| **本场部署覆盖** | 战斗实例 `battle.deploymentOverride { roster?, formationId?, commanderSlot?, deputySlots? }`（`PRE_BATTLE` 临时调整；未勾"设为默认"时只存在于此，打完即弃） |
| 兵种定义 | `library.json.unitTypes[]`（模块 3） |
| 建筑 warEffects | `game.project.json.construction.definitions[].warEffects`（已有字段） |
| 工事定义 | `ARMY_CONSTRUCTION_DEFS`（引擎常量，模块 3 扩展为可配置） |
| 地势修正 | 场景 JSON 的 `buffZone` 对象（已有载体） |
| 三层修正表 | `game.project.json.battleModifiers`（新）：每层 clamp 区间、总上限、克制倍率 |

---

## 8. 任务 / 触发器 / 命令接法

| operation | payload | 语义 |
|---|---|---|
| `army.deploy.preview` | `{ armyId }` | 读当前部署（兵种构成 / 军阵 / 主将位置）——战前部署页数据源，只读 |
| `army.deploy.commit` | `{ armyId, roster?, formationId?, commanderSlot?, deputySlots? }` | **提交为军团默认部署**（大地图入口 ①）：仅非战斗状态受理；写入 `armyStates[].deployment`，本场同样生效；战中一律拒绝（`DEPLOYMENT_LOCKED`） |
| `army.deploy.temp` | `{ battleId, armyId, roster?, formationId?, commanderSlot?, deputySlots?, setAsDefault?: boolean }` | **本场临时部署**（战场内 `PRE_BATTLE` 入口 ②）：仅"已加载战场、未接战"受理；`setAsDefault:true` 时同步回写 `army.deploy.commit`；接战后拒绝（`DEPLOYMENT_LOCKED`） |
| `battle.deploy.lock` | `{ battleId }` | 接战信号：把 `PRE_BATTLE` 转 `DEPLOYED` 并冻结（内部由战斗开始自动发，也可由触发器显式调用） |
| `army.assignFormation` | `{ armyId, formationId }` | 军团挂军阵（校验兵种齐备）——**部署类**，战中拒绝 |
| `army.setFormationStrategy` | `{ formationId, strategy }` | 改阵法/策略（AI 内部重算位置模板；玩家侧统一走 `army.deploy.commit`，模块 3 §7.1）——**部署类**，战中拒绝 |
| `hero.assign` | `{ armyId, heroId, role:'leader'|'deputy' }` | 主将/副将指派（模块 3 已有，这里消费 heroes 表）——**部署类**，战中拒绝 |
| `terrainWorks.build` | `{ kind, x, y, armyId }` | 建造工事（内部走 `startConstruction`） |
| `terrainWorks.dismantle` | `{ structureId }` | 拆除 |

**事件**：`formation.assigned` / `formation.broken` / `deployment.committed`（默认值提交） / `deployment.tempApplied`（本场临时，带 `setAsDefault`） / `deployment.locked`（接战锁死） / `terrainWorks.built` / `terrainWorks.destroyed` / `warEffect.recalculated`

**任务目标**：`commit.fact('formation.assigned')`、`custom.event:terrainWorks.built`（4A 用 `custom.event`，能力稳定后登记 `ObjectiveTypeRegistry`）。

**触发器典型用法**：`when: terrainWorks.built + payload.kind==='fortify'` → `showTip` + `commitStory`；`when: formation.broken` → 对话「阵型已乱！」+ 强制切 `hold`。

---

## 9. 编辑器怎么编

| 内容 | 编辑器落点 | 交互 |
|---|---|---|
| 军阵 | 内容库新增「军阵」类别（与 items/enemies/armies 同一套列表/拖放/整库保存机制） | 行×列小网格编辑器：每格下拉选兵种；右侧填 strategy / modifiers / stanceByRole |
| 主将 | 内容库「武将」类别 | 表单：command / **rankId（官职阶梯下拉，21 级）** / aura / formationBonus / skills |
| 兵种 | 内容库「兵种」类别（模块 3） | 表单 + 克制行（`dealMultiplier` 逐兵种倍率表，非两列多选） |
| 建筑 warEffects | 建造定义已有「专属属性(JSON)」域 | 可选加 6 个数字输入的可视化面板（字段固定） |
| 地势 buffZone | 场景编辑器已有 buffZone 多边形编辑 | effect 里加 `kind: terrainCombat` 下拉 + tags 多选 + 修正数字 |
| 工事 | 场景编辑器 placement（kind: structure） | 选 kind → 画布落点（复用现有 placement 交互） |

**校验**（`SkeletonAssetValidator` 同款风格，非致命 `warnings`）：
- 军阵 `slots` 里的兵种 id 不存在 → 警告
- `rows` 里某行 `slots` 数 ≠ `columns` → 警告（允许，但提示会留空位）
- `formationIds` 引用了不存在的军阵 → **错误**（当前 14 处悬空引用，落地时必须先补数据）

---

## 10. 分级交付

| 级别 | 内容 | 验收 |
|---|---|---|
| **5A 数据补齐** | `formations[]` + `heroes[]` 注册表 + 14 处 `formationIds`/`commanderHeroId` 落地 + Registry 注册 | 引用闭合零悬空；编辑器能增删改；既有测试全绿 |
| **5B 军阵部署** | `FormationResolver` + `BattlefieldRuntimeSystem` 按 rows/columns 打槽位 + `stanceByRole` 映射 + **主将按 `deploySlot` 入场 + 两个部署入口（大地图默认 / `PRE_BATTLE` 临时+设为默认）+ 接战 `DEPLOYED` 锁死（§6.3）** | 战场里单位按军阵站位；主将按战前部署位置入场；接战前后各能调一次、接战后改部署被拒（`DEPLOYMENT_LOCKED`） |
| **5C 三层修正 + 地势** | `CombatModifierPipeline` 纯函数 + `buffZone.terrainCombat` + 建筑 `WarEffectAggregator` 提引擎 | 高台弓兵真的更远；S10 建筑效果行为不变；克制/阵型/地势叠乘在 clamp 内 |
| **5D 编辑器与校验** | 军阵网格编辑器 + 兵种/武将类别 + 校验告警 | 策划可独立配一套军阵并跑通一场战斗 |

---

## 11. 零回归与风险

| 风险 | 处置 |
|---|---|
| 补 14 处 `formationIds` 数据量大且易错 | 先写"最小 6 军阵"（每策略一个通用模板），`battles/*.json` 改为引用通用模板，后续再细分 |
| `WarEffectAggregator` 与 S10 私有实现不等价 | 逐项对齐 6 个字段与 alive 判定；先跑 S10 回归再删旧代码 |
| `CombatModifierPipeline` 与 `CombatSystem` 现有伤害公式打架 | 首版只在 `BattlefieldRuntimeSystem.evaluateOutcome` 用，`CombatSystem` 通过开关逐场景接入 |
| buffZone 加 `terrainCombat` 影响既有 buffZone | `kind` 缺省不等于 `terrainCombat` → 旧区域行为完全不变 |
| 军阵 linux 与兵种表双源 | 军阵 `slots` 只存兵种 **id**，不存数值；数值只在 `unitTypes[]` |

---

## 12. 开放问题（默认值已选）

| # | 问题 | 默认 | 若选另一种的差异 |
|---|---|---|---|
| 1 | 军阵策略数量 | **6 种**（line/wedge/crane/fishscale/circle/echelon） | 更多（8-12）：编辑器与平衡工作量翻倍；更少（4）：战术差异不明显 |
| 2 | 阵型是否养成 | **不养成**，纯选择 | 加熟练度：与模块 1 熟练度系统重叠，需统一 |
| 3 | 军阵克制是否成环 | **无克制关系**（定稿 P3：阵法只提供加成，强弱差异只由 `modifiers` 数值 + 场景标签/地形偏好匹配度体现） | 原"不成环两两强弱"及"强/弱标签 UI"**均已作废**（v2.3 清除）；成环更要不得：与兵种克制形成两套系统 |
| 4 | 修正层 clamp | **单层 [0.6,1.6]，总 [0.4,2.2]** | 更宽：数值爆炸风险；更窄：玩家感知不到选择差异 |
| 5 | 主将是否下场 | **一律下场参战**（v2.2 裁定，推翻原「不下场」）——位置由武将类型 + 军团战前部署控制（猛将 `front` / 智将 `mid`~`rear`）；预演阶段仍只按数值参与抽象结算 | 不下场（旧定稿）：光环与"主将在场"脱节，玩家选旁观/支援时军团缺一个可见核心——**已作废** |
| 6 | 地势是否用 buffZone | **用 buffZone**（零新载体） | 新 `terrainEffects` 顶层键：结构更清晰但要新收集/投影链 |
| 7 | 工事是否可配置 | **`ARMY_CONSTRUCTION_DEFS` 迁到 `game.project.json.armyWorks`** | 保持引擎常量：策划改不了数值 |
| 8 | warEffects 是否含资源 | **不含**（只士气/饥荒/速度/伤亡/防御） | 含资源产出：与模块 2 配给耦合，需明确结算时机 |
| 9 | 建筑效果半径 | **缺省全局**（按阵营过滤） | 必须半径：老场景 400+ 建筑要补坐标，数据量大 |
| 10 | 阵型崩塌阈值 | **前排全灭 或 士气<30** | 只看士气：前排被打光仍"阵型完好"很假 |
| 11 | 编辑器军阵粒度 | **行列网格**（行数可变） | 自由拖放槽位：表现力强但编辑器成本高 |
| 12 | 阵型选择 UI 显示什么 | **只显示三类信息**：数值修正 + 适用场景标签（均衡/突破/包围/持久/防守/远程输出）+ 地形偏好（契合/不契合）。**删除两两强弱成对声明**（v2.3 第六次拍板：保留 P3「阵法无克制」，强弱靠数值与场景匹配体现，不写"强于某阵"） | 原方案"显示强/弱标签"作废：会诱导玩家认为存在克制环，与 P3 定稿冲突 |
| 13 | 战前部署入口几处、何时锁 | **两处入口**：①大地图设默认值 ②进战场 `PRE_BATTLE`（接战前）临时调整 + 「设为默认值」勾选；**接战即 `DEPLOYED` 锁死**（v2.3 第六次拍板） | 只留大地图：地形战前不可见，等于阵法盲选；只留战场：自动战（玩家不在场）永远无法部署；进战场即锁：等于把 ② 降级为只读确认页（不改结构） |
