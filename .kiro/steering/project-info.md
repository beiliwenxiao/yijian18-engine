# 项目当前事实索引

> 截至 2026-08-14。本文件只记录当前代码与配置事实；阶段完成度以 `yijian18-game-demo-development-plan.md` 为准。`playable`、代码接线或 diagnostics 通过不等于浏览器实玩、音画验收或 Release Candidate 已完成。

## 1. 项目与交付物

- **引擎**：YiJian18-Engine，跨平台 2D/3D ECS 游戏引擎。
- **根 npm 包**：`yijian18-engine@0.0.3`，ES Module，MIT。
- **当前唯一 Demo**：`example/sanguo_zhangjiao/`，作品名固定为 **《三国张角传》**。
- **Demo 配置版本**：`game.project.json` 为 `schemaVersion: 1`、`meta.version: 3`、`meta.schema: 3`、campaign `sanguo-zhangjiao-s01-s14`；它与 npm 包版本不是同一版本层。
- **作者**：刘枭（beiliwenxiao），邮箱 `beiliwenxiao@qq.com`。
- **仓库**：<https://github.com/beiliwenxiao/yijian18-engine>、<https://gitee.com/coderaaa/yijian18-engine>。
- 当前 Demo 是单机交付物；引擎仍保留网络模块，但战役外部服务目前只有同契约 `LocalMockTransport`，不包含 Go server/slg 仓库。

## 2. 技术栈

- JavaScript ES6+、ES Module。
- Vite `^5.0.0`；Vitest `^3.2.4`；jsdom `^26.1.0`。
- Canvas 2D 正式发布主表现；three.js `^0.184.0` 提供 3D 后端。
- Capacitor `^6.2.1`：`@capacitor/core`、`@capacitor/android`、`@capacitor/cli`。
- HTML5 Canvas、Web Audio、键鼠/触屏/Xbox 360 风格手柄输入。

## 3. 当前目录职责

```text
src/
├── core/                 # 引擎、资源、场景、流式、输入、快照、校验
│   ├── input/            # InputActionRouter、InputHints、设备档案
│   ├── scene/            # Runtime、生命周期、输入/渲染管线、Chunk/Region
│   ├── snapshot/         # SnapshotManager、SaveGameService、存储适配器
│   └── validation/       # ContentValidator 与配置校验
├── data/schema/          # Canonical Schema
├── ecs/                  # Entity、Component、EntityFactory 与组件
├── systems/              # 通用领域系统
│   ├── ability/          # 技能定义与执行准入
│   ├── effects/          # EffectResolver
│   ├── progression/      # 统一成长图、点数、熟练度
│   └── resolvers/        # 战斗、掉落、任务解析
├── integration/          # BattleClient、JSON-RPC、LocalMock、幂等存储
├── rendering/backends/   # Canvas2D / three.js 双后端
├── ui/                   # HUD、面板、战役/救援/结局/成长 View
├── network/              # WebSocket 与网络兼容模块
└── scenes/               # 引擎通用场景

example/sanguo_zhangjiao/
├── game.project.json     # Demo 项目、世界图、Story/City/War 初始事实
├── assets/scenes/        # canonical S01-S14 / SXX-CNN 场景 JSON
├── assets/manifests/     # 稳定 assetId/imageId 与双后端映射
├── config/               # 成长、技能、结局、表现等配置
├── data/                 # 内容数据
├── entities/             # Demo 实体装配
├── scenes/               # DataDrivenPrologueScene 与 Demo 场景组合
└── systems/              # 仅历史剧情与场景编排适配器

editor/                   # 场景、世界地图、对话、UI 等编辑器
android/                  # Android 发布权威工程
```

`desktop/`、Demo 内 legacy `mobile/`、`example/sanguo_zhangjiao_3d/` 不参与当前功能修改。

## 4. 架构与状态边界

