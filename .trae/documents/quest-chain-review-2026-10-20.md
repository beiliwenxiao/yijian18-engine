<!--
/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/
-->

# 任务链评审报告：三国张角传 Demo（对照任务循环规则）

| 项 | 内容 |
|---|---|
| 评审日期 | 2026-10-20 |
| 评审对象 | example/sanguo_zhangjiao 全主线任务链（S01-S14，15 条 quest） |
| 评审依据 | 任务循环设计规则（2026-10-14 用户定稿，评审任务链的权威框架） |
| 评审方法 | 静态数据逐场景对照（quests/triggers/commands/library/场景 JSON/battles 配置），非实机跑测 |
| 结论摘要 | S01/S02 基本走完循环，S09 枢纽合理；S03-S14 为薄任务模式——循环骨架在，系统性缺失开场对话、战斗内收获、Boss 战三个环节 |

---

## 一、评审框架

### 1.1 任务循环规则（十环节模板）

```
角色出现 → 简单动作/任务/对话 → 学习和加强 → 小战斗 → 收获和加强
        → 简单动作/任务/对话 → 大战斗 → Boss战 → 收获和加强
        → 任务过渡到下一个场景 →（回到开头）不断循环
```

### 1.2 三条硬性要求

1. 每个场景尽量走完整个循环；
2. 节段之间要有故事逻辑衔接（过渡要有剧情钩子，不能只靠动作/传送）；
3. 每场战斗后必须有收获和加强（装备/技能/资源），大战斗前要有简单任务缓冲。

### 1.3 评级符号

- ✓ 完整满足；△ 部分满足/形态偏差；✗ 缺失；— 该场景类型合理豁免

---

## 二、数据源与查证范围

| 文件 | 查证内容 |
|---|---|
| `project/quests.json` | 15 条 quest 定义（步骤、目标、rewards） |
| `project/triggers.json` | 场景编排触发器（sceneEnter/interact/waveCleared/dialogueChoice/exit 链） |
| `project/commands.json` | 14 个 `reward.*` 奖励事务的内容与幂等条件 |
| `project/library.json` | 敌人属性、lootTable、isBoss、ai 画像 |
| `assets/scenes/S01-S14.json` | 敌军 placement 分组与规模 |
| `config/battles/S03-S13.json` | 战斗编排（参战方式、两军配置、胜负信号） |

查证口径：不凭旧印象下结论，全部以当前工作区文件为准（如 S02 饥民任务 `task.s02.refugeeRelief` 已确认移除，现行为荒村乞粮 `dialogue.s02.villageBeg` 分支链）。

---

## 三、总体结论

**循环骨架已全线贯通，S01 是全循环标准范本；但 S03-S14 十二个场景只走了"选择缓冲 → 大战斗 → 离场奖励 → 过渡"的骨架，规则要求的"角色出现（对话）、战斗内收获、Boss 战"三个环节系统性缺失。**

### 循环完整度分级

| 分级 | 场景 | 说明 |
|---|---|---|
| A | S01 | 十环节全部落地，唯一范本 |
| B+ | S02 | 剧情枢纽，战斗弱化属叙事豁免，对话链完整 |
| B | S09 | "学习和加强"枢纽（选职业+军团指挥教学） |
| B- | S13、S14 | S13 有 Boss 有收获缺开场对话；S14 结局场景战斗豁免合理 |
| C | S03、S04、S05、S07、S11、S12 | 战斗内容扎实，缺三环节（开场对话/战斗内收获/Boss） |
| D | S06、S08、S10 | 无任何敌人 placement，纯工程/剧情场景（豁免还是缺口待裁定） |

---

## 四、主链拓扑与衔接方式

```
S01 荒原求生 → S02 荒村/废营（乞粮分支→张角抉择→救援→苏醒→召见）
            → S09 广宗大营（入伍→选职业→出征）
            → S03 颍川 → S04 长社 → S05 宛城外围 → S06 宛城围攻
            → S07 西华迟滞 → S08 西华余部 → S10 广城扎营
            → S11 广宗救援 → S12 下曲阳突围 → S13 驹山决战 → S14 结局
```

