# 模块 3（v2 修订）：两层级军团体系——自动化指令 + 随行小队

> 状态：设计稿 v2（2026-11-09 用户裁定简化，**取代 v1 的五军编组/多姿态/接管设计**）
> **v2.3 修订（2026-11-09 第五次拍板）**：①军团**兵种构成 / 军团阵型（布阵）/ 主将位置**全部归「战前部署」，**战中锁死不可改**（任何入场身份，含参战）；②战中只有「参战」身份可下**将令**（姿态切换 / 集火目标 / 撤退）；③`companionSquad` 补**小队层士气 `morale`**（初值/变动/恢复/下限/镜像规则）；④`tacticalRetreatMorale` **6 → 3**（保持"逃亡 > 战术撤军"的惩罚次序）。详见 §3.2、§4.1、§4.2 与 [模块 6](06-battle-plan-intervene.md) §3.6/§3.7
> 归属：[军需—配给—押运—军团体系总纲](spec.md) 模块 3
> 用户裁定原文要点：①只要两个层级——大方向针对军团/城池/关卡/军营的自动化操作（进攻/防守/运输/移动/扎营），操作过后自动执行（如自动进攻某城池）；②小队指令（跟随/进攻/防守/冲锋/撤退）属于玩家 ARPG 时额外带领的将领/士兵 NPC，NPC 自动攻击，不需要复杂微操，只要基础策略操作。

---

## 0. v1 → v2 砍掉了什么（修订说明）

| v1 设计 | v2 处置 | 理由 |
|---|---|---|
| 五军编组选择槽循环（武将→全军→前/后/左/中/右军） | **彻底去除（v2.2 二次裁定 2026-11-09）**——含内部 squads 分队数据；随行队是整体一队，自动化编排按整体阵型偏移（网格），不再按分队 | 用户明确去掉五军区别 |
| 8 姿态（assault/hold/advance/retreat/rescue/garrison/escort/flee） | 收敛为**玩家可见 5 档**（跟随/进攻/防守/冲锋/撤退）；rescue/garrison/fleet/advance 降级为剧情/AI 内部保留 | 小队指令五档即用户原话 |
| 军团指令含"布阵 formation" | **保留但改归类（v2.1 保留 / v2.3 归部署）**——布阵 = 设置阵法（不同阵法攻防加成不同），属**战前部署**（非战斗状态可改，战斗中锁死）；层级一玩家可下的战略指令为进攻/防守/运输/移动/扎营五条 | 用户确认阵法加成需要玩家可选，同时裁定"军团兵种、布阵、主将位置都是战前部署，战斗中不能修改" |
| 军阵 6 策略玩家选择（模块 5） | **简化为阵法选择**——玩家只从预设阵法列表里选一个挂上（加成不同）；行列编辑/策略模板仍不做，部署形状归 AI 内部 | 保持自动化简洁，阵法只是"加成预设" |
| 介入窗口 / 观战-下场-遥控三选 / 将令点数（模块 6） | **整体作废**——**玩家在场即介入，不在场即自动结算**；「将令点数」不复存在，但**将令本身**在 06 v4 以"仅接管身份可下"的形态保留（姿态切换/集火/撤退，无点数消耗） | 最简语义，零 UI |
| 接管军团（大地图→场景换绑） | **砍**——玩家永远是 ARPG 主角，军团自动作战不需要接管 | 用户未再提 |
| 警戒圈/视野扇/痕迹 T2/T3 玩法（模块 4） | **砍**——痕迹保留 T1 纯表现 | 用户未再提可视化指挥 |
| 主将/副将 buff 系统 | **保留数据字段 + 极简光环**（不做养成）；**v2.2：主将一律下场参战**，位置由战前部署控制（模块 5 §3.3/§6.3） | 招募对话需要带队字段；主将下场让"军团核心"可见，但不做成长线 |

---

## 1. 两层级定义

```
层级一：自动化指令（战略层，玩家下"大方向"）
  对象：军团 army / 城池 city / 关卡 pass / 军营 camp   ← 统一称「武装单位」
  战略指令：进攻 / 防守 / 运输 / 移动 / 扎营（五条，数据表驱动；未接战时可改）
  战前部署：兵种构成 / 军团阵型（布阵）/ 主将位置（非战斗状态设置，战斗中锁死）
  执行：下完指令 → 自动执行循环接管（编队→寻路→接战→结算→入档），玩家可离场
  
层级二：随行小队（战术层，玩家 ARPG 时的陪伴 NPC）
  对象：玩家身边带的将领/士兵（亲卫队 0~100 实体，上限由统率+官职决定；另统兵 ≤10000 抽象兵力，见 §4.1）
  指令：跟随 / 进攻 / 防守 / 冲锋 / 撤退（五档切换，整体一队无分队）
  战中补充：玩家以「接管」身份进入战斗时，另可下**将令**（姿态切换 / 集火目标 / 撤退），仅影响本次战斗
  执行：NPC 自动索敌自动攻击（现有 CombatSystem 击杀链），玩家只切档
```