- 基础架构仍是 ECS：Entity 是稳定标识，Component 持有数据，System 持有逻辑。
- 定义、角色运行状态、领域事务、UI/表现必须分离；历史人物、S01-S14 剧情和数值留在 Demo，通用机制进入 `src/`。
- 状态修改统一遵循：`validate → prepare draft → commit → emit → checkpoint`。失败必须零修改；持久事务使用稳定 `operationId` 幂等，同 ID 不同载荷必须拒绝。
- 资源、图片和渲染后端只属于表现层，不得成为 StoryState、BattleResult、库存或存档的业务事实源。
- 复杂场景由 `SceneSystemContainer`、`GameSceneRuntime`、`SceneGameplaySystemAssembler`、显式输入/帧/渲染管线和 `SceneEntityStore` 等模块装配；`BaseGameScene` 仍在继续向薄组合根收口。

### 主要已接入能力

- `EffectResolver`、`AbilitySystem`、`ProgressionGraphSystem` 与旧 Skill/Talent 适配层。
- `InputActionRouter`、`InputHints`、设备无关交互与模态输入优先级。
- `SnapshotManager`、`SaveGameService`、ContentValidator、Canonical Schema。
- 原子库存、采集、工具、死亡/DeathDrop、营建/维修、载具/Cargo/席位。
- BattleClient/LocalMock、BattleSystem、BattlefieldRuntimeSystem、CityWarSystem、RescueSystem。
- 职业、四成长图、熟练度、跳跃/用力跳/轻功/攀爬。
- S13 原子结算、S14 资源分歧、EndingSystem 与六结局演出。

## 5. 《三国张角传》Canonical 内容

- 运行时唯一场景 ID 为 `S01`–`S14`；大型战场附属 chunk 使用 `SXX-CNN`，并归入对应 SXX 业务状态命名空间。
- 默认入口和微信入口只注册 `DataDrivenPrologueScene`。
- 旧 `s0-*`、旧 Act 类/alias、旧六幕 campaign、旧 ending 变量和旧 `mage` 职业均已退出当前内容事实，不作为兼容目标。
- 第三职业固定为 `strategist`，显示名“军师”。
- 六结局固定优先级：焦土 → 旁观者 → 火种 → 余烬 → 流星 → 尘埃。
- `S01`–`S14` 已登记为 canonical 可加载单元；S11-S14 为 `productionState: "playable"`、`previewOnly: false`，但仍需浏览器通玩和音画验收。

### 全局 20×20 世界坐标

| Region | 场景坐标 `(row,col)` |
|---|---|
| A 干旱平原 | S01 `(1,1)`、S02 `(3,3)` |
| B 冀州 | S09 `(6,12)`、S10 `(6,13)`、S11 `(7,14)`、S12 `(8,15)` |
| C 豫州 | S03 `(15,12)`、S04 `(15,13)`、S05 `(16,13)`、S06 `(16,14)`、S07 `(17,15)`、S08 `(17,16)` |
| D 终局 | S13 `(18,11)`、S14 `(18,12)` |

世界布局唯一事实源是 `game.project.json -> worldMap.regions[].grid`。场景 JSON 只保存 chunk 局部坐标；`worldOffset = (col × 1280, row × 720)` 由运行时派生且只能应用一次。`reserved: true` 单元只保留规划位置，不允许加载、传送或恢复。

## 6. 世界流式与场景事实源

- `src/core/WorldStreamingManager.js` 是 Region 九宫格流式加载唯一状态权威，拥有 `loaded/savedStates`、generation + AbortController latest-wins、并行 prepare、完整校验、一次 commit 和逆序 rollback。
- `src/systems/WorldStreamingManager.js` 仅为无状态兼容转发，不得持有第二份 loaded/saved 状态。
- `WorldMapLoadSession` 只预载入口/目标场景；相邻块由 core manager 的 `sceneResolver` 按需读取磁盘 JSON。
- `RegionCoordinator` 使用 detached/shadow session 准备目标 Region；准备失败时旧 Region、玩家位置、Story 和 runtime 应保持不变。
- 磁盘 canonical 场景 JSON 是运行与编辑器缩略图的事实源；localStorage 仅作 fallback/cache，缺少 `layers/imageAssets` 时必须回退磁盘。
- dynamic provider 保存资源节点、placement、DeathDrop、S10 工事和按 `sceneNamespace` 分区的 Vehicle/Cargo 运行态；载具物流 operation ledger 是全局单份快照，不随旧 chunk 重复覆盖。physical chunk ID 用于生成实体，SXX namespace 只用于业务状态聚合。

