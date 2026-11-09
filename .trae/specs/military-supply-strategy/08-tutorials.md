# 模块 8（v2 修订）：教程与引导（七级台阶 · 两层级版）

> 状态：设计稿 v2（2026-11-09 两层级修订：约 26 条 → 约 17 条；级 3 改随行五档、级 4 改五条战略指令、级 5 改战前部署（布阵 + 主将位置）、级 6 改在场接管+倒地掉落、原军阵/接管/痕迹/窗口/将令教学全砍；v2.1 随 P22 把「布阵」并入「战前部署」页签）
> 归属：[军需—配给—押运—军团体系总纲](spec.md) 模块 8

---

## 1. 引擎硬约束（不变，仍是设计前提）

| # | 约束 | 实证 |
|---|---|---|
| 1 | **只有当前已显示的教程才消费信号** | `notify()`（`:159-178`）：`const definition = this.currentTutorial; if (!definition || ...) return false` |
| 2 | **必须显式 `showTutorial`**（触发器 `tutorial` 动作或代码） | 引擎不会自己弹 |
| 3 | **单槽位**：同一时刻只有一个 `currentTutorial` | `pendingTutorials` FIFO 排队 |
| 4 | **只吃 committed 事件** | `payload?.ok === false || payload?.committed === false` 直接返回 |

→ 教程阶梯 = **触发器链（何时教）+ tutorials.json（教什么/怎么算完成）**，不新增系统。

## 2. 复用字段（不变）

`scope` / `steps`（最多 3 步）/ `signalRules[{signal,threshold,conditions}]` / `movementRule` / `completionPolicy:'signal'` / `pauseGame` / `canSkip` / `priority`（阶梯后期更高）/ `category`（`prod/supply/companion/worldmap/terrain/battle/town` 七类）。

---

## 3. 七级台阶（v2）

### 级 1 · 生产与锻造（`prod`，不变）

| 项 | 内容 |
|---|---|
| 触发 | `when: quest.accepted`（首个"造一把武器"类任务）→ `tutorial { id:'tut.prod.station' }` |
| 完成判定 | `signalRules: [{ signal:'productionStarted', threshold:1 }]` |
| 容忍 | 软引导；30s 未开工降级 tip |
| 进阶 | `tut.prod.forge`：`signal:'itemForged'`（品质/词条/损耗） |

### 级 2 · 配给与押运（`supply`，不变）

| 项 | 内容 |
|---|---|
| 触发 | `when: production.completed` → `tutorial { id:'tut.supply.requisition' }` |
| 完成判定 | `signalRules: [{ signal:'supply.requisitioned', threshold:1 }]` |
| 容忍 | 软引导 |
| 进阶 | `tut.supply.convoy`：`signal:'convoy.dispatched'` |

### 级 3 · 随行小队（`companion`，v2.2 重写——无 Tab/编组）

| id | 触发条件 | 完成判定 | 容忍 |
|---|---|---|---|
| `tut.companion.summon` | `when: army.recruited`（首次招募） | `custom.event:companionAssigned`（第一次设为随行） | 软 |
| `tut.companion.stance` | 前置完成 | `companion.stanceChanged`（切过一次档） | 软；文案教"五档：跟/攻/守/冲/撤，他们会自己打" |
| `tut.companion.charge` | 前置完成 | `companion.stanceChanged` + conditions `stance:'charge'` | 软；错过不重发 |

### 级 4 · 大地图（`worldmap`，v2 收敛为 5 条——原 9 条砍 takeover/trace/route 三概念）

| id | 触发条件 | 完成判定 | 容忍 |
|---|---|---|---|
| `tut.worldmap.open` | `when: army.grant` | `custom.event:worldmapOpened` | 软；按 M 提示常驻 |
| `tut.worldmap.order` | 前置完成 | `unit.orderIssued`（第一道指令） | 软；文案教五条战略指令环 |
| `tut.worldmap.formation` | 前置完成 | `custom.event:deploymentCommitted`（第一次把战前部署存为默认值） | 软；文案教"战前部署页签：兵种/阵法/主将位置——大地图存默认值，接战前在战场还能改一次（可勾选设为默认），**一接战就锁定**" |
| `tut.worldmap.encounter` | 前置完成 | `unit.encounterResolved` | 软；文案教"不在场自动打，在场你亲自上" |
| `tut.worldmap.city` | 首次点城池旗 | `custom.event:cityPanelOpened` | 软 |

### 级 5 · 地势与工事（`terrain`，v2.1 重写——砍军阵 6 策略教学，布阵已并入级 4）

| id | 触发条件 | 完成判定 | 容忍 |
|---|---|---|---|
| `tut.terrain.camp` | `when: unit.order`（order:'camp' 首次） | `camp.laid` | **硬门槛**（`pauseGame:true` + `canSkip:false`）——扎营 buff 界面无说明看不懂 |
| `tut.terrain.works` | 首个工事建造任务 | `terrainWorks.built` | 软 |

### 级 6 · 倒地与掉落（`battle`，v2.2 新——替代原"介入战斗"级）