**两层的分界线**：层级一的单位**不在玩家所在场景**或**不贴身**——它们自己打；层级二的单位**贴身跟玩家**——在玩家视野里一起打。同一批兵可以两属：军团主力留在层级一自动跑，抽一小队编入随行（层级二）。

---

## 2. 与现有系统的关系（复用判断）

| 现有系统 | v2 关系 |
|---|---|
| `ArmyCommandSystem`（选择槽/姿态/阵型偏移/命令倒计时/搬运） | **复用内核，砍玩家编组 UI**：内部 squads/阵型偏移/倒计时照旧驱动士兵；`ARMY_SELECTION_SLOTS` 编组循环不再作为玩家入口（随行小队全体视为一组） |
| `STANCE_PROFILES` 8 姿态 | **复用**：玩家 5 档映射 escort→跟随、assault→进攻、hold→防守、charge（新）→冲锋、retreat→撤退；其余 4 档保留给剧情（rescue）/守城 AI（garrison）等 |
| S02 剧情命令先例（`army.march`/`army.camp` 下发后自动执行） | **就是层级一的原型**——v2 把它从"剧情专用"泛化为"玩家可下"，执行模型不变 |
| `SceneArmyCommandFlow`（单位注册/开战检测） | **原样复用**，随行小队就是它注册的单位子集 |
| `BattleSystem` INTERVENE/OBSERVE（`filterEffectAmount` 已实现"在场才造成伤害"） | **复用**："在场即介入"引擎已支持——玩家实体在战场则 INTERVENE，不在则纯 OBSERVE 自动结算，**不需要玩家选择** |
| `CityWarSystem` / `BattlefieldRuntimeSystem.evaluateOutcome` | **原样复用**（自动结算链） |
| `CityPanel` 城池卡攻击/输送（模块 7） | **保留，升级为层级一主入口** |

**指令数据驱动还是分支代码？** 仍是数据驱动：`game.project.json.armyOrders` 五条**战略指令** → 各自落到既有的 `startMarch`/`applyStance`/`startConstruction(camp)`/`convoy`（模块 2）/城池战（`CityWarSystem`）；**布阵归战前部署**（`army.deploy.commit`），不占战略指令位。

---

## 3. 层级一：武装单位与自动化指令

### 3.1 武装单位数据模型（`blackboard.armyStates` 统一表）

```jsonc
{
  "id": "unit.s11_guangzong.garrison",     // 军团/城池驻军/关卡守军/军营
  "kind": "city",                          // army | city | pass | camp
  "factionId": "yellow_turban",
  "sceneId": "S11",                        // 所在场景锚点
  "position": { "x": 1200, "y": 800 },
  "roster": { "shield": 20, "spear": 30, "archer": 15 },   // 兵种构成（部署类，战中锁死）
  "commanderHeroId": "hero.zhangjiao",     // 谁带队（极简光环，无养成；主将一律下场，见模块 5 §3.3）
  "formationId": "formation.s11.line",     // 当前阵法（部署类，战中锁死；非战斗状态经战前部署设置）
  "deployment": {                           // 战前部署默认值（v2.3；入口①大地图设默认、入口②战场 PRE_BATTLE 可临时覆盖并勾选回写；接战（DEPLOY_LOCKED）后一律不可改，见 §3.2）
    "committed": true,                      // 默认值已提交（true 表示可被自动战直接采用；不影响 PRE_BATTLE 本场覆盖）
    "committedAt": 1720000000,              // 提交时间（幂等/回放用）
    "roster": { "spear": 6, "archer": 4 },  // 兵种构成（可选；空则取军团现有 roster）
    "formationId": "formation.s11.line",    // 阵法（可选；空则取 §formationId）
    "commanderSlot": "mid",                 // 主将下场位置 front | mid | rear（猛将 front / 智将 mid~rear）
    "deputySlots": ["front"]                // 副将位置（与主将同域，可空）
  },
  "order": {                                // 当前战略指令（五条之一；布阵不在此）
    "type": "attack",                       // attack | defend | transport | move | camp
    "target": { "kind": "city", "id": "city.s12_xiacuyang" },
    "issuedDay": 3
  },
  "morale": 80,                             // 军团层士气（与随行小队层 morale 独立，见 §4.1）
  "supply": { "food": 120, "days": 6 }
}
```