| 衔接段 | 衔接机制 | 剧情钩子 |
|---|---|---|
| S01→S02 | `story.s01.complete` 事实 + travel 事务 | 伤饿逃亡叙事（旁白+过夜演出） |
| S02→S09 | `story.s02.travel` 事务内嵌 travel（trg_s02_accept_summons 双事务） | 张角召见+赠符水/口粮 |
| S09→S03 | `trg_s09_travel_s03`（triggerSucceeded 目标） | 颍川出征旗 |
| S03→S04…S12→S13 | 各场景 `trg_sXX_exit_sYY` interact 触发器 | 仅 showTip 一句话（弱） |
| S13→S14 | `trg_s13_exit_s14` | Boss 战后文字提示 |

主链无断裂（`scripts/scan-mainline-chain.mjs` 15 场景 111 检查项全过的结论仍然有效），断裂风险不在拓扑而在表现层（见第六章）。

---

## 五、逐场景详细评审

### 5.1 S01 荒原求生（task.s01.survival）——评级 A

**任务链**：开场旁白 → 移动教程 → 点燃火堆 → 采集/食用酸果 → 拾取破斧 → 砍柴 → 添柴遇狼 → 攻击教程 → 击杀教学狼 → 拾剥皮刀 → 剥狼皮 → 烤狼肉 → 制作狼皮背心 → 搭建庇护所 → 过夜 → 离开庇护所躲避狼群 → 跳石过河 → 攀藤撤离 → 逃往废弃营地。

| 环节 | 落地情况 | 证据 |
|---|---|---|
| 角色出现 | ✓ | `dialogue.s01.wake` 开场旁白（sceneEnter 触发） |
| 简单任务/对话 | ✓ | 点火/采集/吃果/找斧/砍柴 五连小目标 |
| 学习和加强 | ✓ | s01.move/gather/pickup/chopWood/attack 五教程链 + 跳石/攀藤 |
| 小战斗 | ✓ | 教学野狼（story.s01.firstWolfKilled） |
| 收获和加强 | ✓ | 剥狼皮→烤狼肉→制作狼皮背心/护腕/护裙/护靴（装备四件套制作链） |
| 大战斗 | ✓ | 追逐狼群（开局 3 只、杀一补二封顶 5、chase.kill 计数门） |
| Boss 战 | ✓ | 狼王（杀满 5 只触发 `S01-wolf-king`，telegraph 扑击预警） |
| Boss 收获 | ✓ | 狼牙匕首×1 必掉（attack+12、攻速词条）+ 生狼肉 2-5 |
| 过渡 | ✓ | 伤饿交加逃亡叙事钩子 → S02 |

**缺口**：狼王是游离于 quest 目标之外的**可选** Boss——任务链无"击杀狼王"目标、无对话引出，玩家可能全程错过。建议在 leaveShelter 后补一条可选目标或提示。

### 5.2 S02 荒村/废营（task.s02.rescue + task.s02.summons）——评级 B+

**任务链**：进入荒村 → 村民乞讨对话（三选一）→ [强硬] 村民敌对波战斗 → 力竭昏迷 / [不动手] 被打晕 → 张角视角序章（杀了→乱世草芥结局 / 救他→军团救援）→ 指挥搬运教学 → 抵达营地苏醒 → 赠符水 → 张角召见 → 接受召见 → 前往粥棚营地 → S09。

| 环节 | 落地情况 | 证据 |
|---|---|---|
| 角色出现 | ✓ | `trg_s02_village_beg`（enter）→ `dialogue.s02.villageBeg` |
| 简单任务/对话 | ✓ | 乞粮三选一（confront/pacify/给粮） |
| 学习和加强 | ✓ | 军团指挥救援玩法 + s02.command.move/carry 双教学 |
| 小战斗 | ✓（可选） | `S02-villagers-hostile` 3 只染疫村民波（waveCleared→昏迷）；pacify 路线跳过 |
| 收获和加强 | ✓ | `reward.s02.rescueGift`（符水×2+草药）+ `reward.s02.rationGift`（口粮×5） |
| 大战斗 | —（剧情枢纽豁免） | 张角抉择分支为场景核心 |
| Boss 战 | — | |
| 过渡 | ✓ | 召见对话 → travel 事务 → S09 |

