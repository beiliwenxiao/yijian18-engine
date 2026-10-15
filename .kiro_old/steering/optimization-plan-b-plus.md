---
inclusion: manual
---

# 引擎优化方案 B+：模块化升级与多成长系统并存

## 定位

本方案基于项目现有功能分析，目标是在保留现有 API 和 Demo 可运行性的前提下，把重复、耦合或缺少统一协议的能力升级为可复用引擎模块；同时保留传统技能树、职业天赋树和 POE 式天赋盘，三者共用同一个成长图内核。

方案位于「只修补现有系统」和「完整 RPG 平台重写」之间：不重写引擎，也不继续把通用规则堆入具体 Scene。

相关文档：

- 已确认决策：#[[file:progression-decisions.md]]
- 通用设计规则：#[[file:progression-system.md]]
- 实施现状与约定：#[[file:progression-implementation.md]]

本文件是规划与验收标准；具体已落地的接口和约定以 `progression-implementation.md` 为准。

## 实施进度

```text
S1  EffectResolver              已完成
S2  AbilitySystem               已完成
S3  ProgressionGraphSystem      已完成
S4  旧系统适配器                已完成
S5  暗黑式分支与技能形态         已完成
S6  小型 POE 盘（45 节点）       已完成
S7  配置选主（默认 arpg）        已完成
S8  统一成长 UI                 已完成
S9  InputActionRouter + Snapshot 已完成
S10 ContentValidator + 场景提取  已完成
S11 Demo 迁移验证               进行中

已完成代码接线：WorldStreaming 单一权威、九宫格异步事务、同步原子快照恢复与跨 Region shadow prepare
待完成验收：浏览器连续跨界/传送、两轮存读档、100 实体性能与内存硬门槛
部分完成：场景通用能力已提取并由 BaseGameScene/DataDrivenPrologueScene 增量采用
```

## 总体原则

- 复用现有 ECS、GameLoader、TriggerSystem、战斗、背包、载具、UI 和双渲染后端。
- 通用机制进入 `src/core` 或 `src/systems`，历史人物、剧情、场景和数值留在 `example`。
- 定义、角色运行状态、业务结算和 UI 表现必须分离。
- 新模块通过依赖注入和适配器接入，禁止无迁移方案地删除旧 API。
- 业务逻辑只执行一次，Canvas2D 与 Three.js 只负责表现。

## 直接复用的现有能力

- ECS：Entity、Component、EntityFactory 及现有组件。
- Runtime：GameEngine、Scene、SceneManager。
- 内容：GameLoader、Registry、Blackboard、TriggerSystem、ExpressionEngine。
- 世界：core WorldStreamingManager、LoadedChunk。
- 游戏：Combat、Movement、Collision、AI、Equipment、Pickup、Vehicle。
- 表现：UISystem、现有 Panels、Canvas2D/Three.js backends。
- 基础设施：AssetManager、AudioManager、RNG、ObjectPool、PerformanceMonitor。

## 核心升级模块

### 1. EffectResolver（已完成）

统一技能、天赋、装备、职业、Buff、采集、建造和载具效果。支持 `add`、`addPercent`、`multiply`、`override`、`clamp`、条件、来源和叠加规则。禁止各系统继续扩散任意效果字段判断。

### 2. AbilitySystem 与 ProgressionGraphSystem（已完成）

AbilitySystem 负责技能消耗、冷却、目标、距离、施法与执行准入；ProgressionGraphSystem 负责节点、前置、点数、分支和重置。定义数据与每个角色的分配状态分离。

### 3. InputActionRouter（已完成）

InputManager 继续采集设备状态；InputActionRouter 生成统一事件并单消费者路由。按键与修饰键约束内置在路由层，接线方无需重复声明。

### 4. SnapshotManager（已完成）

各系统提供 `snapshot / validate / restore`。加载时先整体校验，再依次写入；任一失败回滚。ProgressManager 降级为存储适配器角色，不直接恢复业务对象。

### 5. ContentValidator（已完成）

在 GameLoader 修改 Registry 和运行状态前完成 JSON 解析、版本、必填字段、范围、引用和规范化校验。失败时保留最近有效配置。

### 6. 场景通用能力（部分完成）