| id | 触发条件 | 完成判定 | 容忍 |
|---|---|---|---|
| `tut.battle.onfield` | 玩家首次进入实时战斗（链 A） | `custom.event:battleOnfieldSeen` | 软；文案教"你在场就能**接管**（拿指挥权），不在场军队自己打"（支援=只指挥亲卫，旁观=不接管） |
| `tut.battle.downed` | `player.downedDropped`（首次战斗倒地） | `player.lootRecovered`（捡回第一件） | **硬门槛**（`pauseGame:true`）——倒地掉落/穿戴保护/夺回是重大规则，必须讲清 |

### 级 7 · 内政（`town`，不变）

| id | 触发条件 | 完成判定 | 容忍 |
|---|---|---|---|
| `tut.town.overview` | `when: city.captured` | `city.productionSettled` | **硬门槛**（`pauseGame:true` + `canSkip:false`）——城池卡无说明看不懂 |
| `tut.town.recruit` | 前置完成 | `city.recruited` | 软 |
| `tut.town.transport` | 前置完成 | `city.transportDispatched` | 软 |

---

## 4. 失败容忍三档（不变）

| 档 | 适用 | 机制 |
|---|---|---|
| **软引导（默认）** | 绝大多数 | `canSkip:true` + `pauseGame:false`；30s 降级 tip（5 分钟冷却）；同类事件再发生可重弹 |
| **硬门槛（3 条）** | `tut.terrain.camp`、`tut.battle.downed`、`tut.town.overview` | `pauseGame:true`（前两条新增，v2.2） |
| **不重发** | `tut.companion.charge`（错过窗口即结束） | 决策有代价是设计意图 |

## 5. 教程与任务中心分工（不变）

`quests`（做什么）/ `tutorials`（怎么做）/ `triggers`（什么时候教）；阶梯用 `tutorialCompleted` 串联；业务代码不硬调 `showTutorial`。

## 6. 信号清单（v2 更新）

| 信号 | 来源 | 级 |
|---|---|---|
| `productionStarted` / `production.completed` / `itemForged` | 模块 1 | 1 |
| `supply.requisitioned` / `convoy.dispatched` | 模块 2 | 2 |
| `army.recruited` / `companion.stanceChanged` / `companionAssigned`（custom） | 模块 3 | 3 |
| `army.grant` / `unit.orderIssued` / `formationSet`（custom） / `unit.encounterResolved` / `cityPanelOpened`（custom） | 模块 3/4 | 4 |
| `camp.laid` / `terrainWorks.built` | 模块 5 | 5 |
| `battleOnfieldSeen`（custom） / `player.downedDropped` / `player.lootRecovered` | 模块 3/6 | 6 |
| `city.captured` / `city.productionSettled` / `city.recruited` / `city.transportDispatched` | 模块 7 | 7 |
| `tutorialCompleted` | `TutorialSystem` 既有 | 串联 |

**砍**：`army.selected` / `army.routePlanned` / `army.tookOver` / `traceSeen` / `battle.prepare` / `battle.planCommitted` / `battle.interveneWindowOpen`。
全部事件必须 `committed: true`（`notify` 首行过滤）。

## 7. 数据落点与校验（不变）

- 定义：`project/tutorials.json`；阶梯串联：`project/triggers.json`。
- 校验器（8C）：①signal 必须已注册 ②阶梯引用信号存在 ③`canSkip:false` 必须 `pauseGame:true`。

## 8. 分级交付（v2）

| 级别 | 内容 | 验收 |
|---|---|---|
| **8A 信号打通 + 级 1~3** | 补齐 committed 事件 + 级 1~3 教程 | 三条主链按序完成；跳过不阻塞 |
| **8B 级 4~5** | 大地图 5 条 + 地势 2 条 + 串行触发器链 | 从获得军团到扎营全程不重不漏 |
| **8C 级 6~7 + 校验器** | 倒地/内政教程 + 校验器 | 删事件名能被校验捕获；全流程教程不残留未完成必做项 |

## 9. 零回归与风险（不变项沿用 v1）

- 教程未完成不阻塞（触发器双保险）；`notify` 只吃 committed → §6 白名单 + 校验器；单槽位靠阶梯串行；跨场景教程 `scope` 留空；硬门槛不在实时战斗中；既有 S01~S14 教程 `category` 不重叠。

## 10. 开放问题（v2）

| # | 问题 | 默认 | 若选另一种的差异 |
|---|---|---|---|
| 1 | 教程条数 | **约 17 条**（v2 缩并） | 更精简（12）：阵法/倒地规则靠 UI 自解释，学习成本转嫁玩家 |
| 2 | 硬门槛数量 | **3 条**（camp/downed/overview） | v1 是 2 条；downed 加进去是因为掉落规则复杂 |
| 3 | 倒地教程是否打断战斗 | **打断（pauseGame）** | 不打断：玩家边打边看，可能无视 |
| 4 | 错过 charge 档是否重发 | **不重发** | 重发：失去"决策有代价" |
| 5 | 是否做教程编辑器 | **不做**（只读总览） | 做：成本高 |
| 6 | 超时降级 | **30s tip / 5 分钟冷却** | 不降级：不知道下一步 |
| 7 | 老玩家（读档）是否补弹 | **不补** | 全补：读档被教程淹没 |
| 8 | `maxWaitSeconds` 字段 | **不加**（触发器侧定时） | 加：改 TutorialSystem + schema |