**缺口**：无。作为叙事枢纽场景豁免战斗环节成立。注意：旧记忆中的 `task.s02.refugeeRelief`（饥民捐粮任务）已移除，现行乞粮分支只影响过场走向，不再构成独立任务。

### 5.3 S09 广宗大营（task.s09.joinYellowTurban）——评级 B

**任务链**：进场刷兵+提示 → 张角入伍对话 → 三军旗选职业（战士/弓手/谋士）→ 颍川出征旗 → S03。

| 环节 | 落地情况 | 证据 |
|---|---|---|
| 角色出现 | △ | 仅 `showTip`（"先与张角交谈加入黄巾…"），无开场对话 |
| 简单任务/对话 | ✓ | `dialogue.s09.enlistment` 入伍对话 |
| 学习和加强 | ✓ | classSelected 三职业 + `reward.s09.classGift` |
| 小战斗 | △ | 粮仓哨兵（faction friendly 不主动接战）/官军斥候（aggressive）为探索性内容，非任务目标，且 lootTable 空 |
| 收获和加强 | △ | classGift 仅铁料×5（资源），无职业装备/技能授予的即时获得感 |
| 大战斗/Boss | —（募兵场景豁免） | |
| 过渡 | ✓ | 出征旗 triggerSucceeded → S03 |

### 5.4 S03 颍川首战（task.s03.yingchuanBattle）——评级 C

**任务链**：进场刷兵+提示 → 选定参战方式（观战/介入）→ 击退朱儁前锋 → 启程长社。

- 大战斗：✓ `battle.s03.yingchuan` 两军实时交战（黄巾先军 vs 官军守军，胜负信号完备），placement 含 `S03-han-army` + `S03-han-vanguard` 前锋组。
- 大战斗前缓冲：✓ 参战方式选择（modeView 观战/介入双模式）。
- 收获：△ 仅 exit 时 `reward.s03.firstBattle`（草药×2）；战斗内敌人 lootTable 空。
- 缺口：✗ 开场对话（战役背景/朱儁人物零交代）；✗ Boss；✗ 战斗内收获。

### 5.5 S04 长社驰援（task.s04.changsheDefense）——评级 C

**任务链**：选定参战方式 → 启动波才限时救援 → 护送波才抵达撤离点 → 确认豫州路线 → 启程。

- 大战斗：✓ 限时救援 + 护送撤离双重战斗目标，`S04-han-army` 敌组 + 波才（friendly 将领实体）。
- 大战斗前缓冲：✓ 参战方式 + 救援启动双重前置。
- 收获：△ 仅 exit `reward.s04.bocaiGift`（粮×4+草药×2）。
- 缺口：✗ 开场对话（波才被围的战局背景零交代）；✗ Boss；✗ 战斗内收获。

### 5.6 S05 宛城外围（task.s05.wanchengOutskirts）——评级 C

**任务链**：选定参战方式 → 领取矿镐 → 启动张曼成救援 → 探明矿坑敌情 → 撤出矿坑 → 转进宛城。

- 大战斗：✓ 救援+侦察+撤离，`S05-han-army` 敌组，敌将秦颉（han_commander、HP170）在场。
- 学习和加强：△ 矿镐领取+矿坑侦察（探索玩法）。
- 收获：△ 仅 exit `reward.s05.mineGift`（铁矿×6）。
- 缺口：✗ 开场对话；✗ Boss——**秦颉是现成的升格候选**（敌将模板已具备，仅缺 isBoss+telegraph+lootTable 数据）；✗ 战斗内收获。

### 5.7 S06 宛城围攻（task.s06.wanchengSiege）——评级 D（待裁定）

**任务链**：确定防御策略 → 修筑野战工事 → 响应信使召回。

- 学习和加强：△ 工事建造玩法。
- 收获：△ 仅 exit `reward.s06.siegeGift`。
- **无任何敌人 placement**——"围攻"场景无战斗。缺：角色出现、小战斗、大战斗、Boss 全部环节。豁免理由（工程/剧情场景）还是缺口（围攻战应当有守城战），**需用户裁定**。

### 5.8 S07 西华迟滞（task.s07.xihuaDelay）——评级 C