## 7. 存档约定

- Snapshot 恢复分两段：先 migrate/validate 全部 provider；再 capture 回滚快照并依次 restore。任一 provider 失败都必须把当前失败 provider 纳入逆序回滚。
- `BaseGameScene.restoreSaveState()` 直接调用也必须自身原子，不能只依赖 SnapshotManager 外层保护。
- 损坏 JSON 返回 `invalidJson` 并原样保留；缺少迁移器返回 `missingMigration`。
- 当前产品策略：旧 schema、旧 chunk、旧 Act、旧职业存档直接拒绝并提示新游戏，不迁移，也不删除用户存档。
- 自动位固定为 `autosave-1..3`，手动位最多 `slot-1..100`，两类槽位不得互相覆盖。
- 跨 Region 读档先用 `inspect/inspectAuto` 只读校验并准备目标 Region，再同步原子恢复。
- Vite 开发环境成功快照镜像到 `example/sanguo_zhangjiao/saves/<slot>/snapshot.json`，缩略图独立保存为 `thumbnail.jpg`；localStorage 仍是同步运行缓存。

## 8. 双渲染后端与资源

- URL 请求模式：`?mode=2d`、`?mode=3d`、`?mode=auto`；2D 是默认正式表现。
- `BackendConfig.mode` / `GameEngine.requestedBackendMode` 仅表示请求模式；WebGL、宿主或动态导入失败可降级，唯一实际模式读取 `GameEngine.actualBackendMode`。
- BackendConfig 固定解析时的 `host`，后端选择不得二次读取可变全局宿主。
- requested/actual 只用于表现和诊断，禁止写入 StoryState、战果或存档。
- 3D 当前优先使用与 2D 相同稳定 ID 的 billboard/sprite；坐标映射为 2D `x → three.x`、2D `y → three.z`、`elevation → three.y`。
- Manifest 稳定 ID 链为 `assetId === imageId`；世界物件默认脚底中心 pivot `{x:0.5,y:1}`。缺图先复用，确实缺失时生成 SVG、登记 Manifest，再接内容。
- DeathDrop 使用稳定 ID `world.loot.deathDrop`；Vehicle/Cargo/DeathDrop 快照只保存业务状态，恢复时由场景重新注入表现。

## 9. 输入与 UI

- 正式世界输入必须经过 `SceneInputFlow/InputActionRouter`，不得在 Demo 另建键鼠、触屏或手柄旁路。
- 路由优先级：模态 UI → 面板 UI → 瞄准 → Ctrl 轻功 → Shift 投掷 → 拾取 → 技能 → 攻击 → 右键移动。
- W/A/S/D 或方向键移动；E 为交互/拾取；B 为背包；C 打开角色信息/装备栏；数字键使用快捷技能。手柄 Y 进入 canonical `jump`；触屏按钮产生同一动作。
- 操作提示统一使用 `InputHints` token，禁止硬编码单平台按键。
- 在《三国张角传》中，“装备栏”专指 `PlayerInfoPanel`。
- 不存在 `N` 键“下一幕”的 canonical 流程；场景推进只允许 `_scene_order.json` 登记目标及 `teleportToChunk()/RegionCoordinator`。

## 10. 编辑器与资产审计

- 世界网格从当前游戏磁盘 `game.project.json` 加载；`builtin-games.json` 只登记游戏入口，不复制第二份世界事实。
- 场景编辑器 canonical 保存只通过 Vite `POST /api/canonical-transaction` 写回原磁盘 JSON；普通 `/api/save-file` 拒绝 `game.project.json` 与 `assets/scenes/*.json`。磁盘 commit point 成功后才同步 localStorage 缓存，提交前失败不得改缓存。
- 发布资产审计只扫描 `SXX.json` / `SXX-CNN.json`，排除旧 `s0-*`、模板和其他非 canonical JSON。
- 审计覆盖稳定 ID 重复、Manifest 文件断链、未登记图片、scene imageId/atlasId、slice、placeholder、3D fallback 和音频 cue 断链；只生成报告，不自动修复。
- 未被场景对象实际引用的 `imageAssets` 只作为清理提示，不算发布引用。
- 当前资源政策不逐项审计授权/作者/来源；只阻断稳定 ID、文件、状态、尺寸、pivot、动画和 2D/3D 映射问题。

