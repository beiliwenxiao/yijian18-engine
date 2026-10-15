---
inclusion: manual
---

# Canonical 编辑器与场景运行架构

本文件只记录当前编辑器与运行时之间的稳定边界。具体地图编辑操作见 `map-editor.md`，UI 布局见 `ui-editor.md`，阶段完成度见 `yijian18-game-demo-development-plan.md`。

## 1. 事实源与稳定身份

- 当前游戏项目事实源为 `example/sanguo_zhangjiao/game.project.json`。
- 场景事实源为 `example/sanguo_zhangjiao/assets/scenes/S01.json`–`S14.json` 及合法 `SXX-CNN.json`。
- 世界布局唯一事实源为 `game.project.json -> worldMap.regions[].grid`；场景 JSON 不复制全局网格坐标。
- 场景对象唯一 canonical 结构为 `layers[].objects[]`。不得恢复顶层对象集合或按对象类型拆出的第二份 placement/effectZone 列表。
- 项目、场景对象、Trigger、SceneEvent、Tutorial、内容定义和资源都使用稳定 ID；数组下标、时间戳和显示名称不得作为业务身份。
- 当前唯一运行时组合根为 `DataDrivenPrologueScene`；场景推进只使用 `_scene_order.json` 登记的目标与 `teleportToChunk()/RegionCoordinator`。

## 2. 编辑器文档模型

```text
磁盘 JSON
  → CanonicalDocumentService / CanonicalDocumentModel
  → CanonicalEditorSession
  → 各领域薄编辑器与 SchemaFieldEditor
  → EditorSceneCommandService
  → 完整 candidate 校验
  → CanonicalTransactionClient
```

约定：

- 多个编辑域共享同一个 canonical document、undo/redo 和提交服务，不维护各自的可写副本。
- 表单修改以完整原对象为基底，只覆盖控件拥有的字段；unknown-but-allowed 字段、稳定 stepId、数组顺序和高精度坐标必须无损保留。
- 场景对象、Trigger、SceneEvent、Tutorial 和资源引用的只读索引可以缓存，但派生索引不得成为第二事实源。
- 编辑器缓存只服务会话恢复、缩略图和 UI 偏好；缓存缺少完整 `layers/imageAssets` 时必须使用磁盘候选。
- 普通 canonical load/import 不执行隐式旧格式迁移。需要迁移时必须由用户显式发起独立命令，并让结果经过同一完整校验与事务提交。

## 3. Canonical 提交边界

- `game.project.json` 与 `assets/scenes/*.json` 只能通过 Vite `POST /api/canonical-transaction` 写回。
- 普通 `/api/save-file` 只处理非 canonical 编辑器配置或资源文件，并拒绝项目与场景 canonical 路径。
- 提交 change set 前必须校验完整引用闭包；任何 parse/schema/reference/business-rule 错误都不得修改磁盘或缓存。
- 服务端在仓库锁内使用 temp、备份和 journal；磁盘 commit point 前失败恢复原文件，commit point 后才允许同步编辑器缓存。
- 缓存同步失败不得反向覆盖已经成功提交的磁盘事实，应向编辑器明确报告降级状态。

## 4. 世界地图与局部坐标

- A–D Region 共用全局 20×20 `(row,col)`；`reserved:true` 单元仅供规划显示，禁止加载、传送和恢复。
- 场景 JSON 只保存 chunk 局部坐标。运行时通过 `SceneObjectProjector` 一次性应用 `worldOffset = (col × 1280, row × 720)`。
- 原始局部对象只读；碰撞、表现、交互、placement 与资源预载都消费同一次投影结果。
- `sortY`、polygon points 与对象 `x/y` 同属空间数据，必须在同一次投影中处理，禁止后置补偏移。
- 编辑器坐标不得与运行时世界坐标直接比较；校验先比磁盘 local 与 `_localX/_localY`，再比 world 与 `local + chunk.origin`。

## 5. 运行时加载链

```text
FetchDiskSceneAdapter
  → CanonicalSceneRepository
  → WorldMapLoadSession
  → core WorldStreamingManager
  → LoadedChunk.prepareSceneData/commitSceneData
  → SceneStreamingRuntime
  → SceneObjectProjector
  → SceneTerrainBinding + ScenePlacementRuntime
```