已提取 `SceneSystemContainer`、`SceneObjectProjector`、`GameSceneRuntime`。

尚未完成：把 BaseGameScene、DataDrivenScene、DataDrivenPrologueScene 迁移到这些模块。迁移建议分两步，先替换系统注册与退出清理，再单独处理输入路由。

### 7. WorldStreaming 单一实现（代码接线完成，运行验收中）

`src/core/WorldStreamingManager.js` 是唯一状态权威：拥有 Region 命名空间 `loaded/savedStates`、generation + AbortController latest-wins、九宫格并行 prepare、完整校验、一次 commit 和逆序 rollback。`src/systems/WorldStreamingManager.js` 只保留无状态兼容转发，禁止再拥有第二份运行状态。

`LoadedChunk` 通过注入的 placement adapter 执行 prepare/commit/rollback/release；场景对象从只读局部坐标投影，`x/y/sortY/points` 的 worldOffset 只应用一次。动态资源、敌人、NPC、掉落、工事和载具由 state provider 捕获；同步快照恢复不得卸载当前 runtime 或发起 IO，provider 若返回 Promise 必须拒绝并回滚。`BaseGameScene.restoreSaveState()` 的直接调用同样必须先采集调用前快照，任一内容/场景/provider 提交失败后恢复整份旧状态，不能只依赖 SnapshotManager 外层回滚。

载具运行态快照固定由内容定义重建组件后恢复：`VehicleComponent` 的 schema 必须严格校验 `vehicleType/hp/destroyed/seats/logistics`，`deserialize()` 先完整 validate/prepare、失败零修改，调用方必须检查返回值。Cargo 首次摧毁只允许一个稳定 operationId 和一个确定性 DeathDrop；掉落实体、Cargo、Vehicle 与物流 ledger 必须处于同一回滚边界。DeathDrop 存档只保存 `deathId/stacks/position` 等业务事实，图片由场景注入稳定 `imageId/assetId`，不得把表现资源变成存档事实源。

`WorldMapLoadSession` 只预载入口/目标场景：`CanonicalSceneRepository.refresh()` 只读取并校验 `game.project.json` 与 `_scene_order.json` 的目录 closure，不得遍历读取全部场景正文；九宫格 `sceneResolver` 请求具体 `sceneId` 时才读取、校验并在当前 generation 内去重。Manifest 注册只建立稳定 ID 索引，不等于全量资源 I/O；每个 chunk 必须在 `LoadedChunk.prepare()` 前根据可见 layer、placement/registry 定义及当前 scene usage 收集并加载所需稳定 ID，`imageAssets` 仅是编辑器路径映射，不能作为全量使用清单。资源加载失败必须使九宫格 prepare 失败并保留旧投影；没有 lease/refcount 前，chunk unload 不得直接删除可能由相邻块共享的图片缓存。

跨 Region 必须先完成 detached manager 的目标九宫格加载与校验，再清理旧区并激活。九宫格实体生成按 physical `chunk.sceneId` 匹配 placement：SXX-CNN 与 SXX 只共享业务状态 namespace，不得用归一后的 SXX 过滤附属 chunk 内容；首次进入、自然跨界、传送和跨 Region 激活都要为当前 loaded chunks 做幂等生成。剩余门槛是浏览器连续跨界/远距传送、失败保持旧区、两轮 save/load 等价、SXX-CNN namespace、100 实体性能和内存验收。

### 8. 旧系统兼容适配器（已完成）

SkillTreeSystem、TalentSystem 已通过 `LegacyProgressionAdapter` 转发到成长图内核，对外 API 不变。ProgressManager 与 Scene 调用接口保持可用。

## 三套成长系统的固定职责

### SkillTree

主动技能解锁、技能等级、强化分支、形态替换、终极技能和快捷栏能力。技能实际执行进入 AbilitySystem。

### TalentTree

职业专精、战斗风格、职业被动、互斥路线、二选一节点和少量强规则修改。

### PassiveBoard

长期 Build，包括属性、生存、元素、武器、采集、制造、建造、载具、多职业路径、核心天赋、精通与插槽。

三者不得重复只提供同类数值。推荐关系是：技能树解锁能力，职业天赋改变玩法，天赋盘构筑长期被动，装备动态强化 Build。