- **城池本体**仍在 `cityStates`（模块 7 不动）；城池**被攻打/出征时**以 `kind:'city'` 的 ArmyState 参与层级一（驻军=roster）。
- **关卡 pass**：隘口/城门类咽喉点，`defend` 时封锁通路（模块 4 的隘口数据已有落点）；被打下则通行权易主。
- **军营 camp**：驻扎点，`camp` 指令的落点；玩家寨子就是一座军营。

### 3.2 指令分类（部署 / 战略 / 将令）→ 执行落点

**先分类、再看落点**——这是 v2.3 的核心划分：**部署类战中锁死，战略指令只在非战斗时能改，将令只有接管身份能下**。

| 类别 | 内容 | 下达时机 | 战中能否改 | 下令身份 | 落点 |
|---|---|---|---|---|---|
| **部署类（接战锁死）** | 兵种构成 `roster`、军团阵型/布阵 `formationId` + `rows`、主将/副将位置 `deployment.*` | **两处入口**：①大地图非战斗状态（设默认值）②进战场 `PRE_BATTLE`（接战前临时调整 + 可选回写默认） | **不能**（接战后任何身份） | 军团主将 / 大地图「战前部署」入口 / 战场 `PRE_BATTLE` 部署页 | ①`army.deploy.preview` / `army.deploy.commit`；②`army.deploy.temp { battleId, ..., setAsDefault? }`；锁口 `battle.deploy.lock` → `CombatModifierPipeline` 军阵层生效 |
| **战略指令（非战斗）** | **进攻** | 大地图、未接战 | 已接战不可改（改走撤退将令） | 玩家（层级一） | `startMarch` → 遭遇战 → `evaluateOutcome` → `CityWarSystem` 入档 |
| | **防守** | 同上 | 同上 | 玩家 | `applyStance('garrison')` + 关卡封锁标记 |
| | **运输** | 同上 | 同上 | 玩家 | 模块 2 `convoy.assemble/dispatch` |
| | **移动** | 同上 | 同上 | 玩家 | `startMarch`（模块 4 通路 A*） |
| | **扎营** | 同上 | 同上 | 玩家 | `startConstruction('camp')`（campBuff 既有） |
| **将令（战中）** | 姿态切换（进攻/防守/冲锋/撤退档）、集火目标、撤退（战术撤军） | 战斗中实时 | 能 | **仅「接管」身份** | `unit.battleOrder { kind }`，只影响本次战斗，**不写** `order` |

- **部署为什么锁死**：兵种/阵型/主将位置是"这场仗带着什么样的军队打"，战前定死才能让战前决策有分量；若战中可改，玩家会反复切阵法刷最优解，也架空了"战前部署"这个玩法。
- **将令为什么不写 `ArmyState.order`**：将令是"这一仗怎么打"的临阵指挥，战斗结束即失效；战略指令是"这支军团接下来做什么"，跨场景/跨日持续。两者混写会导致战斗结束后军团状态被将令污染。
- **门控实现**：`unit.setFormation` / `army.assignFormation` / `army.deploy.commit` 在 `DEPLOY_LOCKED` 期一律拒绝（`DEPLOYMENT_LOCKED`）；`unit.battleOrder` 校验"该战斗身份 === takeover（`'command'` 为兼容别名）"（详见 [模块 6](06-battle-plan-intervene.md) §3.6）。
- **布阵不再"交战中切换 3s 硬直"**：该设定随"部署锁死"作废（见 §11 #13 已更新）。

### 3.3 自动执行循环（`StrategicAdvanceSystem`，模块 4 保留的核心）

- 每 500ms 战略刻：沿通路推进 position → 检测遭遇（遇敌自动打）→ 补给扣减 → 到达判定 → fire `army.arrived`/`army.encounterResolved`。
- **玩家不需要在场**：战斗自动结算（抽象战果）；若玩家恰好在目标场景，实体展开进入实时战斗（玩家在场即介入，见 §4.3）。
- 指令完成/失败都发事件（`army.orderCompleted` / `army.orderFailed`），由触发器接管剧情。

---

## 4. 层级二：随行小队（五档 + 自动战斗）

### 4.1 随行队数据（v2.2：亲卫 ≤100 实体 + 统兵 ≤10000 抽象兵力）

