# debug-s01-wolf-and-river-jump

> S01 两个玩法缺陷的运行时定位档案（TRAE-debugger 工作流）
> 证据目录：`%TEMP%/w-verify/probe-s01-v9.txt`、`%TEMP%/w-verify/probe-river-geom.txt`
> 探针脚本：`scripts/probe-s01-wolf-and-jump.mjs`、`scripts/probe-s01-river-geometry.mjs`

## 现象

1. 庇护所内过夜后出门，狼群（S01-wolf-pack）与狼王（S01-wolf-king）均未出现。
2. 玩家跳跃越过河道时被弹回起跳点（视觉上已越过不可落脚的河道区域）。

## 证据来源

| 探针 | 关键输出 |
|---|---|
| `probe-s01-wolf-and-jump.mjs` | 绑定/触发器/生成全链的运行时快照 |
| `probe-s01-river-geometry.mjs` | 河道/踏石/落点几何与落地修正量 |

## 假设与结论

| # | 假设 | 结论 | 证据 |
|---|---|---|---|
| H1 | 狼群生成管线（spawnPlacements）缺陷 | **REJECTED** | 手动 `spawnPlacements{group:'S01-wolf-pack'}` → 3 只生成成功（hp 32）；补齐前置事实后 `trg_s01_wolf_region_enter` 正常触发、3 只生成（live=true） |
| H2 | 狼群绑定 `activeWhen` 永不就绪 | **REJECTED** | 提交 `firstWolfSpotted`/`firstWolfKilled` 后 `binding-active=true`、触发器进入 `_firedOnce` |
| H3 | 狼群领地不可达（主线路径不经过） | **CONFIRMED** | 领地世界坐标 x 7696–7936（局部 x 11–251），庇护所出口在局部 x≈399；任务链 `leaveShelter → crossRiver` 目标在局部 x 480→824，**全程向东**，永不向西踏入领地 |
| H4 | 落地帧把玩家推回起跳点 | **CONFIRMED** | 落点 (8307.69, 3868.3) → (8088.82, 4225.18)，位移 **418.65px**，回到跳跃前的旧位置 |
| H5 | 滞空中被地形碰撞阻挡 | **REJECTED** | 滞空期 `trail` 全程 `corrected: null`（`resolveEntities` 对滞空实体跳过） |

## 根因

### 现象①：狼群/狼王不出现 —— 触发点不在玩家路径上

- 狼群战入口 = 空间绑定 `S01-binding-wolf-region`（`event: enter`，目标 `S01-zone-wolf-region`）。
- 该绑定框世界坐标 x 7696–7936（局部 x 11–251，庇护所**西侧**）；庇护所出口 `S01-spawn-shelter-rest` 在局部 x≈399。
- 任务链 `leaveShelter → crossRiver(S01-river-far-bank 局部 x=824) → reachCliff(局部 x=980)` **全程向东**，没有任何一步引导玩家向西踏入狼群领地。
- `activeWhen` 还要求 `firstWolfKilled === true`（教学狼已击杀），该事实成立与否不影响"玩家不会走到领地"这一事实。
- 生成管线本身无缺陷（H1/H2 已证伪）：触发即生成 3 只狼；狼王由 `trg_s01_wolf_pack_cleared`（`waveCleared` group=S01-wolf-pack）→ `spawnPlacements{group:'S01-wolf-king'}` 生成。

### 现象②：跳跃过河被弹回 —— 落点在河道 shape 内被推回跳跃前旧位置

- `SceneTerrainCollision.resolveTerrains` 在滞空期**不更新**已解算位置记忆（`previous` 保持跳跃前的位置）。
- 落地帧 `resolveEntities`：`isWalkable=false`（落点不在任何 walkable 多边形内）+ `previous` 在 walkable 内 + 落点在任意 shape 内 → 命中 `pushedBackToWalkable` 分支 → `p = previous`。
- 结果：落点 (8307.69, 3868.3) 被改写为 (8088.82, 4225.18)，**弹回 418.65px**（跳跃前的旧位置），而不是按跳跃弧线推到河岸踏石上。
- 河道 `S01-river`（collide=true，26 点）与踏石带 `obj_1791102721114`（walkable=true，局部 x 588–824）在空间上重叠；踏石带是设计上的"跳石过河"通道，但落点判定没有把"从对岸起跳、跨越河道断面"这一情形排除掉。

## progress_status

- 已定位两处根因（H3 / H4 CONFIRMED）。
- 待实施最小修复并做修复前后对比。

## 环境