约定：

- 正式运行只注入 `FetchDiskSceneAdapter`。磁盘不可读、JSON 解析失败或 canonical 结构无效时直接失败，不读取编辑器缓存。
- `WorldMapLoadSession` 只预载入口/目标；相邻 chunk 由 core manager 的 `sceneResolver` 按需读取磁盘。
- `Scene1Terrain` 只消费流式 prepare 注入的有效 `sceneData.layers`；它不读取文件或缓存，也不自行追加 worldOffset。
- `SceneTerrainBinding` 只绑定已投影 terrain、effectZone、碰撞和小地图引用，不创建 terrain。
- `ScenePlacementRuntime` 是 placement 生成、live inspection、pending 状态、重建和恢复的唯一权威；Demo 不得扫描多个实体数组建立补偿入口。

## 6. 编辑器场景热同步

- 开发服务器仅在 canonical 磁盘 commit 成功后发送 `yijian18:canonical-scene-commit`。
- payload 必须同时匹配 `gameId/projectPath/sceneId/revision`；运行时不监听 storage 事件或无 provenance 的通知。
- 每个 sceneId 使用 generation + AbortController latest-wins。过期请求只能释放自己的 detached 资源。
- 提交流程固定为：读取磁盘 local 数据 → detached terrain/资源准备 → session replace → chunk/terrain projection commit → placement draft rebuild → local/world/live 校验 → placement finalize → 旧 terrain best-effort 释放。
- placement finalize 之前失败，按 placement → terrain/projection → session 逆序回滚。旧 terrain 释放属于提交后清理，不得在 placement 提交之前 finalize terrain。
- terrain 热替换使用 `SceneStreamingRuntime.prepareLoadedSceneData()`；不存在第二个完整替换包装入口。
- 成功或回滚后显式重建一次小地图静态缓存；普通 HUD update 和 streaming refresh 不隐式重画。

## 7. Placement 状态与防复活

- `PlacementSpawner.spawnMatching()` 为每个匹配项返回一个结构化 outcome：`spawned/alreadySpawned/conditionFalse/nonRef/unsupportedKind/failed`。
- `spawnedPlacementIds` 只是幂等账本，不代表 live 对象仍存在。必须通过 `ScenePlacementRuntime.inspectPlacement()` 检查 live、实际坐标、预期坐标和 tombstone。
- 动态 placement 状态必须携带当前定义的 `placementSignature`；存档或流式 provider 缺失签名时返回 `missingPlacementSignature`。
- 只有已有字符串签名、terminal 状态且定义变化仅限局部坐标时，removed/corpse 才能续签并阻止复活。
- ref、overrides、spawnWhen 等语义变化不得沿用旧 terminal 状态；旧动态世界坐标也不得覆盖新 canonical placement 坐标。
- 原子 rebuild 在草稿完整且坐标验证通过前保留旧对象；失败恢复 pending state、AI 注册和 spawned ledger。

## 8. 资源与表现边界

- 非 slice 图片使用稳定 `assetId === imageId`；slice 使用稳定源图片/图集 ID 加裁剪信息。
- 场景 JSON 只引用稳定 ID，不硬编码运行文件路径作为业务身份。
- 编辑器可从局部 `imageAssets` 与 Manifest 提供预览；正式运行优先通过同一 `AssetManager` 解析 Manifest。
- 图片、billboard、模型、缓存 Canvas 与渲染后端只属表现层，不写入 StoryState、战果、库存或存档业务事实。
- 3D 使用与 2D 相同坐标与稳定 ID；`x → three.x`、`y → three.z`、`elevation → three.y`。

## 9. 修改纪律

- 通用编辑器、事务、投影与运行机制进入 `editor/` 或 `src/`；S01–S14 历史内容留在 Demo。
- 新增保存入口前先证明现有 canonical session/command/transaction 无法复用，禁止增加旁路。
- 新增运行时场景读取入口前先复用 `WorldMapLoadSession`，禁止建立第二 repository 或第二 loaded-state 权威。
- 静态 diagnostics 不能替代浏览器实玩、音画验收或 Release Candidate 证据。