```jsonc
// storyState 扩展（入档）
"companionSquad": {
  "unitIds": ["u.guard_1", ...],       // 0~100 人；无分队概念，整体一队
  "stance": "escort",                   // 当前五档之一
  "morale": 72,                         // 小队层士气（v2.3 新；独立于军团层 ArmyState.morale）
  "moraleLedger": {                     // 小队层士气的变动台账（可审计、读档幂等）
    "lastRestDay": 12,                  // 上次休整恢复的日序（同日不重复恢复）
    "lossThisFight": 0,                 // 本场亲卫阵亡总数（用于 -2/人、单场上限 -10 的计数）
    "lastBattleId": "battle.s11.03"     // 本场战斗 id（换场重置 lossThisFight）
  }
},
"playerRank": {                         // 官职（影响随行上限）——阶梯见 decisions §2-P1
  "rankId": "rank.xiaowei",             // 指向 game.project.json.ranks[]；null = 白身
  "title": "校尉",
  "value": 35,                           // 官职值 0~100（100 = 大将军，唯一顶点；无爵位维度）
  "kind": "post"                         // 军职（唯一取值；爵位不建模）
},
"armyPool": {                            // 统兵池（抽象兵力，不落实体）——定稿 P1e
  "troops": 4500,                        // 当前统兵 = 各兵源武装单位兵力之和
  "cap": 4500,                           // 上限 = 亲卫上限 × 100 = (统率+官职)×50，满值 10000
  "replenishFrom": ["city.guangzong", "camp.main"]   // 兵源优先级：在场城池/关卡/军营 → 玩家出身点
}
// 随行上限 = floor(统率 × 0.5 + 官职 × 0.5) = ⌊(统率 + 官职) / 2⌋（定稿 P1：无基础项；各封顶 100 → 满值 100，恰合 10×10 网格）
// 统率来源：heroes 表 commander.command 字段（语义由"可带军团数"改为"统率值"）
// 统率同时决定管理容量：1 点 = 可控 1 个武装单位（定稿 P1b，上限 100）
// 官职阶梯：0 白身 / 5 伍长 / 10 什长 / 15 都伯 / 20 屯长 / 25 军侯 / 30 曲长 / 35 校尉 / 40 中郎将 /
//          45 牙门将 / 50 偏将军 / 55 裨将军 / 60 杂号将军 / 65 四安 / 70 四镇 / 75 四征 / 80 四方 /
//          85 卫将军 / 90 车骑 / 95 骠骑 / 100 大将军（唯一顶点，无更高档）
// 只有军职一条轨：ranks[] 全部 kind:"post"，无爵位维度、无取高/叠加规则
// 统兵上限 = 亲卫上限 × 100（1 亲卫 = 1 个百人队的尖兵代表；大地图自动战/抽象结算直接消费兵力数字）
// 亲卫阵亡 → 按兵源优先级扣 1 兵力 + 约 8 秒后从入场点跑入补位；城池被围/通路断 → 补充中断；兵源枯竭不补；战后满编重建（定稿 P1e）
```

- **来源**：招募（模块 7）后"设为随行"（从某军团/军营 roster 抽人）。
- **无分队**：前/中/后/左/右军概念彻底去除——`ArmyCommandSystem` 的 `squadPresets`/选择槽在随行侧不再使用，跟随阵型用整体网格偏移（`FORMATION_SPACING` 既有算法，按 10×10 网格展开）。
- **性能边界**：100 实体同屏在现有 ECS 场景已验证可行（S13 城战规模）；实体进场景才展开（roster 数字不占性能）。

**小队层士气规则（v2.3 补，与军团层士气是两本独立的账）**

| 项 | 规则 |
|---|---|
| 归属 | `storyState.companionSquad.morale`——**小队层**；军团层是 `blackboard.armyStates[].morale`。两层各自有初值、变动、恢复、下限，**互不自动传导** |
| 初值 | 从来源军团抽人入随行时为来源军团 `morale`；新招募入随行 60 |
| 变动 | 亲卫阵亡 **-2/人**（单场封顶 **-10**）；连续 **3 日未休整** -3/日；玩家亲自逃亡 **-5**；战斗胜利 **+5**；军营驻扎 **+2/日**（与休整叠加取高，不叠乘） |
| 恢复 | 休整 **+3/日**（`moraleLedger.lastRestDay` 保证同日不重复） |
| 上下限 | `clamp [5, 100]`（下限 5 防归零；`< 10` 触发下方惩罚） |
| 低士气惩罚 | `< 10` 时**锁定「防守」档**、拒绝「冲锋」档（HUD 上冲锋按钮置灰），恢复 ≥10 解锁 |
| 镜像规则 | **玩家自己就是该军团主将时**，小队层 = 军团层（同一数值镜像显示、不独立扣减）；只有"跟随他人 / 支援他人"时小队层独立记账（对应模块 6 支援身份） |
| 入档 | `morale` 与 `moraleLedger` 一起入档；变动走幂等键（`lastBattleId` + 日序），读档不重复结算 |

### 4.2 五档指令（玩家唯一操作）