- 平台：Windows / Chrome headless（`C:/Program Files (x86)/Google/Chrome/Application/chrome.exe`）
- dev server：`http://localhost:3000/example/sanguo_zhangjiao/index.html`
- 探针前置：开场对话需持续 `endDialogue()`（否则事务被对话锁拦、跳跃被拒）
- 黑板权威写入：`blackboard.set('storyState', {...})`（SDD 镜像每帧从文档恢复，改嵌套字段无效）

## 修复实施与修复前后对比

### 修复①：狼群/狼王不出现 —— 任务链补狼群战步骤

**改动**：`example/sanguo_zhangjiao/project/quests.json` 的 `task.s01.survival` 步骤链
在 `leaveShelter` 与 `crossRiver` 之间插入两步，并给两步加 mapTarget 引导：

| 步骤 | objective target | mapTarget |
|---|---|---|
| `defeatWolfPack` | `story.s01.wolfPackCleared` | `S01-zone-wolf-region` |
| `defeatWolfKing` | `story.s01.wolfKingDefeated` | `S01-zone-wolf-region` |

**依据**：设计稿 `.trae/rules/s01-s02-story-revision.md` §1 要求「狼群战 → 狼王战 → 跳河」串行，
但任务链原本只有「离开庇护所 → 跳石过河」，中间缺狼群战；且狼群领地位于庇护所西侧
（BFS 验证需绕行中间地形多边形，通路存在），玩家无引导不会去。

**修复前后对比**（`scripts/probe-s01-e2e-wolf-and-jump.mjs`）：

| 观测点 | 修复前 | 修复后 |
|---|---|---|
| 踏入领地后 `trg_s01_wolf_region_enter` | 不触发（无引导，玩家不会到） | 触发，进入 `_firedOnce` |
| `S01-wolf-pack-1/3` placement | spawned=false | spawned=true / live=true |
| 狼实体 | 无 | 3 只（hp 32） |
| 清群后 `trg_s01_wolf_pack_cleared` | 不触发 | 触发 |
| `S01-wolf-king` placement | spawned=false | spawned=true / live=true |
| `s01Survival.wolfPackCleared` | false | true |

**编译校验**（`scripts/verify-s01-quest-compile.mjs`，13 项全过）：两个步骤编译存在、
链上位置 [13,14,15,16] 顺序正确、matcher 为 `state.transaction` + 对应事实、
mapTarget 指向的场景对象可解析（7691,4109,240×200）。

### 修复②：跳跃越河被弹回 —— 落地帧不再回退到跳跃前的旧位置

**改动**：
- `src/systems/JumpSystem.js`：落地时记录 `startPos` + 跳跃方向到 `_lastLanding`，
  提供 `getLastLanding(entity)` / `clearLastLanding(entity)`。
- `src/core/scene/SceneTerrainCollision.js`：
  - `resolveEntities` 落地帧读 `landing`：落点在阻挡 shape 内时，
    沿跳跃方向回溯到最后一个「不在任何阻挡 shape 内」的点（`_findLastWalkableAlongJump`），
    不再使用 `previous`（跳跃前的旧位置）；
  - 落地帧跳过 `pushedBackToWalkable` 兜底分支（同上原因）；
  - 穿墙判定（`resolveShape` → `_crossedPolygon`）的起点改用**跳跃起点**，
    并在落地帧跳过该判定（跳跃本就允许跨过水面）；
  - `resolveShape` 新增 `skipCrossCheck` 参数。

**修复前后对比**（`scripts/probe-s01-river-geometry.mjs` / e2e 探针）：

| 观测点 | 修复前 | 修复后 |
|---|---|---|
| 落地帧位置修正 | (8366.6,3958.2) → (8088.82,4225.18) | 无修正 |
| 弹回位移 | **418.65px**（回到跳跃前旧位置） | **0px** |
| 落点是否被阻挡 | 落在河道 shape 内 | 落在踏石上（`finalInStoneBox=true`） |
| 跳跃位移保留 | 150px → 实际 0 | 150px 完整保留 |

## 回归

- `test/s01FirstWolfPack.test.js` + `test/saveSystemRegression.test.js`：45/45 通过
- `npx vitest run src/`：1546/1561 通过，15 个失败集中在
  ErrorHandler（8，`window is not defined`）、MapSystem（2）、GamepadManager（1）、
  ItemRuntimeFactory（1）、HostBackendDefaults（1）、FlightSystem.elevation（2）——
  **均与本次改动无交集**（浏览器环境依赖 + 既有断言不符），属既有基线。
- `test/questRuntimeCompilation.test.js` + `test/taskGraphWoodProgress.test.js`：
  10 个失败为**既有基线**（用 HEAD 原版 quests.json 复跑同样 10 failed / 14 passed）。

## progress_status

- 两处根因均已修复并通过端到端运行时验证。
- 剩余待人工确认：实机手感（跳跃落点是否落在踏石上）、狼群战引导在 minimap 上的表现。

