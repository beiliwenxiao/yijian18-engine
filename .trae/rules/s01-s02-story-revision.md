---
fileMatch: example/sanguo_zhangjiao/**, src/systems/JumpSystem.js
---

# S01/S02 剧情内容修订（参考新方案，章节结构不变）

> 范围裁定：S03~S14 保留现有版本，一切内容注入、名将 boss、太平要术等提案作废。
> 本文档只覆盖 S01（狼斗重构）与 S02（荒村冲突开场 + 删饥民事件）。

## 1. S01 荒原求生：狼斗两段式（去追杀）

### 现状
- 教学狼（firstWolf，剥皮教学）→ 追击狼×5（placement spawnWhen killed≥5 + S01S02SceneFlow.recordChaseWolfKilled 钩子）→ 狼王登场 → 击杀 → **跳河逃亡**（s01.jump 教程口径"狼群追来"）→ 攀藤出场景。

### 修订
狼群不再追杀，改为两段式阵地战：

| 步骤 | 开始条件 | 结束条件 |
|---|---|---|
| 狼群战 | 玩家进入狼群区域（enterRegion） | 狼群组全灭（waveCleared，组：S01-wolf-pack） |
| 狼王战 | trg_s01_wolf_pack_cleared 触发（spawnPlacements 狼王 + 提示"狼王现身"） | 狼王死亡（狼牙掉落不变） |
| 跳跃教学 | 玩家抵达河岸区域（enterRegion） | 教程 s01.jump 展示→完成（itemPickup/sceneComplete 不变） |

- **跳河从逃生手段改为地形通行教学**：教程口径改为「前方河面乱石，{jump} 跳跃通过」，跳河出口位置不变。
- **删除**：追击狼 spawnWhen killed≥5 条件、recordChaseWolfKilled 流程钩子、jump 教程旧文案。
- 狼王改为触发器 spawnPlacements 生成（同 trg_s02_choice_save 生成 S02-army 的既有模式），placement 的 spawnWhen 条件移除。
- 教学狼（firstWolf）与采集/剥皮教学链完全不动。

### 可选增补（新方案词汇，待勾选，默认不做）
枯木棍临时武器（先棍后斧）、毒蛇×1+毒状态、简易弓/狼骨锥配方、推石隐藏洞。

## 2. S02 山道救援：荒村冲突开场，删饥民事件

### 修订后流程

| 步骤 | 开始条件 | 结束条件 |
|---|---|---|
| 荒村冲突 | sceneEnter S02（story.s01Completed）→ 村民乞讨演出（showTip/短对话）→ 村民组转攻击 | 动手：村民组全灭（waveCleared）→ 力竭昏迷；不动手：原地受围攻 → 被打晕。**两条路都汇入昏迷** |
| 救/杀抉择 | 主角昏迷（复用现有 army.rescue.faint 演出） | dialogue.s02.prologue 抉择完成（机制原样：kill→乱世草芥结局 / save→继续） |
| 担架救援 | choice_save（task.s02.rescue 启动、S02-army 生成、army.rescue.begin 原样） | enterRegion S02-camp-rescue（army.rescue.awaken 原样） |
| 教学位 | 救援开始时展示 2 条教程：s02.command.move（指挥移动）、s02.command.carry（抬担架回营） | 各自完成事件关闭 |
| 苏醒与收获 | dialogue.s02.awakening 结束 | 发放**张角赠符水**（新消耗品，回血，有限次数）+ 现有 rescueGift；直接进入召见 |
| 召见与启程 | farewell/summons/accept/travel 触发器链原样 | trg_s02_travel_s09 → S09 |

### 叙事要点
- 救/杀抉择的叙事前提改为「荒村冲突的收场」：昏迷后控制权交张角，由他决定杀或救（对话文案层改写，dialogueChoice 机制不动）。
- 现有"黄巾救主角"的叙事权不变：担架抬的是主角自己。

### 删除清单（饥民事件整条）
- 触发器：trg_s02_prepare_refugee_conflict、trg_s02_start_refugee_conflict、trg_s02_refugee_choice
- 事务：story.s09.refugee.prepare / .start / .branch（commands.json 三条）
- 对话：dialogue.s09.refugeeConflict
- 任务：task.s02.refugeeRelief（整条 quest 含 objective）
- 奖励：reward.s02.reliefGift 事务及 trg_s02_refugee_choice 中的追加动作
- 场景：S02 饥民相关 NPC placements

### 任务链修复
- task.s02.summons 的 accept 条件从 questCompleted task.s02.refugeeRelief 改为 **questCompleted task.s02.rescue**。
- task.s02.rescue 保留（担架救援 objective 不动）。

### 新增资产
- 敌人：染疫村民（enemy.s02_plague_villager，行为：乞讨演出期 aiActive=false → 转攻击 aiActive=true；先乞讨后攻击）
- 物品：符水（consumable.fushui，使用回血，堆叠上限即"有限次数"）
- 教程：s02.command.move、s02.command.carry（tutorials.json 两条，scope S02）

### 可选增补（新方案词汇，待勾选，默认不做）
疯狗×2（村口快攻低血）、陶罐打碎掉落（铜钱/草药）、水井交互。

## 3. 落地批次

- **P1（数据级）**：S01 狼斗重构（触发器+placement+钩子清理）、S02 饥民删除（触发器/事务/对话/任务/奖励清理）、任务链 accept 修复、jump 教程改口径
- **P2（内容级）**：S02 荒村冲突演出（村民 AI 两段行为+昏迷汇流）、符水物品与发放、s02.command 两条教程、prologue/awakening 对话文案改写
- 可选增补项按勾选插入 P1/P2。

## 4. 验收口径

- S01：狼群→狼王→跳河全程无追击事件；jump 教程在新口径下可完成；教学狼剥皮链不受影响。
- S02：无论"动手/不动手"都到达昏迷→抉择→救援→苏醒→召见；饥民相关触发器/任务/对话全部不可达且不存在悬空引用；task.s02.summons 在 rescue 完成后可接。
- 引用闭合：quests→triggers→commands→library 全链校验零错误。