| 档 | 映射姿态 | 行为 |
|---|---|---|
| **跟随** | `escort` | 跟在玩家身后 2~3 身位，敌进警戒圈自动打（现状） |
| **进攻** | `assault` | 向玩家最近攻击目标/玩家目标推进接敌，自动打 |
| **防守** | `hold` | 原地驻守，敌进圈才打 |
| **冲锋** | `charge`（新） | 速 ×1.6 直扑最近敌群，4s 后自动转进攻 |
| **撤退** | `retreat` | 向玩家身后脱离，边撤边打（engageWhileMove 现有） |

- **撤退的士气代价**：军团级战术撤军（层级一 `unit.order{order:'retreat'}`）**士气 -3**，参数名 `tacticalRetreatMorale`，落点 `game.project.json.armyOrders.tacticalRetreatMorale`（**v2.3 由 6 下调为 3**）。
  - 理由：必须**低于逃亡首档 -5**（模块 6 §5.4 逃亡阶梯 -5/-10/-15/-20/-25 → 封顶 -30），否则玩家会选择"直接逃亡"而不是"有组织撤军"，撤军档失去意义；下调后次序为「战术撤军 -3 < 逃亡首档 -5 < 连续逃亡/战败阶梯」。
  - 与逃亡的区别：撤军是**主动的战术退却**（部队建制完整、回到己方阵地继续作战，可再接管）；逃亡是**溃逃**（退出本场、不能再次接管、退回最近军营 + 部队交预演接管）。二者不同源、不同账，不会双扣。
- **随行小队撤退**（五档 `retreat`）**不额外扣士气**——它是玩家的即时操作，不是军团级撤退决策；小队层士气只在亲卫阵亡 / 逃亡 / 胜利 / 休整时变动（§4.1）。

- **自动战斗零微操**：索敌/攻击/击杀走现有 CombatSystem 链（伤害数字/战利品/enemy.killed 全自动），玩家不逐个点人。
- **AI 兜底**：玩家不给指令时默认"跟随"；玩家倒地（plotDowned）时随行队自动转"防守"护主。

### 4.3 "在场即介入"（替代模块 6 整套介入系统）

- 玩家在战场场景 → 玩家实体参战（`filterEffectAmount` 自动放行玩家伤害）+ 随行队五档生效；**这就是全部的"玩家介入"**。
- 玩家不在 → 纯抽象结算（`evaluateOutcome`），战果入档发事件。
- **无模式选择 UI、无介入窗口**——模块 6 的 `PreBattlePlanView`/`BattleModeView` 强选流程/`commandPoints` 全部作废；`BattleSystem.selectMode` 保持现状（场景加载时按玩家是否在场自动定，不弹窗）。
- **与模块 6 v4 的关系**：v4 把"在场"细分为接管/支援/旁观三种入场身份；**部署类锁死、将令仅接管**（§3.2）与本文件同日对齐，不存在两套口径。详见 [模块 6](06-battle-plan-intervene.md) §3.6/§3.7。

### 4.4 玩家倒地掉落（v2.2 用户裁定：鼓励穿戴、鼓励战斗）

> **定稿修正（P8）**：改为**背包内随机 1~3 件装备或材料、零损耗**；已穿戴不掉、钱包数字不掉、剧情豁免。原「全部背包掉落 + 每件 roll 10%~25% 损耗」作废。以 [decisions.md](decisions.md) §2-P8 为准。

| 规则 | 内容 |
|---|---|
| 触发 | 玩家**战斗倒地**瞬间（`plotDowned` 置位且非剧情豁免，见下） |
| 掉落范围 | **背包内全部装备与物资**（`InventoryComponent` 全量）；**已穿戴装备不掉**（`EquipmentComponent` 装备槽）——穿戴才安全，鼓励把好装备穿上 |
| 损耗 | 掉落生成时每件独立 roll **10%~25% 随机损耗**（堆叠物按比例扣数量；不可堆叠装备按概率直接损毁） |
| 归属 | 掉落物地面投影带 `ownerId`；本人/友方拾取无惩罚，敌方 NPC 拾取后归 NPC 临时持有 |
| 敌方拾取 | 新增 NPC「拾取」AI 行为（靠近掉落物 → 拾取 → 物品挂 NPC `_carriedLoot`）；**击杀该 NPC 可夺回其全部持有物**（走既有 lootTable → generateLoot 战利品链） |
| 恢复 | 玩家起立后回原地拾取剩余掉落；掉落物超时（默认 2 游戏日）消失 |
| 剧情豁免 | 剧情昏倒（S02 faint，`plotCause:'story'`）**不掉落**——避免剧情链物品凭空损失 |