**任务链**：组织迟滞作战 → 北路阻滞 → 中路阻滞 → 南路阻滞 → 收兵转移。

- 大战斗：✓ 三路阻滞（`S07-han-army` 敌组），战斗规模随三路推进。
- 大战斗前缓冲：✓ 参战方式选择。
- 收获：△ 仅 exit `reward.s07.delayGift`。
- 缺口：✗ 开场对话；✗ Boss；✗ 战斗内收获。

### 5.9 S08 西华余部（task.s08.xihuaRetreat）——评级 D（待裁定）

**任务链**：乘撤运车撤离 → 完成信使召回。

- 学习和加强：△ 撤运车（载具撤离玩法）。
- **无任何敌人 placement**——"撤退"场景无追兵。撤辎重遇追兵本是常规戏剧点，当前纯驾车走流程。**需用户裁定**。

### 5.10 S10 广城扎营（task.s10.guangchengCamp）——评级 D（待裁定，剧情权重高）

**任务链**：确认临时扎营 → 送张角最后一程 → 点燃营火 → 修筑拒马 → 垒砌壁垒 → 修筑箭楼 → 完成迁营 → 出发广宗。

- 剧情钩子：✓ 张角病亡（`trg_s10_zhangjiao_death`）是全线最重要的叙事节点之一。
- 学习和加强：△ 四种建造（营火/拒马/壁垒/箭楼）。
- **无任何敌人 placement**——迁营/守灵场景无战斗。豁免（悲剧情境）还是缺口（夜袭战），**需用户裁定**。

### 5.11 S11 广宗救援（task.s11.guangzongRescue）——评级 C

**任务链**：选定参战方式 → 启动张梁限时救援 → 点燃烽火 → 集结卫兵 → 击退刺客第一波 → 第二波 → 第三波 → 护送张梁西门突围 → 登上战马 → 转进下曲阳。

- 大战斗：✓ 全线规模最大——`S11-han-army` 50 人方阵 + 三波刺客（每波 3 只，assassin 贴图）+ 突围护送 + 骑马撤离。
- 战斗渐进：✓ 三波刺客天然构成"小战斗→大战斗"节奏。
- 收获：△ 仅 exit `reward.s11.zhangliangGift`。
- 缺口：✗ 开场对话（张梁危局的紧迫感零铺垫）；✗ Boss——三波刺客首领可升格；✗ 战斗内收获。

### 5.12 S12 下曲阳突围（task.s12.xiaquyangRescue）——评级 C

**任务链**：选定参战方式 → 启动张宝限时救援 → 打开密道 → 架上云梯 → 焚毁云梯 → 护送张宝撤离 → 奔赴最终决战。

- 大战斗：✓ 救援+工程（密道/云梯/焚梯）+护送混合形态。
- 收获：△ 仅 exit `reward.s12.zhangbaoGift`。
- 缺口：✗ 开场对话；✗ Boss；✗ 战斗内收获。

### 5.13 S13 驹山决战（task.s13.jingshanBattle）——评级 B-

**任务链**：选定决战参战方式 → 讨斩敌将孙夏 → 前往结局营地。

- Boss 战：✓ 孙夏（isBoss、HP160、扑击 telegraph path 形预警）——决战场景的 Boss 配置正确。
- Boss 收获：✓ lootTable 铁矿 4-8 + exit `reward.s13.bossGift`。
- 缺口：✗ 开场对话（"决战已至"仅 showTip）；△ 收获全为资源，决战无装备纪念品。

### 5.14 S14 最后的选择（task.s14.finalCommit）——评级 B-

**任务链**：清点随行辎重 → 处置随行马车 → 处置投石机 → 驾驭投石机 → 了结此局（结局提交）。

- 结局场景：战斗豁免合理；辎重清点+投石机驾驭构成收尾玩法。
- 缺口：✗ 开场对话（终章情绪铺垫缺位，仅任务描述文字）。

---

## 六、横切缺口分析（系统性问题）

### 6.1 角色出现/开场对话缺失（S03-S14 全部，缺口①）

全项目对话仅 6 条，全部集中在 S01/S02/S09：