## 项目配置

```json
{
  "progression": {
    "profile": "arpg",
    "primary": "talentTree",
    "enabled": ["skillTree", "talentTree", "unitTalent", "passiveBoard"],
    "secondary": ["passiveBoard"],
    "pointPools": {
      "skill": "independent",
      "talent": "independent",
      "unit": "independent",
      "passive": "independent"
    }
  }
}
```

`primary` 支持 `skillTree`、`talentTree`、`unitTalent`、`passiveBoard`。

## 推荐预设

| 预设 | primary | enabled | 说明 |
|---|---|---|---|
| classicRpg | talentTree | 技能树 + 职业天赋 | 技能树负责主动能力，职业天赋为主成长 |
| arpg（默认） | talentTree | 四类全启用 | 职业天赋为主，小型 POE 盘中后期开放 |
| poeLike | passiveBoard | 技能树 + 天赋盘 | 大型被动盘负责主要 Build |
| roguelite | skillTree | 技能树 + 天赋盘 | 局内随机为主，局外解锁为辅 |

`hybrid`（三套同等重要）只适用于能承担较高平衡和 UI 成本的复杂 RPG，当前未作为预设提供。

## 点数池

默认独立点数池：技能点、天赋点、兵种点、被动点分别消费。允许配置共享或部分共享，但必须统一经过 PointLedger，做到校验、扣点、分配一次提交。

独立池最容易平衡，也能避免玩家为了 POE 节点放弃必要主动技能。共享成长点只适合明确强调「职业专精与自由构筑取舍」的游戏。

## 统一模型

```js
GraphDefinition {
  id, mode, version, pointPool, startNodes, nodes, edges, rules
}

NodeDefinition {
  id, kind, maxRank, costs, prerequisites, choiceGroup,
  exclusiveWith, gates, position, region, effects
}

ProgressionState {
  characterId, graphs, revision
}
```

定义对象由 Registry 共享且只读；角色分别保存 `ProgressionState`。节点定义禁止包含角色的 `currentRank`、`isLearned` 或 `isUnlocked`。

## POE 盘要求

- 支持多职业起点和连接路径验证。
- 节点类型至少包括 minor、notable、keystone、mastery、socket、start。
- 建立节点索引、邻接表、区域索引和可见节点缓存。
- 只在分配变化时增量重算效果。
- UI 支持缩放、平移、搜索、路径高亮、分配与重置预览、视口裁剪。
- 首版固定 45 节点，验证玩法后再决定是否扩大。

## 通用能力提取边界

适合从 Demo 提取：

- BaseGameScene 的系统装配与生命周期。
- DataDrivenScene 的配置加载方式。
- 多 Terrain/Chunk 和 worldOffset 投影。
- 平台 UI 装配与条件式教程机制。
- 系统领域事件到 TriggerSystem 的集中桥接。

禁止提取到引擎核心：

- 特定历史人物、剧情、战役和结局。
- 特定物品、敌人、波次、场景数值和出生点。
- 只服务单一 Demo 的 Scene 分支。

## 验收标准

- 旧 Demo 不经大规模重写仍可运行。
- 多角色不共享技能或天赋分配状态。
- 相同效果通过统一 Resolver 得到可追踪结果。
- 一个输入事件最多由一个业务处理者消费。
- 配置或存档校验失败不破坏当前有效状态。
- Scene 重复加载后世界坐标不漂移。
- 2D/3D 使用同一业务状态。
- 禁用某成长结构不删除其存档状态。

## 非目标

- 不立即实现完整大型 POE 天赋盘和专用编辑器。
- 不重写全部现有系统。
- 不把所有游戏玩法塞入 `src/core`。
- 不在缺少内容验证前建设完整在线 RPG 平台。

## 剩余工作

1. S11 Demo 迁移验证：旧张角 Demo 通过新架构运行，逐个切换 `primary` 验证默认体验，100 实体性能检查。
2. BaseGameScene 迁移到 `GameSceneRuntime`，分两步执行。
3. WorldStreaming 异步事务与 Region 协调。
4. 旧 SkillTreePanel / TalentPanel 改读 `ProgressionViewModel`，之后移除节点投影。
5. 根据实际游戏需求决定是否扩大天赋盘规模。