- 实现落点：倒地状态转换处挂 `inventory.dropAll`（新命令：`InventoryTransactionService` 批量转移 + 损耗 roll）→ 既有 `generateLoot` 地面掉落链 → NPC 拾取为新增 AI 行为；全程事件化（`player.downedDropped` / `npc.lootPicked` / `player.lootRecovered`），触发器可编排（如"夺回物资"任务）。

---

## 5. 状态机

### 5.1 武装单位（层级一）

```
IDLE（无指令，驻守）／任意战略态
  →(进入战场、未接战) PRE_BATTLE（战场内部署页可临时调整；勾"设为默认"回写军团默认值）
  →(接战 battle.deploy.lock) DEPLOY_LOCKED（兵种构成 / 军阵阵型 / 主将位置冻结；只受理将令）
      ├─ 接管身份：可将令（姿态切换 / 集火 / 撤退）
      └─ 支援/旁观：无指挥权，只可操作自己的亲卫（支援）或完全不可操作（旁观）
  →(战斗结束) IDLE（解锁部署，可重新战前部署）
  →(战败/逃亡) 见模块 6 §5.4/§5.5 两本账

IDLE
  →(五条战略指令) EXECUTING → 自动执行循环
      ├─ attack/move/transport：行军 → 接战(自动打) → 完成 → IDLE + orderCompleted
      ├─ defend：进入防御态（常驻，直到换指令）
      └─ camp：扎营完成 → CAMPED（buff 生效）→ (拔营/换指令) IDLE
EXECUTING →(无通路/目标失效) IDLE + orderFailed
```

### 5.2 随行小队（层级二）

```
ESCORT ⇄ ASSAULT ⇄ HOLD ⇄ CHARGE(4s→ASSAULT) ⇄ RETREAT
任一档 →(玩家倒地) 自动 HOLD 护主 →(玩家起立) 恢复原档
任一档 →(小队层士气 <10) 锁定 HOLD、拒绝 CHARGE →(士气恢复 ≥10) 解锁
```

---

## 6. 数据落点

| 数据 | 落点 | 变化 |
|---|---|---|
| 武装单位 | `blackboard.armyStates[]`（含 kind 四类） | v1 的 ArmyState 扩 kind 字段 |
| 战前部署 | `blackboard.armyStates[].deployment` + 同处 `roster` / `formationId`（战中锁死） | v2.3 新 |
| 五条战略指令映射 | `game.project.json.armyOrders` | 布阵移出（归战前部署） |
| 战术撤军士气 | `game.project.json.armyOrders.tacticalRetreatMorale` | **v2.3：6 → 3** |
| 随行队 | `storyState.companionSquad` | 新 |
| 小队层士气 | `storyState.companionSquad.morale` + `moraleLedger` | **v2.3 新**（与军团层 `armyStates[].morale` 独立） |
| 玩家五档 | `CommandStateComponent.stance` | 复用，charge 值新增 `ARMY_STANCES` |
| checkpoint | `gameplay.armyStrategic`（注册点同 v1） | 不变 |
| 兵种克制 | `library.json.unitTypes[]`（模块 5 数据保留） | 纯 AI 结算用，玩家 UI 不展示克制教学（教程砍） |

---

## 7. 命令 / 事件 / 触发器

### 7.1 命令（`ScenarioCommandService` → `SanguoDomainCommandFacade`）

| operation | payload | 语义 |
|---|---|---|
| `unit.order` | `{ unitId, order, target }` | 层级一**战略指令**（五条：进攻/防守/运输/移动/扎营；查 armyOrders 表；布阵不在其中） |
| `unit.order.cancel` | `{ unitId }` | 撤指令回 IDLE |
| `unit.setFormation` | `{ unitId, formationId }` | **部署类**：设置阵法（校验阵法存在）——仅非战斗状态受理，战斗中拒绝 `DEPLOYMENT_LOCKED` |
| `army.deploy.commit` | `{ armyId, roster?, formationId?, commanderSlot?, deputySlots? }` | **战前部署提交**（入口 ① 大地图设默认值；兵种构成 / 阵型 / 主将位置三件套一次提交）——仅非战斗状态；提交后 `committed:true`，接战即冻结 |
| `army.deploy.temp` | `{ battleId, armyId, roster?, formationId?, commanderSlot?, deputySlots?, setAsDefault? }` | **本场临时部署**（入口 ② 战场 `PRE_BATTLE`，接战前）：只写 `battle.deploymentOverride`；`setAsDefault:true` 时同步走 ① 回写默认值；接战后拒绝 `DEPLOYMENT_LOCKED` |
| `unit.battleOrder` | `{ unitId, kind:'stance'\|'focus'\|'retreat', stance?, targetId? }` | **将令**：姿态切换 / 集火目标 / 撤退——仅「接管」身份受理，只影响本次战斗、不写 `order` |
| `army.recruit` | `{ fromCityId, unitType, count }` | 招募入军团（模块 7 三路径不变）——**编制变更，属部署类**（战斗中拒绝） |
| `army.form` / `army.disband` | `{ ... }` | 组建/解散军团（v1 保留） |
| `companion.assign` | `{ unitId, unitType, count }` | 从军团/军营抽人入随行队 |
| `companion.stance` | `{ stance }` | 五档切换 |
| `companion.dismiss` | `{ unitIds }` | 随行队遣返 |
| `inventory.dropAll` | `{ cause:'combat'|'story' }` | 玩家倒地掉落（含 10%~25% 损耗 roll；story 豁免） |