## 11. Android 发布权威

- 根 `capacitor.config.json` 与根 `android/` 是唯一 Android 发布权威；Demo 内 legacy mobile 工程不参与发布。
- 当前配置：`appId/namespace/applicationId = com.sanguo.zhangjiao`、`appName = 三国张角传`、`webDir = dist/sanguo_zhangjiao`。
- 根 Android Manifest 通过 `android:screenOrientation="landscape"` 锁定原生横屏；Web `force-landscape` 只用于普通浏览器和非原生宿主 fallback。
- `versionCode 1` / `versionName "1.0"` 尚未建立用户确认的发布版本语义。
- Release signing 尚未配置；keystore、alias 和密码不得写入仓库或用 debug key 替代，只能通过本机 Gradle properties 或 CI secret 注入。

## 12. 开发与验证命令

```text
npm install
npm run dev
npx vite --config example/sanguo_zhangjiao/vite.config.js
npx vite build --config example/sanguo_zhangjiao/vite.config.js
npx vitest --run <目标测试文件>
```

根 `npm run build` 构建根入口，不等同于《三国张角传》Android Web 产物。Windows 开发终端统一使用 Windows PowerShell 5.1（`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`；已核验实际版本为 `5.1.19041.6456`），以避免 Git Bash 对 Windows npm 包装程序、嵌套引号及长 Node 命令的兼容问题；Node/Sharp 脚本应拆为单一用途的短命令执行。日常代码修改只运行 diagnostics；除非用户明确要求，不自动运行 Vitest、build、dev server 或 cap sync，也不创建功能验证 HTML。

## 13. 当前状态与明确阻断

- P0-P6 当前均为 `inProgress`；尚无完整 S01-S14 浏览器 playthrough 与音画验收证据。
- P4 的马/云梯 placement 与代码接线已完成：S11 战马复用统一输入路由和里程耗粮，S12 云梯复用幂等火毁事务并由载具状态派生入口可用性；S14 `CargoTransferView` 已通过 `VehicleLogisticsSystem.transfer()` 接入背包↔货舱双向原子转移，马车单一 DeathDrop 已完成代码接线；投石车已接入真实 gunner 席、三输入攻击 intent、稳定目标指纹、石料/人力扣除、伤害、弧线石弹与 checkpoint 失败回滚。上述载具仍待成功/资源或容量不足/checkpoint 回滚/幂等重放、乘降、目标死亡、卸载恢复和存读档实测。
- 流式加载仍需连续跨界、远距传送、失败保留旧区、动态对象卸载恢复、SXX-CNN 和两轮存读档实测。
- S11 性能门槛是至少 100 个活动 ECS 实体、平均 60 FPS，并检查 1% low、长任务和 draw calls；不是“100 个在线玩家已支持”。
- 同 Region 连续跨界内存目标 `<100MB` 尚未验收。
- 2D/3D 同 seed、同命令序列业务 diff=0 尚未验收。
- Manifest 最近静态审计无 placeholder/引用错误；正式音频 cue 当前为 0，是明确 RC 内容阻断。
- Android release signing、发布版本语义、真机构建/安装/通关尚未完成，因此不能标记为 Release Candidate。

## 14. 维护边界

- 复杂实现细节分别维护在现有 steering：成长/场景基础设施见 `progression-implementation.md`，流式优化见 `optimization-plan-b-plus.md`，地图编辑器见 `map-editor.md`，Android 见 `android-build.md`，交付状态见 `yijian18-game-demo-development-plan.md`。
- 本文件不再维护逐个类/文件的完整清单，避免新增模块后再次整体过期。
- 修改功能时不处理 `desktop/`；不创建新游戏目录；文档放 `docs/`，但除用户要求外不主动创建普通文档。
- 调试信息不得自动删除；如需删除必须先取得用户同意。