| 对话 | 场景 |
|---|---|
| dialogue.s01.wake | S01 开场旁白 |
| dialogue.s02.prologue / villageBeg / awakening / zhangjiaoSummons | S02 四条 |
| dialogue.s09.enlistment | S09 入伍 |

S03-S14 **十二个场景零对话**，场景进入只有 `showTip` 一句话。直接后果：

- 波才、张曼成、张梁、张宝、孙夏等核心人物零台词出场，玩家对"救谁、为何而战"无情感建立；
- 规则要求"过渡要有剧情钩子"——当前 S03→S14 的过渡钩子只有 exit 触发器的文字提示，属弱满足；
- "角色出现"环节在任务循环中系统性缺位。

### 6.2 战斗内收获缺失（缺口②，违反"每场战斗后必须有收获"）

查证 library.json：**S02-S12 全部战斗单位 lootTable 为空**（染疫村民、颍川黄巾/汉军、波才、张曼成、秦颉、粮仓哨兵、官军斥候、S11 刺客——全部 `lootTable: []`）。有掉落的仅：

- S01 狼系（狼皮/生狼肉）+ 狼王（狼牙+肉）；
- S13 孙夏（铁矿 4-8）。

现行收获模式是**离场结账**：每个场景的 `reward.*` 事务挂在 exit 触发器上（如 `trg_s03_exit_s04` 内嵌 reward.s03.firstBattle），玩家打完全程离开场景才一次性入账。与规则的偏差：

1. **时机错位**：规则要求"每场战斗后"收获，现在是"每场景末"收获——战斗结束到正反馈之间隔着整个后半场景；
2. **形态单一**：14 个 reward 事务内容全部为资源类（草药/粮/铁/符水），无一件装备、无一技能强化。S09 职业奖励（铁料×5）尤其可惜——选职业的"加强"仪式感为零。

### 6.3 Boss 布点稀疏（缺口③）

全 14 个战斗相关场景仅 2 个 Boss（S01 狼王、S13 孙夏）。S03-S12 十个战场场景无一 Boss。规则将"大战斗"与"Boss 战"列为两个独立环节，当前军团级大战斗（battle 编排/波次/护送）覆盖充分，Boss 战环节在主线中段完全空窗。

现成升格候选（纯数据改动，引擎能力全部现成）：

| 候选 | 场景 | 现状 | 升格动作 |
|---|---|---|---|
| 秦颉 | S05 | 敌将（HP170/攻13/防8）已在场 | +isBoss +telegraph +lootTable |
| 刺客首领 | S11 | 三波刺客（第三波可指定） | 同上 |
| 朱儁前锋校尉 | S03 | 前锋组无将领实体 | 新增 placement（狼王模式） |
| 波才围城军将领 | S04 | han-army 无将领 | 同上 |

### 6.4 quest rewards 区块全空（缺口④）

15 条 quest 的 `rewards` 数组全部为空。奖励全部散挂在触发器上。后果：

- 任务中心制（Quest-Centric Architecture）的奖励区块形同虚设——策划在任务向导里看不到、编不了奖励；
- 奖励与任务的因果关系断裂：奖励在 exit 结账而非"任务完成"时刻，玩家感知不到"完成任务得了奖励"。

QuestRuntime 编译链已支持 `rewards: [{type:'state', definitionId}]`（任务完成 → completion 触发器发奖励事务），把现有 `reward.*` 填进对应 quest 即可激活。

### 6.5 装备成长断档（缺口⑤，衍生问题）

S01 有完整的装备获得链（狼皮四件套制作 + 狼牙 Boss 掉落），此后 **S02-S14 全程无任何新装备获取途径**（唯一武器类掉落是狼牙）。玩家从荒原到决战穿同一套装备，"收获和加强"在长线上断档。

### 6.6 S06/S08/S10 零战斗（缺口⑥，待裁定）

三个场景无任何敌人 placement（S06 宛城围攻、S08 西华余部、S10 广城扎营）。S10 有张角病亡的悲剧情境豁免理由较强；S06"围攻"与 S08"撤退"从命名到任务描述都是战斗语境，无战斗内容属明显落差。需裁定：补战斗（围城守卫战/追兵阻击战）还是接受纯工程场景定位。

---

## 七、符合项与亮点