### 7.2 事件

`unit.orderIssued` / `unit.orderCompleted` / `unit.orderFailed` / `unit.encounterResolved` / `army.formed` / `army.disbanded` / `companion.stanceChanged` / `companion.memberDowned` / `camp.laid`（沿用 `armyCampLaid`）/ `player.downedDropped` / `npc.lootPicked` / `player.lootRecovered`

### 7.3 任务接法

- 招募 N 人：`custom.event:army.recruited` 累加（模块 7 已列）。
- 攻下某城：`commit.fact('unit.encounterResolved')` + payload 过滤（kind=city 胜利）。
- 用冲锋打赢一场：`custom.event:companion.stanceChanged` + 战果组合。
- 首版全走 `custom.event`，稳定后登记 `ObjectiveTypeRegistry`。

---

## 8. UI 入口

| 入口 | 形态 | 端 |
|---|---|---|
| 大地图点武装单位 | 简化指令环：五条战略指令（进攻/防守/运输/移动/扎营）+ **「战前部署」页签**（兵种构成摘要 + 阵法选择（显示各阵法攻防加成）+ 主将/副将位置）+ 目标选择（敌城/友城/地图点/军团） | PC 右键菜单 / 手柄 A 菜单 / 触屏点选 |
| 城池卡 | 模块 7 已设计（攻击/输送 = 层级一指令的两条别名入口） | 三端一致 |
| 随行队 HUD | `CompanionGridHud`（新）：**10×10 小方格阵**——每格 = 成员姓氏首字 + 底部细血条（WoW 团队框体缩小版，≤100 格），死亡格置灰、倒地格闪烁；方格阵上方单排五档按钮（跟/攻/守/冲/撤） | PC 1-5 快捷键 / 手柄方向+X / 触屏按钮 |
| 招募对话 | NPC 对话「花费 xx 铜钱，招募 xx 人」（用户原话）→ `army.recruit` | 走对话系统 |

- **砍掉的 UI**：编组选择条、Tab 循环、姿态面板 Row2、战前计划面板、模式选择弹层、战场 HUD、战果复盘卡、警戒圈/扇/痕迹交互。

---

## 9. 分级交付（v2）

| 级别 | 内容 | 验收 |
|---|---|---|
| **3A 随行小队** | companionSquad + 五档（charge 新增）+ HUD 单排 + 自动护主 | 五档切换即时生效；NPC 自动打全程无微操；倒地自动转防守 |
| **3B 武装单位 + 五指令** | armyStates 四 kind + unit.order 表驱动 + 自动执行循环 + `army.deploy.commit`（战前部署）/ `unit.battleOrder`（将令） | 对城池下"进攻"→ 全自动打完入档；下"扎营"→ buff 生效；**战斗中改部署被拒、将令只有接管身份能下** |
| **3C 关卡与军营** | pass 封锁通路 + camp 驻扎强化 + 招募三路径（模块 7） | 关卡易主后通路变化；军营可扎营可出兵 |
| **3D 存档与剧情接线** | capture/restore + 触发器事件 + S02 命令迁移到 `unit.order` | 读档还原全部单位状态；S02 剧情链行为不变 |

---

## 10. 对其他模块的连带修订（已执行，2026-11-09 v2.3）

