# S09+ 任务链 × 军需/军团体系 · 可执行解决路径（v1）

> 状态：方案稿 · 2026-11-12 · 本文档**只出方案，不改数据/源码**
> 上游：[12-s09plus-alignment-review.md](12-s09plus-alignment-review.md)（30 条冲突）
> 口径：[decisions.md](decisions.md)（P1~P26）、[s02-任务方案.md](s02-任务方案.md)（v3）、
> [03](03-army-squads.md) / [05](05-formation-terrain.md) / [06](06-battle-plan-intervene.md) /
> [07](07-town-administration.md) / [09](09-food-logistics-economy.md) / [02](02-supply-escort.md)
>
> **两个硬前提**
> 1. 引擎同屏上限 **2000**：任何"人太多"的顾虑只按设计（节奏/可读性/操作半径）表述，不以性能为由缩兵。
> 2. **S02 正在按 `s02-任务方案.md` 落地，尚未完成**：本文所有方案不假设 `story.s02.allegiance.*`、
>    `army.player.escort`、80 黄巾 / 亲卫组已经存在；凡依赖它们的地方都标了"等 S02 批"。
> 3. **主线前提（2026-11-12）**：两条线**最终都继承张角势力**，主线目标是**一统黄河中下游平原**；
>    **不设难度系统**（不写 `run.difficulty`、不做成就），S09+ 的分档只按 `alignment`。分叉只影响体验与少量奖励，
>    后期由玩家自行调整，**后续 S09+ 融合不需要再区分难度**。

---

## 0. 一页结论

| 结构冲突 | 推荐 | 一句话 |
|---|---|---|
| A1 不加入线在 S09 断链 | **方案 A：同一主线、编制/体验差异** | 不写独立任务线；S09 加一个分支 + 放宽 1 处门控 + 补亲卫组 |
| A3 没有城导致军团层级不可达 | **方案 B：S10 迁营即得** | 张角病逝后主角带队自立，S10 溪畔新营转玩家所有（1 城 + 1 军营） |
| A4 亲卫绑张角 | **方案 A：新增 `hero.player`** | `companionRule.heroId` 指向玩家英雄；张角只在 S02 期作主控实体 |

**MVS 一句话**：S09 补分支 → 契约层（阵营键 + hero.player）→ S10 迁营转正（城 + 军营）→
S11/S12/S13 身份化 + 观战分支 → G 类数据修复。做完这五件事，军团按钮/粮草条/战果账在主线里
**真正跑起来**；编制 roster、招募补员、官勋、押运表全部可延后。

> **修订（2026-11-12，见 §1.4）**：A3 推荐改为**S02 举事营地转正给主角**（S02 末即解锁军团层），
> S10 降级为"扩营/搬址"。若 S02 实现线未采纳 §1.4.7 的同步清单，则 MVS 的 M4 回退为"S10 迁营即得"。

---

## 1. 三条结构性冲突的方案

### 1.1 A1：「不加入」线在 S09 断链

现状：S09 只有"回应张角入伍之邀"；`S09ClassSelectionFlow` 定职时写 `joinedYellowTurban: true`；
`S03S08SceneFlow` 门控 `joinedYellowTurban && classSelectionCommitted`。

| 方案 | 做法 | 成本 | 收益 | 风险 |
|---|---|---|---|---|
| **A. 同主线、编制差异（推荐）** | S09 `intro.opening` 后加 `branch`：`allegiance.joined` → 现有入籍链；`allegiance.independent` → 新对话 `dialogue.s09.independentArrival` + 目标"以游侠身份报备"（写 `state.player.alignment='independent'`）；`S03S08SceneFlow:34` 门控放宽为 `classSelectionCommitted && (joinedYellowTurban \|\| alignment==='independent')`；S09 加 `S09-player-escort` 组（`spawnWhen: independent`）+ `armies` 新增 `army.player.escort` | **中**（1 分支 + 1 处门控 + 1 军团定义 + 3~4 句分档台词） | 保留分叉的叙事价值与**体验差异**（s02 §4.0：不设难度，只差编制/可控对象/奖励），主线不膨胀；不新增场景/战役 | 两条线共用文本 → 需分档台词（S09 对话 + 张角口吻 2~3 处）；`independent` 线在 S11~S14 仍是"随黄巾作战"，需一句旁白解释 |
| B. 独立任务线 | S09 起真正分叉，新增 3~5 个独立任务 + 自建 2~3 场战役 + 独立结局输入 | **大**（新任务/对话/战役/结局） | 真正的分支重玩 | S03~S14 全是黄巾主线，独立线必须自建战役与结局；`endings.json` 的 `heroes.*.survived` 全不适用；工期不可控 |
| C. 删分叉，单一入伙 | 回退 s02 §4 分叉，只保留"加入" | **小** | 数据最干净 | 推翻 s02 已拍板内容（用户已定"两条线最终都继承张角势力，差异只在体验与少量奖励"），不建议 |

**推荐 A**，并在 s02 落地时同步把 `story.s02.allegiance.*` 作为唯一入伙事实（见 §4 契约）。

---

### 1.2 A3：玩家根据地从哪来（军团层级的前置）

现状：所有城市 `ownerFactionId` 只有 `yellow_turban` / `han_government`；S09~S14 无易主节点 → P2 恒不成立。

| 方案 | 做法 | 成本 | 叙事影响 | 数据量 |
|---|---|---|---|---|
| A. S09 营地转正 | `city.s09_guangzong_camp` 归玩家（`city.setFaction`/`city.capture`） | **小** | **差**：广宗大营是张角大营，新兵当"城主"不合理；s02 也明确"黄巾军营归张角" | 1 条 cityState 改 `factionId` + 3~5 句文案 |
| **B. S10 迁营即得（推荐）** | 张角病逝后主角带队沿溪立营：`city.s10_guangcheng_camp`（或新建 `city.s10_creek_camp`）转玩家；同时 `army.camp` + `camp.register('camp.s10.creek')` | **中** | **最顺**：从"张角的兵"变成"自己的营"，正好接 S11~S14 的自立线；也让 09 粮草/军营首次有主体 | 1 条 cityState + 1 个 camp + 2 条 scenario 调用 |
| C. 新给一座城（攻下广宗/下曲阳后） | S12 或 S13 后 `city.capture` 换主，接 07 内政/攻城 | **中~大** | 好，但要把 S11/S12 的"纯救援关"改成"救援 + 夺城"，节奏变重 | 1 座新城 + 攻城/易主战役 + 结局输入 |
| D. 不做（层级一延后到 S15+） | 军团按钮永远置灰，文案改"尚无据点" | **零** | **放弃**：M1~M9 在主线上只剩 S02 演一次，粮草条永远没有军营段 | 0 |

**推荐 B**；把 C 作为 S15+ 的"第一次攻城/内政"内容，D 只在工期极端压缩时兜底。

---

### 1.3 A4：亲卫绑在张角身上（S10 病逝）