1. **S01 是十环节全循环的标准范本**：教程链（学习）→教学狼（小战斗）→剥皮烤肉制装备（收获加强）→追逐狼群（大战斗）→狼王（Boss）→狼牙（Boss 收获）→逃亡叙事（过渡），可直接作为后续场景内容补齐的对照模板。
2. **大战斗前的简单任务缓冲普遍存在**：S03-S14 全部有"参战方式选择"（观战/介入，battle.modeView），S04/S05/S11/S12 另有"限时救援启动"双重前置——规则"大战斗前要有简单任务缓冲"满足度高。
3. **历史线叙事逻辑清晰**：颍川→长社→宛城→西华→广宗→下曲阳→精山的黄巾起义脉络符合史实走向；S02 张角抉择（杀/救分支+结局）、S10 张角病亡、S14 结局提交构成三处强叙事锚点。
4. **现成机制复用充分**：waveCleared 波次判定（S02/S11/S13 在用）、telegraph Boss 预警（狼王/孙夏在用）、battle.command 战斗编排（S03-S13 在用）、reward.* 事务幂等（when exists 防重发）——补齐缺口的机制成本极低，基本都是数据层工作。
5. **主链拓扑无断裂**：15 条 quest 衔接完整，accept 条件（questCompleted 传递/event sceneEnter）与 travel 事务闭环，静态扫描 111 检查项全过。

---

## 八、改进建议与实施路径

按优先级排序（P0 最高）；改动量级：纯数据=仅 JSON、轻代码=少量 JS、中代码=多文件 JS。

### P0-1 S03-S14 补开场对话（补"角色出现"）

- **内容**：每场景 1 条 3-5 节点的开场对话（战役背景 + 核心人物出场 + 本战目标），S14 终章另加情绪铺垫。
- **机制复用**：`dialogue.s01.wake` 模式——sceneEnter 触发器 + startDialogue 动作 + dialogues.json 定义，零新机制。
- **涉及文件**：`project/dialogues.json`（+12 条）、`project/triggers.json`（+12 个 sceneEnter 触发器，注意排在 spawnPlacements 之后播）。
- **量级**：纯数据。头像可复用现有 PortraitsConfig（张角/信使已有，新将领需程序化生成——`gen-dialogue-portraits.mjs` 框架现成）。

### P1-1 战斗收获时机校正（补"每战必有收获"）

- **内容**：
  1. 把 exit 奖励的约一半拆出，挂到各场景的 waveCleared/战斗胜利节点（S02 染疫村民波、S11 三波刺客、S13 孙夏均为现成挂点）；
  2. 给战斗单位加小额 lootTable（汉军士兵：铁 1-2/草药 1/干粮 1，30-50% 掉率）。
- **机制复用**：waveCleared 挂 reward 的先例（`trg_s02_village_cleared`）；lootTable→generateLoot→地面掉落链全程现成。
- **涉及文件**：`project/triggers.json`（调整挂点）、`project/library.json`（lootTable 填充）。
- **量级**：纯数据。

### P1-2 Boss 布点（补 S03-S12 的 Boss 环节）

- **内容**：首推两处——S05 秦颉升格（isBoss+telegraph+lootTable：铁/装备）、S11 第三波刺客首领（新增将领实体或指定 w3-1 升格）。
- **机制复用**：狼王/孙夏全套先例（isBoss、ai.telegraph windupMs/shape、lootTable、Boss 血条）。
- **量级**：纯数据。

### P2-1 quest rewards 区块接内容

- **内容**：把 14 个 `reward.*` 事务填进对应 quest 的 `rewards` 数组，并把 exit 触发器上的重复奖励摘除（避免双发，reward.* 自带 when exists 幂等所以即使过渡期双挂也不重复入账）。
- **机制复用**：QuestRuntime 编译链已支持 `rewards:[{type:'state'}]` → completion 触发器。
- **量级**：纯数据。

### P2-2 装备成长线（补"收获和加强"长线）