| 模块 | 修订点 |
|---|---|
| 04 大地图 | 砍：接管军团/警戒圈/视野扇/痕迹 T2T3/消灭踪迹/城池 objective 罗盘；留：通路 A*+预烘焙通行色、ArmyState+战略刻（§3.3 即其核心）、遭遇检测；UI 改"点单位→五条战略指令 + 战前部署页签（兵种摘要/阵法/主将位置）"——**入口 ① 落在大地图（设默认值）；入口 ② 在战场 `PRE_BATTLE`（接战前临时调整 + 设为默认勾选）**，两处都不开 v1 那种独立战前计划大界面（理由见模块 5 §6.3） |
| 05 阵法地势 | 阵法保留玩家可设置（v2.1：六阵法 = 攻防加成预设）；**v2.2 主将一律下场 + 光环常驻 + 战前部署锁定**（05 §3.3/§6.1/§6.3）；行列部署模板/策略模板降为 AI 内部；三层乘算保留；编辑器兵种/军阵保留；`buffZone.terrainCombat` 保留 |
| 06 战斗执行 | **v4 三身份（接管/支援/旁观）+ 部署锁死/将令仅接管**（06 §3.6/§3.7）；03 的 `army.deploy.commit` 与 `unit.battleOrder` 即其数据源；v1 战前计划/模式强选已作废 |
| 07 内政 | 不变；城池卡"攻击/输送"确认为层级一别名入口 |
| 08 教程 | 台阶 4~6 缩并为 2 级（大地图指令含布阵 / 在场接管）；砍介入窗口教学、将令教学；约 26 条 → 约 17 条 |
| tasks.md | M6 阶段并入 M4；M3/M4 内容合并瘦身；必拍板清单重排 |

---

## 11. 开放问题（v2，默认值已选）

> **定稿状态**：本节 #2/#2b（P1 上限公式）、#13/#14/#16（P8 掉落）、#1/#10（P2/P6 势力与入口）等已定稿，取值以 [decisions.md](decisions.md) 为准；本节保留原始推演过程供追溯。

| # | 问题 | 默认 | 若选另一种的差异 |
|---|---|---|---|
| 1 | "NPC 控制"的授权范围 | **玩家势力 + 剧情授权的 NPC 势力**（如张角指挥黄巾各部） | 仅玩家势力：剧情指挥需另开口子 |
| 2 | 随行队上限公式 | **定稿：`统率×0.5 + 官职×0.5`（无基础项，满值 100）** | 纯统率：官职系统失去存在感；纯官职：升级动机单一 |
| 2b | 官职来源 | `game.project.json.ranks[]`——**定稿：0~100 共 21 级阶梯（每级 +5），100 = 大将军（唯一顶点，无爵位维度）**；剧情/战功晋升 | 不做官职：随行上限只看统率 |
| 3 | 冲锋档是否保留手动打断 | **不可打断**（4s 自动转进攻） | 可打断：微操回潮 |
| 4 | 自动进攻的战果粒度 | **抽象结算**（无实时战场） | 城池战进实时战场：回到 v1 复杂度 |
| 5 | 玩家在目标场景时的展开 | **实体展开实时战 + 随行队** | 仍抽象结算：玩家在旁边看数字变化，体验割裂 |
| 6 | 随行队阵亡 | **重伤退场（本场不复活）**，战后自动回 roster 疗养；**空位由统兵池按兵源自动补位（定稿 P1e）** | 死亡即损：随行兵源消耗感强但挫败 |
| 7 | 五指令是否需要确认弹窗 | **仅"进攻城池"需确认**（防误触） | 全免确认：误触代价大；全加确认：操作繁琐 |
| 8 | 多条指令排队 | **每单位同时只持 1 条指令** | 队列：自动化更智能但状态机复杂 |
| 9 | 指令执行中玩家能否亲临战场帮打 | **能**（在场即介入，不算指令变更） | 禁止：反直觉 |
| 10 | 关卡封锁对玩家通行的影响 | **敌对关卡拦玩家队伍（需战斗通过）** | 不拦玩家：关卡形同虚设 |
| 11 | 随行队与军团兵力双记账 | **随行=从 roster 抽出（单独实体）** | 随行仍计在军团 roster：抽调语义混乱 |
| 12 | 自动战斗的伤亡平衡 | **抽象结算伤亡表（克制/阵法/地势修正）** | 真实逐兵模拟：回到 v1 复杂度 |
| 13 | 阵法切换是否即时生效 | **战前部署阶段可改；战斗中锁死（不可切）**（v2.3 随"部署锁定"重定，原"交战中切换 3s 硬直"作废） | 战中可切：玩家无脑切最强阵、架空战前部署；更久硬直：阵法误选惩罚过重 |
| 14 | 掉落损耗区间 | **每件独立 roll 10%~25%** | 固定值（如 15%）：简单但无随机张力；更宽区间：挫败感波动大 |
| 15 | NPC 拾取后物品去向 | **挂 NPC `_carriedLoot` 临时持有，击杀夺回；NPC 离开场景/消亡则物品随之消失** | NPC 持久入库（入寨仓）：需给 NPC 建立库存持久化，成本高 |
| 16 | 剧情昏倒是否掉落 | **不掉**（`plotCause:'story'` 豁免） | 掉：剧情链关键物品可能丢进敌人手里，卡死任务 |