现状：`companionRule.heroId = hero.zhangjiao`（[game.project.json:655](file:///d:/yijian18-engine/example/sanguo_zhangjiao/game.project.json#L655)）；`hero.zhangjiao` 是 `m0.placeholder`。

| 方案 | 做法 | 成本 | 收益 | 风险 |
|---|---|---|---|---|
| **A. 新增 `hero.player`（推荐）** | 新增 `hero.player {stats:{command:20}, rankId:'rank.wusheng', factionId:'player'}`；`companionRule.heroId` 改它；张角只在 S02 期作为**主控实体**（`army.possess`），不参与亲卫口径；`hero.zhangjiao` 补 command/rank 供剧情用 | **小**（1 条 hero + 1 个配置键） | 亲卫上限/士气/统兵池有稳定主体；张角病逝不再影响玩家编制 | 旧档 `companionSquad` 存的是张角 id → 加兼容读（有旧值则沿用，直到下次重建） |
| B. 期间切换（S02 张角 → S09 起 player） | 保留 `heroId` 配置为张角，在 S02 结束/`control.returned` 时切 `hero.player` 并做一次存档迁移 | **小~中**（1 处切换 + 迁移） | S02 期亲卫天然属于"张角军"，叙事一致 | 切换点必须幂等；读档在切换前后要一致；多一个可变配置源 |
| C. 不做亲卫（S09+ 只用军团 roster） | 关掉 companionSquad | **零** | 数据最省 | P1/P1e/09 士气两层在主线不可用；s02"亲卫随行 S09"落空；ARPG 陪伴感丢失 |

**推荐 A**（B 只作为 A 的过渡表现：S02 期间表现上仍可显示"张角亲卫"，但**数据主体**是 `hero.player`）。

---

### 1.4 替代方案评估：**S02 举事营地转正给主角**（用户提出，取代 S10 方案）

> 背景：用户认为"S10 才给根据地"太晚/不合理，提出让 S02 举事时建的军营在任务末尾归主角，
> 张角率黄巾去驰援他处。S03 营地的核实结论降级为背景（附录 U1），不展开。

#### 1.4.1 事实核实（S02 营地是真实资产，已实现）

| 事实 | 证据 |
|---|---|
| 军营**已实现**：`upgradeCamp()` 把粮草营地容器升 2 级，并播种 `construction.forge`（铁匠铺）/ `construction.workshop`（工坊）两个**已完工**工位 | [S02ArmyRescueFlow.upgradeCamp:327-344](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/S02ArmyRescueFlow.js#L327) |
| 军营建筑实体 6 件（铁匠铺/工坊/征召处/粮仓/兵营/营栅/营门）由任务步骤 `spawnPlacements(S02-camp-buildings)` 生成 | 同上注释 + [quests:1934](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L1934) |
| 粮草营地 `camp.s02.field` 由 `FoodLedgerSystem.registerCamp` 注册（level 1 → 2），库存走营账 | [S02ArmyRescueFlow:329-343](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/S02ArmyRescueFlow.js#L329)、[:366-377](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/S02ArmyRescueFlow.js#L366) |
| **归属是隐式的**：营地→军团解析按"`factionId === 'yellow_turban'` 且 `control !== 'ai'`"找 | [_resolveSupplyArmy:379-386](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/S02ArmyRescueFlow.js#L379) |
| **玩家阵营 = 黄巾**：`supply.playerFactionId = "yellow_turban"`，无 `alliedFactionIds` | [game.project.json:531-532](file:///d:/yijian18-engine/example/sanguo_zhangjiao/game.project.json#L531) |
| 无 `logistics.camps` 种子；营地仅在 S02 运行时注册，**换场景即不在配置里** | `game.project.json` 无 `camps` 键；`triggers.json:964` 只引用 `campId` |
| S02 营地**不是城**：`cityStates` 里没有 S02 条目，S02 结束也不产城 | `game.project.json` cityStates 从 `city.s03_yingchuan` 起（[:997](file:///d:/yijian18-engine/example/sanguo_zhangjiao/game.project.json#L997)） |

两个直接推论：
- **"营归玩家"不能靠 faction 表达**——玩家的 faction 现在就是 `yellow_turban`，与张角军同色，
  必须新增显式 `ownerArmyId`（否则营归玩家 = 营归黄巾，`_resolveSupplyArmy` 找到的仍是张角军）。
- **营地 ≠ 城池**，P2"势力成立"若按"拥有 ≥1 城"判定，S02 转正营地**仍不满足**；
  且 P2 现无单一判定实现（检索不到 `hasPlayerFaction` 之类），落地时必须先定义判定式。

#### 1.4.2 两种分支各拿到什么（三个变体）

| 变体 | 加入线 | 不加入线 | 需改 s02 条款 | 默认线能用军团了吗 |
|---|---|---|---|---|
| V1 只不加入线拿营 | 营归张角（不变），主角随军南下；S10 才得营地 | 营归玩家（"协助防守"→"守营接手"），亲卫随行 | 仅 s02 §4.2 表格 + §4.1 一句话（[line 159](file:///d:/yijian18-engine/.trae/specs/military-supply-strategy/s02-任务方案.md#L159)） | ❌ 默认线仍要等 S10 |
| V2 双线都拿、归属不同 | 营**代理/留守**：控制权归玩家，黄巾 80 仍归张角带走 | 营**完全归玩家**，亲卫随行 | line 159 + §4.1 军团归属表（line 170） | ✅ |
| **V3 双线都拿、归属同一（推荐）** | 营归玩家（张角授权留守），黄巾 80 归张角随其驰援 | 营归玩家 | line 159 + line 170 两处，外加上表两条推论 | ✅ |

**推荐 V3**：收益最大、条款改动集中在 2 句；两条线只在"主角是黄巾编制还是游侠"上分叉，
**营地所有权统一归玩家**（叙事上：张角临走把举事的老营交给你看着）。
若要求"零改 s02 已定条款"，退到 V1（只改 1 句），但**A3 在默认线仍不解决**，不推荐。

#### 1.4.3 与 `s02-任务方案.md` 现有口径的冲突（逐条）

| 条款 | 现文 | 冲突 | 处置 |
|---|---|---|---|
| §4.1 军团归属 | 黄巾 80 → `army.s02.guard`（张角）；亲卫 → `army.player.escort`（玩家）（[line 170](file:///d:/yijian18-engine/.trae/specs/military-supply-strategy/s02-任务方案.md#L170)） | 只分了"军"，没分"营" | 拆成三行：军归张角 / 亲卫归玩家 / **营地归玩家（ownerArmyId）** |
| §4.2 "S09 之后" | "军营/据点**归张角**"（[line 159](file:///d:/yijian18-engine/.trae/specs/military-supply-strategy/s02-任务方案.md#L159)） | 与本方案直接冲突 | 改为"营地归玩家（后方据点）；黄巾军归张角，随其转战" |
| §4.0 兵能否带走 | 加入线"不能"（[line 119/145](file:///d:/yijian18-engine/.trae/specs/military-supply-strategy/s02-任务方案.md#L119)） | **不冲突**（兵=黄巾 80，仍归张角） | 不改 |
| 不加入线"协助防守" | 协助后离开 | 语义要升级为"守营接手" | 1~2 句对话 + 1 个事实，不改结构 |
| 阵营模型 | 玩家 = `yellow_turban`（SupplySystem 配置） | "营归玩家"与"营归黄巾"无法区分 | 引入 `ownerArmyId`/`ownerFactionId`，**不靠 faction 判定** |
| P2 势力成立 | 要求"至少 1 城" | 营地不是城 | 判定式改为 `己方城 ≥1 || 己方军营 ≥1`（或新增 `city.s02_camp` 据点城，二选一） |

#### 1.4.4 数据与代码落点

| # | 落点 | 内容 | 量级 |
|---|---|---|---|
| 1 | `S02ArmyRescueFlow.upgradeCamp` | `registerCamp({campId:'camp.s02.field', level:2, ownerArmyId:'army.player.escort'})`；`_resolveSupplyArmy` 先读 `ownerArmyId`，读不到再退回旧 faction 过滤（向后兼容） | 小 |
| 2 | 新事实 | `state.player.stronghold = {campId:'camp.s02.field', cityId:null}`；`story.s02.camp.handover = 'joined'\|'independent'`（写在"举事落成"之后、"离开营地"之前） | 小 |
| 3 | `game.project.json` | `logistics.camps` 加种子 `{campId:'camp.s02.field', level:2, ownerArmyId:'army.player.escort', stock:{food:20,...}}`——**否则 S03 起粮草条军营段为空** | 小 |
| 4 | 军团/势力判定 | 定义 `hasPlayerStronghold()` = 己方城或己方军营；军团按钮/大地图指令门槛改用它（替代"必须城"） | 小 |
| 5 | 可选（若不想改 P2） | 新增 `city.s02_camp` 轻量据点（`factionId:'player'`, `buildingLevel:1`, 无城门/不驻大军） | 中 |
| 6 | 任务步骤 | `task.s02.*` 末尾插入"营地交接"对话 + `commit.fact`；加入线追加一句"张角率众驰援，营交你守" | 小 |
| 7 | 场景 | 营地建筑组不需要改（已由 `S02-camp-buildings` 刷出）；只需在交接后把"征召处/军营"交互权限放给玩家（现在按 non-AI 黄巾军解析，改造后按 ownerArmyId） | 小 |

**对 S03~S09 的连带影响**：
- S03~S08 是"随黄巾大军作战"，主角营地不在场 → 只能通过**粮草条/招募面板/军团按钮**体现存在，
  不需要在战场场景里出现营地图标（避免"人不在营却在营里操作"的违和：面板定位为"后方调度"）。
- S09 广宗大营（`city.s09_guangzong_camp`，张角）与 S02 后方营地**两个营并存且归属不同**，
  粮草条会出现"我的营"与"张角大营"两处；建议军营条只显示"己方营"，张角营走剧情面板。
- 招募/工坊产出从 S02 结束即可持续，S03~S09 的"兵源"有了来源（补 F5/P15 的断链）。

#### 1.4.5 关键收益

1. **军团层从 S02 结束即可用**，不再等 S10——A3 的最晚解锁点从"第 10 幕"提前到"第 2 幕"。
2. S10 的"迁营"从"从零获得归属"降级为**"扩营/搬址"**（库存迁移 + 营地升级），任务叙事更自然
   （张角病逝后"把营搬到溪畔"而不是"突然有了一个营"）。
3. S02 已建好的 6 件建筑（铁匠铺/工坊/征召处/粮仓/兵营/营栅/营门）**继续有效**，不再"进 S09 就消失"（原 C4 冲突消解）。
4. 两分支的差异只落在"编制/身份"，不落在"有没有根据地"——降低分叉维护成本（配合 A1 方案 A）。

#### 1.4.6 与"S10 迁营即得"的对比

| 项 | S02 营地转正（推荐） | S10 迁营即得 |
|---|---|---|
| 叙事 | 顺：举事老营是玩家亲手建的，张角临走托付；主角南下后仍有"家" | 较顺但偏晚：张角病逝才自立，"为什么之前没有"要解释 |
| 军团层开放时点 | **S02 末**（第 2 幕） | S10（第 10 幕）→ S03~S09 整段无军团层 |
| 数据改动量 | 小（4 处：owner 字段 + camp 种子 + 1 事实 + 1 判定式） | 中（城归属 + camp 注册 + 任务调用） |
| 代码改动量 | 小（`_resolveSupplyArmy` 1 处 + 判定式 1 处） | 小（S10 流程 1 处） |
| 回归风险 | 中：营地归属解析改动影响 S02 现有军营面板；旧档无 `ownerArmyId` 需回退 | 中：S10 检查点幂等；旧档无 camp |
| 与 s02 已定条款冲突 | 需改 2 句（line 159/170） | 无（S10 才发生） |
| 对 C4（建筑延续） | **解决** | 不解决（S02 建筑仍消失） |

**推荐：两者并存**——S02 转正（获得归属）+ S10 迁营（扩营/换址，`camp.s02.field` → `camp.s10.creek`，库存迁移，等级 2→3）。
这样既早解锁，又保留 S10 的"搬家"叙事，且不产生"第二套归属"。

#### 1.4.7 需要同步给 **S02 实现线**的改动清单（可直接转过去）

| # | 位置 | 具体改动 |
|---|---|---|
| S1 | `s02-任务方案.md` §4.2 表（line 159） | "军营/据点归张角" → "**营地归玩家（后方据点，`ownerArmyId`）；黄巾军归张角，随其转战**" |
| S2 | 同上 §4.1 表（line 170） | `armyStates` 归属拆三行：黄巾 80 → `army.s02.guard`（张角）/ 亲卫 → `army.player.escort`（玩家）/ **营地 → `camp.s02.field`（ownerArmyId=玩家军）** |
| S3 | 任务 `task.s02` 末尾（举事落成之后、离开营地之前） | 新增步骤：对话"营地交接" + `state.transaction`/`commit.fact` 写 `story.s02.camp.handover` 与 `state.player.stronghold` |
| S4 | `systems/S02ArmyRescueFlow.upgradeCamp()` | `registerCamp` 增加 `ownerArmyId: 'army.player.escort'`（若 `army.player.escort` 尚未创建，则写 `ownerFactionId:'player'` 并延迟绑定） |
| S5 | `S02ArmyRescueFlow._resolveSupplyArmy()` | 优先 `camp.ownerArmyId` → 再退回 `factionId==='yellow_turban' && control!=='ai'`（兼容旧档） |
| S6 | `game.project.json.logistics.camps` | 新增种子 `camp.s02.field`（level 2、ownerArmyId、初始 stock），保证 S03 起跨场景可见 |
| S7 | `game.project.json.supply` | `playerFactionId: "yellow_turban"` 保持，但**补 `alliedFactionIds: ["yellow_turban"]`**；若后续把玩家军 `factionId` 设为 `'player'`（s02 §4.2 line 142 的写法），必须同时把 `supply.playerFactionId` 改为 `'player'`，否则玩家亲卫会被 SupplySystem 判成非友方 |
| S8 | 势力判定（P2） | 定义 `hasPlayerStronghold()` = 己方城 || 己方军营；军团按钮/大地图指令门槛改用它，或补 `city.s02_camp` 据点城（二选一） |
| S9 | 不加入线对话（"协助防守"） | 加 1~2 句"张角率众驰援，营交你守"，语义从"协助后离开"改为"守营接手" |

> **不建议**：把"营归玩家"实现成"把营地 factionId 改成 player"——那会让 S02 的黄巾 NPC
> 与营地交互失配（NPC 按 yellow_turban 找营），且 SupplySystem 的玩家阵营仍是 yellow_turban。

### 1.5 结构补充：S02 营地到手后的「经营发展段」（用户提出）

> 设定：主角在 S02 拿到营地 → 先经营发展一段 → 张角危机（急报）时带人驰援。
> 关键发现：**S02 现有任务数据已经为这段留好了缝**——`task.s02.summons` 的战后目标标题就是
> "张角南下、**此处立为据点**"（[quests:1333](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L1333)，已按 §1.5.8 改向），
> 末步 `travelToS09` 写的是"随军南下广宗"（[quests:1345](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L1345)）。
> 也就是说：数据里已经"张角南下、营地留下"，只差**玩家留守经营**这一段和把"随军南下"改成"应召南下"。

#### 1.5.1 结构骨架（节点 → 触发 → 承载能力 → 结束条件）

| 节点 | 触发 | 承载能力 | 结束条件（可判定事实） |
|---|---|---|---|
| **N0 交接** | `task.s02.summons` 的 `aftermath` 目标完成（debrief 对话结束） | 营地归属（§1.4）、军营面板入口 | `story.s02.camp.handover` 已写（joined/independent） |
| **N1 盘营** | 进入营地交互范围 / 首次点"军营" | 军营仓 vs 军团粮（`camp.openTransfer`）| 完成 1 次 `camp.deposit`/`withdraw` → `story.s02.steward.store=true` |
| **N2 开工** | 走到铁匠铺/军械工坊（S02 已播种完工工位） | 工位产出（`productionSystem` + `station.forge.anvil`/`station.workshop.carpenter`） | 产出 1 件物品 → `story.s02.steward.craft=true` |
| **N3 招兵** | 征召处交互 → 军团 HUD | 招募（`army.recruit`）+ 亲卫上限（P1d） | 亲卫人数 ≥ 下限（建议 5；上限按 P1d）→ `story.s02.steward.muster=true` |
| **N4 备粮** | 日结（`TimeSystem` 自然过日）或"过一日" | 粮草日耗/断粮档位、补给 | 营仓粮 ≥ 阈值（建议 15）→ `story.s02.steward.supply=true` |
| **N5 急报** | N1~N4 完成数 ≥ 2，或玩家主动"即刻启程" | 剧情推进（无新能力） | 写 `story.s02.summons.urgent=true` → 触发对话"广宗告急" |
| **N6 应召** | `story.s02.summons.urgent` | 大地图转场（既有 `travelToS09`） | 写 `story.s02.travel`（既有事实）→ 进 S09 |

- **建议时长**：2~3 游戏日（`TimeSystem` 每游戏日 ≈ 8 分钟：8 个时段 × 60s，[TimeSystem.js:32-39](file:///d:/yijian18-engine/src/systems/TimeSystem.js#L32)），
  但**不按时间卡**——结束条件是"里程碑达成数"，日数只做叙事与粮耗刻度；玩家随时可"即刻启程"（0 日）。
- **里程碑取 2/4** 而非全做：经营是"选做两条"，避免变成强制教程。

#### 1.5.2 时间线定位

- **正确位置是"S02 之后、S09 之前"**（不是"S02 之后、S03 之前"的直观说法——播放序是 S02 → **S09 广宗大营** → S03~S08）。
- 落地形式：**不新建场景**，在 S02 场景内做一个"留守期"，把 `travelToS09` 的前置从"随军"改成"应召"。
- 最小改法（推荐）：在 `task.s02.summons` 里 `aftermath` 与 `travelToS09` 之间插入 3 步：
  `stewardship`（objective，custom.event 里程碑数≥2）、`summonsUrgent`（dialogue 急报）、可选 `stewardTip`（提示）。
  若不改主任务，可另建 `task.s02.stewardship`（side，`accept` 挂在 `aftermath` 完成），但跨任务依赖更绕，**推荐插步骤**。
- 兼容围剿失败分支：`raidDefeat`（营地被破）时**跳过 N1~N4**，只保留 N5/N6 + 一句"营地残破，来日再建"（1 分支，量级小）。

#### 1.5.3 S03 入场身份：最小改动版

| 项 | 现状 | 改法（最小） |
|---|---|---|
| 任务步骤 | `intro.spawn` 两组 → `intro.opening` 对话 → "选定参战方式" → 击退前锋 → 转进 | **全部保留** |
| 台词 | `dialogue.s03.opening` / tip："你投军后的第一战" | 改为"你**应召来援**的第一战"；按 `alignment` 分两档口吻（入籍 = 援军归张角节制；独立 = 客军助战） |
| 事实 | `joinedYellowTurban`（S09 定职写） | 新增 `story.s03.arrival='responded'`；`joinedYellowTurban` 只作编制标签 |
| 门控 | `S03S08SceneFlow`：`joinedYellowTurban && classSelectionCommitted` | 改 `classSelectionCommitted && alignment ∈ {yellow_turban, independent}`（1 处） |
| 兵力 | `S03-yellow-turban` 3 / `S03-han-army` 4 / 前锋 3 | 加一个 `S03-player-escort` 组（2~4 人，来自 N3 招的亲卫），**不改任务步骤** |

#### 1.5.4 与 A1 分叉的关系：能否统一成"响应征召"

**可以，而且这是 A1 更省事的解法**：主角有营地后，两条线都可以是"应召驰援"，差别只剩**编制归属**：

| 线 | 叙事 | 数据差异 | 是否还需要 `joinedYellowTurban` 门控 |
|---|---|---|---|
| 加入 | 正式入籍，援军归张角节制 | `alignment='yellow_turban'`；黄巾 80 归张角 | 不需要（只看 alignment） |
| 暂时还不行 | 以客军/盟军身份助战，打完回自己的营 | `alignment='independent'`；亲卫随行 | 不需要 |

- **做法**：保留 S02 的 `allegianceChoice`（叙事与编制分叉的价值），但把 `joinedYellowTurban` 从"整条 S03~S08 的硬门控"降级为"编制标签"；S09 的入伍对话按 `alignment` 分档（加入=正式入籍；独立=客军报备）。A1/A2 由此直接消解，不需要写独立任务线。
- **差异支点（体验与奖励，不用难度标签）**：原本"兵能不能带走"的差别（s02 §4.0）统一成"都能带亲卫"后，差异改为三处：
  ①亲卫编制上限（两线同一公式 `10 + floor(command/10) + rankBonus`，仅初始人数与归属不同）
  ②战役支援额度（加入线每战 1 次友军增援；独立线 0 次，靠自己募兵补充）
  ③战后给予与声望（加入线 粮 20/铁 10/伤药 3、黄巾 +20/汉 −10；独立线 粮 5/铁 2、黄巾 +5/汉 0）。
  三者都只影响**体验与奖励**，不改主线走向、不改敌人强度；若不愿意加这三处，就退回 A1 方案 A（保留 `joinedYellowTurban` 门控分支），只是 S09 仍有 1 处分支。

#### 1.5.5 发展段承载哪些军团能力（逐项）

| 能力 | 这段教吗 | 怎么教（触发 / 界面） | 留到后面 |
|---|---|---|---|
| 军营仓 / 军团粮 | **教（核心）** | N1：点军营 → `CargoTransferView` 左右两栏（军团粮 / 营仓），1 次转移即完成 | 押运/跨城输送 |
| 粮草日结 / 断粮 | **教（核心）** | N4：过一日时粮草条掉档 + 屏幕提示"断粮第 1 档：士气 −5" | 抢掠/散兵逃散细节 |
| 招募 / 亲卫 | **教（核心）** | N3：征召处 → `openArmyOrders`；一次招满亲卫，展示 P1d 上限与"黄巾军不可带走"的区分 | 城池征兵（S10+） |
| 工位产出 / 建造 | **教一半** | N2：铁匠铺/工坊已完工 → 只教"取产出/修理"；完整建造面板留 S10 | 建造入口 P18、耐久/箭矢 |
| 亲卫指令 / 编组 | **教（轻）** | N3 后一句提示 + 编组条；姿态教程 S02 围剿已教，不重复 | 接管/支援身份（S11+） |
| 大地图指挥 | **不教** | 军团按钮可看不可用（无战区/无城），文案"尚无战事" | S10 拥有城池后再教 |
| 押运 / 载具 | **不教** | — | S14 |

#### 1.5.6 风险与兜底

| 风险 | 说明 | 处置 |
|---|---|---|
| 与 S03~S08 的紧迫感打架 | S03 开场是"官军已至颍川"，发展段放在前面会泄气 | 急报对话明确"广宗告急、即刻启程"；发展段压到 2~3 里程碑（约 10~15 分钟）；N5 之后不再给经营入口 |
| 玩家不想经营 | 教学段变成强制 | **"即刻启程"始终可用**（对话选项直接写 `summons.urgent`）；里程碑门槛 2/4，最低可 0 达成（只要点过营地面板） |
| "加入线兵不能带走" vs 自招兵 | 容易误解成"我招的兵也被张角收走" | UI 明确两类：`张角军（不可带走）` / `你的亲卫（可带走）`；招兵走 `army.player.escort`（faction player 或 control=player）；黄巾 80 仍在 `army.s02.guard` |
| 围剿失败分支 | 营地被破时没有营可经营 | 跳过 N1~N4，只留 N5/N6 + 残营台词 |
| 时间系统被跳过 | 玩家不看昼夜，日结不触发 | 粮耗与日结绑在"过一日"动作上（营地休息），不依赖自然时间流逝；自然过日照常结算但可关 |
| 与 S10 迁营重复 | 两段都是"经营营地" | S02 段教"仓/粮/招"，S10 段教"扩营/搬址"（等级 2→3 + 库存迁移），能力递进不重复 |

#### 1.5.7 落地清单（量级）

| # | 改动 | 落点 | 量级 |
|---|---|---|---|
| 1 | `task.s02.summons` 插 3 步（stewardship / summonsUrgent / 提示）+ `raidDefeat` 分支跳过 | `quests.json`（[1333-1349](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L1333)） | 中 |
| 2 | 4 个里程碑事实 + 里程碑计数（`story.s02.steward.*`） | `triggers.json`（camp.deposit / 工位产出 / 招募 / 日结各 1 条） | 中 |
| 3 | `travelToS09` 改文案"应召南下广宗" | `quests.json:1345` | 小 |
| 4 | S03 台词两档 + `story.s03.arrival` | `quests.json` + `dialogue.*` | 小 |
| 5 | `S03S08SceneFlow` 门控改 alignment | 1 处判断 | 小 |
| 6 | `S03-player-escort` 组（2~4 人） | `S03.json` | 小 |
| 7 | 军营两类兵 UI 区分（张角军/你的亲卫） | `ArmyCommandHUD` 文案或编组条标注 | 小 |

> 该节与 §1.4 互为正反面：§1.4 解决"营地归谁"，§1.5 解决"拿到营地之后干什么、怎么接回主线"。
> 若 §1.4 采纳（S02 营地转正），本节自然成立；若退回 S10 方案，本节整体后移到 S10 之后（不推荐）。

#### 1.5.8 方位修订（S02 → S09 南下）与地理核对

**事实**（坐标取自 `game.project.json.worldLogic.nodes`，`y` 越小越靠北）：

| 地点 | 节点 id / 城市 id | 坐标 | 说明 |
|---|---|---|---|
| S09 广宗粥棚营地 | `city.s09` / `city.s09_guangzong_camp` | **x 16000, y 4680** | 场景名"S09·粥棚营地"，台词称"广宗大营"（冀州） |
| S10 广城溪畔营地 | `city.s10` / `city.s10_guangcheng_camp` | x 17280, y 4680 | 与广宗同纬度、偏东 |
| S03 颍川官军屯城 | `city.s03` / `city.s03_yingchuan` | x 16000, **y 11160** | 广宗以南 |
| S05 宛城 | `city.s05` / `city.s05_wancheng` | x 17280, y 11880 | 更南 |
| S07 西华 | `city.s07` / `city.s07_xihua` | x 19840, y 12600 | 最南 |
| S01 / S02 荒村 | **无节点、无坐标** | — | 序章场景不在大地图上，方位**纯由文案决定** |

**结论**：
- **广宗在颍川/宛城/西华之北**，所以"S09→S03 出广宗南下颍川"、"宛城→广宗 北返"、"西华→广宗 向北"
  都是**与坐标一致的真实方位**，**必须保留北上**（改了会和坐标/后续战役矛盾）。
- **唯一可自由改向的是 S02（荒村）→ S09（广宗）这一段**：荒村没有坐标，改成"南下"不与任何坐标冲突，
  前提是把荒村锚定为**广宗以北**。历史上卢植连营本就在广宗以北，张角自北而南击其背——**改南下反而更贴史实**。

**拍板结果（2026-11-12）：采用 B，勿再反转。**
- **荒村（S01/S02）锚定在广宗以北**，S02→S09 走**南下**。
- **荒村不在大地图上、没有任何坐标节点**（`worldLogic.nodes` 只有 city.s09/s10/s03/s04/s05/s07 与桥/关/渡/岔路），
  其方位**完全由文案决定**；广宗有坐标（`city.s09` y=4680），在颍川/宛城/西华之北——所以
  「出广宗南下颍川」「宛城北返广宗」「西华向北」这些真实方位句**保持不动**，以后也不要再被"统一改南下"动到。
- **地理锚点已写进战后交接台词**（`dialogue.s02.debrief` 的 `part` 节点，`dialogues.json:1361`）：
  「官军大营扎在广宗北边，我从北往南压过去，正好踹他的后营。到广宗找我——路上若遇官军，别说你认识张角，说你是自己活下来的。」
  同时把紧随其后的旁白（`:1365`）改成「你可以随张角去广宗，或留下整备」，**避免同一段里连说三次"南下"**。

**两个选项（已选 B，保留备查）**：

| 选项 | 做法 | 影响 | 量级 |
|---|---|---|---|
| **A. 改地名（换南边的城）** | 把 S09 从"广宗大营"改成南阳/汝南/陈国一带的城，全套 S10~S14 的广宗线也要跟着改 | 推翻"广宗=黄巾都城"整条 S10~S13（救张梁/张宝/死守广宗）；地名改动波及 dialogues、city、battle、triggers、结局 | **大** |
| **B. 保留广宗，荒村设在广宗以北（推荐）** | 荒村锚定冀州北部/幽州南界；S02→S09 文案改"南下"；S02 debrief 补一句"卢植连营在广宗北，我们自北而南击其背" | 只动 5 处文案 + 1 句地理锚点；S03 之后全部不动；与坐标、后续三关全部自洽 | **小** |

**已按 B 改动的清单（本作设定，非历史引用）**：

| 文件 | 行 | 原文 | 改后 |
|---|---|---|---|
| [quests.json](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L1333) | 1333 | 战后交代：张角**北上**、此处立为据点 | 战后交代：张角**南下**、此处立为据点 |
| [quests.json](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L1345) | 1345 | 随军**北上**广宗 | 随军**南下**广宗 |
| [dialogues.json](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/dialogues.json#L246) | 246 | 全军开拔，随我**北上**去广宗 | 全军开拔，随我**南下**广宗 |
| [dialogues.json](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/dialogues.json#L1349) | 1349 | 张角收起桃木杖，望向**北方**的山道 | 望向**南方**的山道（广宗在南，不改会与去向下矛盾） |
| [dialogues.json](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/dialogues.json#L1361) | 1361 | 往**北**走，到广宗找我 | **改写成地理锚点**："官军大营扎在广宗北边，我从北往南压过去，正好踹他的后营。到广宗找我——……" |
| [dialogues.json](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/dialogues.json#L1365) | 1365 | 你可以随军**北上**广宗，或留下整备 | 你可以随**张角去广宗**，或留下整备（去掉重复的"南下"） |
| [10-s02-quest-rework.md](file:///d:/yijian18-engine/.trae/specs/military-supply-strategy/10-s02-quest-rework.md#L127) | 127 / 131 | "第四段 · 北上"、"`travelToS09` 北上" | 南下 / 南下 |
| [11-s02-persecution-uprising.md](file:///d:/yijian18-engine/.trae/specs/military-supply-strategy/11-s02-persecution-uprising.md#L800) | 800 / 803 | "围剿 → 北上"、"北上 S09" | 南下 / 南下 S09 |
| [s02-任务方案.md](file:///d:/yijian18-engine/.trae/specs/military-supply-strategy/s02-任务方案.md#L83) | 83 / 145 / 149 / 404 | "北上（既有）"、"亲卫随玩家北上 S09"、"都能北上"、"战后交代 + 北上" | 全部改"南下" |

**保留未改（真实方位，已标注供你判断）**：

| 文件:行 | 原文 | 为什么保留 |
|---|---|---|
| `dialogues.json:339` | 出广宗一路**南下**，颍川…… | 与坐标一致（广宗 y4680 → 颍川 y11160） |
| `dialogues.json:836` | 即刻**北返**！（宛城→广宗） | 与坐标一致（宛城 y11880 → 广宗 y4680） |
| `dialogues.json:933` | 火把连成一线，**向北**。广宗…… | 与坐标一致（西华 y12600 → 广宗 y4680） |
| `dialogues.json:785/789/794/831` | 南下收拢豫州残部 / 南下驰援宛城 / 南下的路 | 豫州/南阳在广宗以南，真实方位 |
| `assets/scenes/s_5_8.json:151` | 兽径向**南**绕行 | 与剧情方向无关的地形描述 |

**对发展段叙事链的连带调整**：急报来源仍是广宗（张角/张梁），驰援目标仍是广宗 → 不受方向影响；
只新增 1 句地理锚点（debrief 或急报对话）："卢植连营在广宗北，我们自北而南，正好击其背。"
另外 §1.5.1 的 N5/N6 文案用"应召南下"，与数据改动一致。

**需你拍板的一项**：选 **B（保留广宗、荒村设北、文案改南下，推荐）** 还是 **A（把 S09 换成南边的城）**。
若选 A，本节"已改清单"里的 5 处文案要再改一次（目标地名也变），且 S10~S13 的广宗线需整体重命名（大改）。

---

## 2. MVS：让军团层级在主线里真正跑起来的最小闭环

**目标态（可观测）**：S10 结束时 ①军团按钮可点（P2 成立）②粮草条有"军团 + 军营"两行
③S11 起战斗走身份、战果进 `BattleSettlement` ④S13 斩将能触发任务目标 ⑤S14 清点辎重进账。

### 2.1 必须做（MVS）

| # | 改动 | 落点 | 量级 | 依赖 |
|---|---|---|---|---|
| M1 | **阵营键归一**：新增 `state.player.alignment`（`yellow_turban` / `independent`），`joinedYellowTurban` 降级为只读别名；汉方 id 统一 `han_government`（heroes 的 `han` 加别名读） | `S09ClassSelectionFlow`（写）、`S03S08SceneFlow`（读）、`library.heroes`（别名） | **小** | 与 S02 批共用同一事实名 |
| M2 | **主角英雄 + 亲卫绑定**：新增 `hero.player`（command 20 / `rank.wusheng` / `factionId player`），`companionRule.heroId` 指向它；旧档读 `companionSquad.heroId` 时保留兼容 | `library.heroes`、`game.project.json.companionRule`、`CompanionService`（1 处兼容读） | **小** | M1 的 factionId 口径 |
| M3 | **S09 分支**：`intro.opening` 后加 `branch`；`independent` 线走"报备立誓"对话（不写 `story.s09.enlist`）；`S03S08SceneFlow` 门控放宽；新增 `armies['army.player.escort']` + S09 组 `S09-player-escort`（`spawnWhen: independent`） | `quests.json task.s09`、`S03S08SceneFlow`、`library.armies`、`S09.json` | **中** | M1；S02 的 `allegiance` 事实（若 S02 未落地，先用 `joinedYellowTurban=false` 兜底判断） |
| M4 | **S10 根据地**：`trg_s10_complete_relocation` 追加 `city.setFaction {cityId:'city.s10_guangcheng_camp', factionId:'player'}`（wiring 已有 `city.capture`，`setFaction` 需补一条；或直接用 `city.capture`）→ `army.camp`（溪畔坐标）→ `camp.register {campId:'camp.s10.creek', level:2}` | `triggers.json trg_s10_complete_relocation`、`S10StoryFlow`（末尾一次调用）、`game.project.json`（camp 种子可选） | **中** | M2（玩家英雄/势力口径）；`army.camp`/`camp.register` 已实现 || M5 | **身份化 + 观战分支**（S11/S12/S13 三处同批）：删 `modeView`；`trg_s*_choose_*` 改发 `unit.joinBattle{identity:'takeover'\|'observe'}`；任务目标改"选定参战身份"；观战分支把救援/斩将目标设为 `optional` 或换替代目标（S13 写 `story.s13.sunxiaEscaped`）；`battleModeStats` 由身份派生写回 | `config/battles/S11,S12,S13.json`、`quests.json`（3 处）、`S03S14BattleCoordinator`（派生写回）、`S11S12Coordinator`（`_validateStart` 放行 observe） | **大**（三场景同批） | 06/07 已定，M6 已实现 `joinBattle` |
| M6 | **G 类数据修复**（见 §5） | `battles/S13.json`、`library.heroes`、`library.enemies`、S13 结局输入 | **小** | 无 |
| M7 | **粮账最小收敛**：S12 `costs` 与 S13 介入消耗改从 `FoodLedger.withdraw` / 城池库存扣（不再扣玩家背包）；`battle.resources` 只作战利品显示 | `config/rescues/S12.json`、`S11S14SceneFlow._prepareS13Settlement` | **小** | M4（有军营/城 → 有可扣库存） |

> **M4 修订**：按 §1.4 的结论，M4 的"获得归属"提前到 S02（`camp.s02.field` 转正 + `ownerArmyId`），
> M4 本身降级为"S10 扩营/搬址"（库存从 `camp.s02.field` 迁到 `camp.s10.creek`、等级 2→3）。
> 若 S02 线不采纳，M4 保持上表原样即可，两者不冲突（只是解锁时点从 S02 推迟到 S10）。

### 2.2 可延后（不进 MVS）

| 项 | 原因 | 量级 |
|---|---|---|
| `battle.scale` 通用化 + `roster` 兵力池 + 主将下场（P22/P23） | 现状 9~117 实体能跑；先修"身份/账"，再谈规模 | 中 |
| S11"集结 6 名卫兵"改收编残兵（`army.recoverRemnants`） | 现放置物可用；不改不影响闭环 | 中 |
| 招募/补员/散兵招回（P15/P1e）、官勋成长（F5） | 内容增强，主线可先"战后满编重建"占位 | 中 |
| 建造入口迁到 P18 工位/stations、铁匠工坊进主线（P16/P17） | 与闭环无关，属经济深化 | 中 |
| S14 三选接入 02 押运损失表、载具指令 | 结局关，可后置 | 小~中 |
| 教程（P11 冻结） | 一律不做 | — |

### 2.3 MVS 验收（人工可验）

1. S09 选"暂时还不行"后仍能进 S03，S10 结束前军团按钮可点。
2. 粮草条同时出现"军团（还剩 N 日）"与"军营（存粮 N）"。
3. S11 选观战：任务不被卡死（救援组目标转 optional，出现"旁观战果"目标）。
4. S13 参战斩孙夏 → 任务目标完成；观战 → 走 `sunxiaEscaped` 替代目标，不软锁。
5. S14 清点马车后，粮草条/结局输入的粮食数值与马车货舱一致（不再两套）。

---

## 3. 口径冲突收敛（一条一句，以谁为准 / 改哪边）

1. **阵营键**：以 `state.player.alignment` 为准，改 S09 写入点 + S03S08 读取点；`storyState.joinedYellowTurban` 保留为只读别名，汉方统一 `han_government`（heroes 的 `han` 用别名表读）。
2. **声望**：以 P20 的 `state.player.reputation` + `reputation.adjust` 为准，**改文档**（s02 §4.2 的 `faction.reputation.*` 作废），代码零改。
3. **营地**：以 `army.camp` + `logistics.camps` 为准，改 S10（把 `s10CampRelocation` 保留为叙事，营地址实体落到 camp 注册）；S02 的 `camp.s02.field` 不动。
4. **粮账**：以 `FoodLedgerSystem` 为唯一粮草权威，改 S12/S13 的介入费与 S14 清点（都走 ledger/城池库存）；`battle.resources` 只保留为战利品显示，不再当我方库存。
5. **战斗模式**：以 P7 三身份为唯一入口，改 S11/S12/S13 的 `modeView` 与任务目标；`battleMode`（observe/intervene）降级为派生值写回 `battleModeStats`，`endings.json` 不改。
6. **亲卫 heroId**：以新增 `hero.player` 为准，改 `companionRule.heroId`；张角只在 S02 期作主控实体，不动其剧情数据。
7. **亲卫上限公式**：以 P1d `⌊(统率 + 官职)/2⌋`（无基础项、满 100）为准，**改文档**（s02 §4.3 的 `10 + floor(command/10) + rankBonus` 作废）；代码只需按 P1d 实现，勿另写公式。

---

## 4. 分批与顺序（含与 S02 实现的先后）

### 4.1 与 S02 的契约（先钉死，避免返工）

S02 正在落地，**它产出的键名就是 S09+ 的输入契约**。建议 S02 批按这张表落：

| 契约 | 唯一写法 | 备注 |
|---|---|---|
| 入伙事实 | `state.player.alignment = 'yellow_turban' \| 'independent'` | 同时写旧键 `story.s02.allegiance.*` 供兼容；**唯一分叉依据** |
| 玩家军队 | `armies['army.player.escort']` + `armyStates['army.player.escort']` | 独立线随行，黄巾线不创建 |
| 亲卫上限 | `story.s02.guard.cap` 写成 P1d 公式结果（不是新公式） | 只写数值，不写公式 |
| 声望 | `reputation.adjust({factionId, delta})` | 不写 `faction.reputation.*` |
| 营地 | `camp.s02.field`（`camp.register`） | S10 的 `camp.s10.creek` 同构 |

**顺序建议：S02 实现批先合并，或至少让 S02 与 B1 同批**——S02 若先用 `faction.reputation.*` 落地，
B1 要多写一层别名适配（可接受但多一笔）。

### 4.2 批次

| 批 | 内容 | 可独立合并？ | 必须同批 | 回归风险 |
|---|---|---|---|---|
| **B0 数据修复** | G1/G2/G3/G4（孙夏身份、城市 id、hero 补数据、偷粮卫兵阵营） | ✅ 可独立 | — | **低**：只改配置；S13 战役主将变了 → 需跑一次 S13 战果/结局冒烟 |
| **B1 契约层** | M1 + M2（alignment、hero.player、companionRule）+ §4.1 契约表 | ⚠️ 与 S02 批耦合 | 与 S02 同批或紧随其后 | **中**：旧档 `storyState` 缺 alignment / `companionSquad.heroId` 指张角 → 必须写兼容读 |
| **B2 身份化** | M5（S11/S12/S13 任务 + 战役配置 + 观战分支 + 派生写回） | ❌ 不可拆场景 | **S11/S12/S13 必须同批** | **高**：结局输入 `battleModeStats` 与观战分支；需回归三个救援关 + 结局判定 |
| **B3 根据地** | M4（S10 易主 + `army.camp` + `camp.register`） | ✅（B1 后） | 与 B4 同批更顺 | **中**：S10 检查点幂等（重复交互不重复易主）；旧档无 camp 时粮草条空态 |
| **B4 粮账** | M7（S12/S13 介入费 + S14 清点） | ✅（B3 后） | 与 B3 同批 | **中**：扣减来源变了 → 需回归"物资不足"提示与结局数值 |
| **B5 编制/规模** | `battle.scale` + roster + 主将下场（P22/P23） | ✅ | — | **中**：缺省不改行为；打开后才变 |
| **B6 内容增强** | 收编卫兵、招募补员、官勋、铁匠工坊、S14 押运表 | ✅ 各自独立 | — | **低~中**：纯新增 |

**合并顺序**：`B0` → `【S02 实现批】` → `B1` → `B3+B4` → `B2` → `B5` → `B6`。
（B2 放 B3/B4 之后：先有城/营与粮账，观战分支的"旁观战果"才有账可看；若想先灭火软锁，可把 B2 的
"观战分支"单拆一个 B2a 提前，但 `endings` 派生必须一起走。）

### 4.3 关键回归点

- B1：旧档进入 S09 前 `alignment` 为空 → 读 `joinedYellowTurban`；`companionSquad.heroId` 为张角 → 沿用旧值。
- B2：`battleModeStats` 必须仍产出（派生），否则 `endings.requiredPaths` 直接判缺失。
- B3：`city.setFaction` 幂等；`army.camp` 重复调用返回 `idempotent`（`S02ArmyRescueFlow` 已有此语义）。
- B4：介入费扣减失败必须走"提示 + 回滚"，不能扣一半（参照 `_prepareS13Settlement` 现有 rollback）。

---

## 5. G 类数据硬伤清单（一句话修法）

| # | 修法 |
|---|---|
| G1 | `battles/S13.json` 的 `attackerArmy.commanderHeroId` 由 `hero.sun_xia` 改为 `hero.zhang_liang`（或 `hero.zhang_bao`，按剧情存活）。 |
| G2 | 同文件 `affectedCityId` / `resourceSourceCityId` / `resourceDestinationCityId` 由 `city.s09_guangzong_camp` 改为 `city.s12_xiaquyang`（或新增 `city.s13_jingshan`）。 |
| G3 | `hero.sun_xia` 改 `unitId: unit.heavy`、`factionId: han_government`、去 `m0.placeholder`；其余 13 个 hero 按"猛将/智将"补 `deploySlot` 与 `unitId`（P22 用）。 |
| G4 | `enemy.s09_granary_guard` 的 `faction` 由 `yellow_turban` 改为 `han_government`（或新增中立 `county_militia`），避免同阵营拒战。 |
| G5 | S11/S12/S13 的逐 ref 放置物保持不动（先跑通身份/账本），后续再由 `battle.scale` 收编为组/编制。 |
| G6 | `rescue` 的 `successEffects` / `conditionalAllies` 改为写 `armyStates` / `cityStates`（借 `state.transaction` 或服务命令），不再直写表现层数值。 |
| G7 | `battleModeStats` 保持存在，但由身份派生写回（`takeover/support → intervene`、`observe → observe`），`endings.json` 的 `requiredPaths` 不动。 |

---

## 6. 三项待拍板（转成分支 + 推荐默认值）

| # | 分支 | 内容 | 推荐默认 |
|---|---|---|---|
| ① 玩家根据地从哪来 | **A** | S10 迁营即得（`city.s10_guangcheng_camp` 或 `city.s10_creek_camp` 归玩家 + `camp.s10.creek`） | ✅ **A** |
| | B | S09 广宗营地转正（叙事弱，新兵当城主） | — |
| | C | S13 后攻下广宗/下曲阳再得城（内容更重，排 S15+） | — |
| ② 不加入线怎么办 | **A** | 同主线、编制/体验差异（S09 分支 + 亲卫随行 + 门控放宽） | ✅ **A** |
| | B | 独立任务线（3~5 任务 + 自建战役 + 独立结局） | — |
| ③ S13 决战规模 | **A** | `600` 总兵力池 / 同屏 `100` / 击破 `60%` 孙夏登场 / 斩将溃散（复用 S02 围剿的池+锚点实现） | ✅ **A** |
| | B | 维持现状 `9v9` 单波（不做池、不做登场锚点） | — |

> 三个默认值按"A/A/A"推进即可，不需要再等确认；若后续推翻，改动面分别是
> ① 1 条 cityState + 1 个 camp（小）、② 3~5 个任务 + 2~3 场战役（大）、③ 1 个 `battle.scale` 字段 + 1 条登场锚点（中）。

---

## 7. 文件级改动清单（按批）

| 批 | 文件 | 改什么 |
|---|---|---|
| B0 | `config/battles/S13.json` | 主将 / 城市 id |
| B0 | `project/library.json` | `hero.sun_xia` 等 14 个 hero 的 `unitId/factionId/deploySlot`；`enemy.s09_granary_guard.faction` |
| B1 | `project/library.json` | 新增 `hero.player` |
| B1 | `game.project.json` | `companionRule.heroId`、`logistics.camps`（可选） |
| B1 | `systems/S09ClassSelectionFlow.js` | 写 `state.player.alignment` |
| B1 | `systems/S03S08SceneFlow.js` | 门控放宽（1 处判断） |
| B1 | `src/systems/CompanionService.js` | 旧档 `heroId` 兼容读（1 处） |
| B2 | `project/quests.json` | S11/S12/S13 的"选定参战方式"目标 + 观战分支 + S13 替代目标 |
| B2 | `config/battles/S11,S12,S13.json` | 删 `modeView`；补 `roster`/`deployment`（可延后到 B5） |
| B2 | `systems/S11S12Coordinator.js` / `S03S14BattleCoordinator.js` | observe 放行、`battleModeStats` 派生写回 |
| B3 | `project/triggers.json` | `trg_s10_complete_relocation` 追加 `city.setFaction` / `army.camp` / `camp.register` |
| B3 | `systems/S10StoryFlow.js` | 迁营成功后触发一次军团扎营（幂等） |
| B4 | `config/rescues/S12.json`、`systems/S11S14SceneFlow.js` | 介入费改 `FoodLedger`；S14 清点读/写 ledger |
| B5 | `src/systems/ArmyOrderSystem.js` + `config/battles/*` | 新增可选 `battle.scale`；roster→实体展开 |
| B6 | `project/quests.json`、`project/triggers.json`、`config/*` | 招募补员、官勋、收编卫兵、押运表（可选目标，不阻塞主线） |

---

## 附录 U1：S03 有没有营地（背景核实，已降级，不参与方案）

- S03 场景（`assets/scenes/S03.json`，23 个对象）**没有营地/建筑/城池对象**：只有黄巾 3、官军 4、官军前锋 3 个 ref 组、2 个 region、2 个 spawn、2 个触发器；`S03S08SceneFlow` 里也没有 camp/军营相关逻辑。
- S03 唯一的"城"是 `city.s03_yingchuan`「颍川官军屯城」（`factionId: han_government`，民心 40，粮 80/药 30/铁 40/木 50，`buildingLevel: 2`，[game.project.json:997](file:///d:/yijian18-engine/example/sanguo_zhangjiao/game.project.json#L997)）——**敌方据点，不是黄巾营，也不是主角营**。
- `logistics.camps` 无任何种子；全仓唯一注册过的营地是 S02 的 `camp.s02.field`（运行时注册）。
- S03 结束时主角身份 = 刚投军的黄巾新兵（`task.s03` 描述"这是你投军后的第一战"，[quests:1473](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L1473)），随后启程长社（S04）。
- 结论：**S03 不存在可转正的营地**；若强行在 S03 给营，需要凭空新建 camp + 城归属 + 粮草种子 + 营地区域，且叙事上"第一战就获营"站不住。故 A3 的落点回到 **S02 举事营地**（§1.4）。