- **内容**：S04/S07/S11/S13 四处战斗节点各投放 1 件装备（波才谢礼→武器、西华军械→护甲、张梁赠礼→饰品、孙夏掉落→决战武器升级件），沿 S01 狼皮四件套的词条风格配属性。
- **机制复用**：library equipment 定义 + lootTable 必掉（狼牙模式）或 reward 事务入包。
- **量级**：纯数据（装备图标走程序化生成管线）。

### P3-1 S06/S08/S10 战斗裁定（依赖用户决策）

- 选项 A：补战斗内容——S06 守城波次战、S08 撤退追兵战、S10 夜袭战（S10 若走悲剧情境可用"击退夜袭后张角伤重不治"兼得两者）；
- 选项 B：接受纯工程/剧情场景定位，在开场对话（P0-1）中强化叙事补偿。
- **量级**：A 为纯数据（复用 waveCleared 模式），B 随 P0-1 携带。

### 实施顺序建议

P0-1 → P1-1 → P1-2 → P2-1 → P2-2 → P3-1。P0-1/P1-1/P1-2/P2-1 全部为纯数据改动，可单批交付；每批交付后跑 scene 核心回归 + 实机冒烟（基线：s01FirstWolfPack / RealCanonicalColdRestartReplay / 场景核心 112 项）。

---

## 附录 A：奖励事务清单（14 个）

| definitionId | 挂载点 | 内容 | 幂等条件 |
|---|---|---|---|
| reward.s01.survivalKit | S01 | 草药×3 + 口粮 | story.rewards.survivalKit |
| reward.s02.rescueGift | trg_s02_awakening_done | 符水×2 + 草药 | story.rewards.rescueGift |
| reward.s02.rationGift | trg_s02_travel_s09 | 口粮×5 | story.rewards.rationGift |
| reward.s09.classGift | S09 职业确认链 | 铁料×5 | story.rewards.classGift |
| reward.s03.firstBattle | trg_s03_exit_s04 | 草药×2 | story.rewards.firstBattle |
| reward.s04.bocaiGift | trg_s04 exit | 粮×4 + 草药×2 | story.rewards.bocaiGift |
| reward.s05.mineGift | trg_s05 exit | 铁矿×6 | story.rewards.mineGift |
| reward.s06.siegeGift | trg_s06 exit | 资源包 | story.rewards.siegeGift |
| reward.s07.delayGift | trg_s07 exit | 资源包 | story.rewards.delayGift |
| reward.s08.retreatGift | trg_s08 exit | 资源包 | story.rewards.retreatGift |
| reward.s10.campGift | trg_s10 exit | 资源包 | story.rewards.campGift |
| reward.s11.zhangliangGift | trg_s11 exit | 资源包 | story.rewards.zhangliangGift |
| reward.s12.zhangbaoGift | trg_s12 exit | 资源包 | story.rewards.zhangbaoGift |
| reward.s13.bossGift | trg_s13 exit | 资源包 | story.rewards.bossGift |

共性：全部为资源类，无装备/技能；全部挂场景 exit（离场结账）。

## 附录 B：场景敌军分布速查

| 场景 | 敌组 | 规模 |
|---|---|---|
| S01 | S01-wolf-pack / S01-wolf-king | 追逐狼 5 + 狼王 1 |
| S02 | S02-villagers-hostile | 3（可选） |
| S03 | S03-han-army / S03-han-vanguard | 6+ |
| S04 | S04-han-army | 3+ |
| S05 | S05-han-army（含秦颉） | 4+ |
| S06 | — | 0 |
| S07 | S07-han-army | 3+ |
| S08 | — | 0 |
| S09 | 粮仓哨兵/官军斥候（探索性） | 少量 |
| S10 | — | 0 |
| S11 | S11-han-army / S11-assassin-wave-1/2/3 | 50 + 9 |
| S12 | 战斗+工程混合 | — |
| S13 | S13-sun-xia | Boss 1 |
| S14 | — | 0 |

## 附录 C：评审口径说明

- 本报告为静态数据评审：任务定义、触发器编排、敌人/掉落/奖励配置、场景 placement 均以当前工作区文件为准逐项核对；
- 未含实机跑测（战斗手感、教程节奏、对话演出时长等表现层指标不在本次范围）；
- S06/S08/S10 的定位裁定、狼王可选 Boss 是否纳入任务链，两项需用户决策后更新本报告结论。

