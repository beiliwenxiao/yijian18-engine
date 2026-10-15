# 双后端渲染架构（2D/3D）与世界高度/分层系统 · 需求文档

## 1. 引言

本文件从 `design.md` 反推，梳理"双后端渲染架构 + 世界高度/分层"特性的业务需求与验收标准。面向的用户角色：

- **玩家（Player）**：使用不同设备和浏览器进入游戏
- **关卡/剧情设计师（LevelDesigner）**：设计多层地图、跳跃/飞行玩法
- **引擎/系统开发者（EngineDev）**：维护渲染底层
- **游戏功能开发者（GameplayDev）**：编写业务系统（战斗、技能、AI 等），不关心渲染细节
- **测试工程师（QA）**：保证迁移不引入回归

需求采用 EARS（Easy Approach to Requirements Syntax）表达验收标准。

## 2. 范围与边界

**纳入范围**：
- 渲染后端抽象层与 2D/3D 两套实现
- `TransformComponent` 三维化及兼容访问器
- 世界子层（WorldSublayer）、地图楼层（MapFloor）、屏幕层（ScreenLayer）三类分层
- 后端切换机制（URL 参数 / 配置 / 自动降级）
- 现有 2D 功能（含 `FlightSystem`）迁移到新的 elevation 模型
- HUD overlay 的双后端适配

**不在范围**：
- glTF 资产制作与骨骼动画对接
- 物理引擎引入
- 网络层对楼层 `floorId` 的同步（留待后续）
- 大世界无缝场景
- 高级光照与阴影

## 3. 术语

| 术语 | 含义 |
|---|---|
| 后端（Backend） | 实现 `IRenderBackend` 的具体渲染器（Canvas2D 或 three.js） |
| 子层（WorldSublayer） | 世界内渲染顺序分组：ground / decal / entity / aerial / effect |
| 楼层（MapFloor） | 地图多层结构，带 `elevation` 与 `collision` |
| 高度（elevation） | 实体离地面的真实高度，对应 `transform.position.y` |
| 地面深度（ground depth） | 实体在地面平面的前后位置，对应 `transform.position.z` |
| 兼容期（Phase A） | 同时暴露 `position.y`（旧=地面深度）与 `position.z`（新=地面深度）的过渡期 |
| HUD overlay | 叠加在主渲染 canvas 上层的 2D canvas，用于 UI |


## 4. 用户故事与验收标准

### US-1 运行时选择渲染后端

**作为**玩家，**我希望**游戏能自动根据我的浏览器能力选择合适的渲染模式，**以便**在低端设备或不支持 WebGL 的环境下仍能流畅游玩。

**验收标准**：
- WHEN 用户以 `?mode=2d` 进入游戏 THE SYSTEM SHALL 使用 Canvas 2D 后端启动。
- WHEN 用户以 `?mode=3d` 进入游戏 AND 浏览器支持 WebGL THE SYSTEM SHALL 使用 three.js 后端启动。
- WHEN 用户以 `?mode=3d` 进入游戏 AND 浏览器不支持 WebGL THE SYSTEM SHALL 显示警告并自动降级为 Canvas 2D 后端，不阻塞游戏启动。
- WHEN 用户以 `?mode=auto` 或未提供 mode 参数进入游戏 THE SYSTEM SHALL 优先尝试 three.js 后端，失败时自动降级到 Canvas 2D。
- WHERE 当前后端初始化失败 THE SYSTEM SHALL 记录错误日志并切换到可用的兜底后端，不抛出未捕获异常。
- IF 用户中途刷新页面并携带新的 mode 参数 THEN THE SYSTEM SHALL 使用新参数重新选择后端（不要求热切换）。

### US-2 业务层与渲染后端解耦

**作为**游戏功能开发者，**我希望**编写业务系统时不需要知道当前运行的是 2D 还是 3D 后端，**以便**专注业务逻辑。

**验收标准**：
- WHEN 开发者在 `src/systems/**` 或 `src/prologue/**` 新增业务系统 THE SYSTEM SHALL 不要求 `import` `three` 或 `CanvasRenderingContext2D`。
- WHEN 业务系统需要进行屏幕/世界坐标转换 THE SYSTEM SHALL 提供统一的 `backend.camera.worldToScreen / screenToWorld` 接口，实现对后端透明。
- WHEN 业务系统需要做屏幕拾取 THE SYSTEM SHALL 提供 `backend.picker.pickGround / pickEntity` 接口，2D/3D 返回结构一致。
- WHERE 业务系统触发特效（如 `skillEffects.createSkillEffect`）THE SYSTEM SHALL 保持现有调用签名不变。
- IF 业务系统需访问 2D 专用 API（如 `ctx.fillText`）THEN THE SYSTEM SHALL 通过 `backend.getHUDContext()` 获取 overlay 2D 上下文，而不是直接操作主 canvas。

### US-3 Transform 三维化且兼容现有代码

**作为**引擎开发者，**我希望** `TransformComponent` 支持三维坐标并兼容现有 `position.y` 用法，**以便**分阶段迁移而无需一次性改写所有调用点。

**验收标准**：
- WHEN 代码访问 `transform.position.y` AND 阶段 A 兼容期激活 THE SYSTEM SHALL 返回地面深度（与旧语义一致）。
- WHEN 代码访问 `transform.position.z` THE SYSTEM SHALL 返回地面深度（与 `position.y` 等价）。
- WHEN 代码访问 `transform.position` 的高度信息 THE SYSTEM SHALL 通过 `position.elevation` 或独立字段返回，而非 `position.y`。
- WHEN 现有代码执行 `setPosition(x, y)` THE SYSTEM SHALL 同时更新 `position.y` 与 `position.z`，保持两者同步。
- WHERE 3D 后端需要真三维坐标 THE SYSTEM SHALL 通过适配层读取 `{ x, elevation, z }` 并映射到 three.js `{x, y, z}`。
- IF `TransformComponent` 构造参数仅有两维 THEN THE SYSTEM SHALL 默认 `elevation = 0`。

### US-4 2D 后端行为向前兼容

**作为**测试工程师，**我希望**以 2D 后端启动时所有现有功能与视觉表现与改造前一致，**以便**保证迁移无回归。

**验收标准**：
- WHEN 以 `mode=2d` 运行所有现有 `*.test.js` THE SYSTEM SHALL 全部通过。
- WHEN 玩家在 `GameScene` 使用键盘/鼠标移动、攻击、拾取、对话 THE SYSTEM SHALL 与改造前行为一致。
- WHEN `FlightSystem` 触发飞行 AND 当前 2D 后端 THE SYSTEM SHALL 显示与改造前视觉一致的弧线抬升效果。
- WHEN 等距投影启用 THE SYSTEM SHALL 保持 `isometricRatio = 0.5` 默认表现。
- WHERE 背景缓存、视锥剔除、Y-sort 等性能优化存在 THE SYSTEM SHALL 保留这些优化策略。

### US-5 3D 后端可渲染基本场景

**作为**玩家，**我希望**在支持 WebGL 的浏览器下能以 3D 模式进入游戏并完成基础玩法，**以便**体验更丰富的视觉。

**验收标准**：
- WHEN 以 `mode=3d` 进入 `GameScene` THE SYSTEM SHALL 使用 `THREE.OrthographicCamera`（默认）渲染地面、玩家、敌人、粒子、特效。
- WHEN 玩家进行键盘或点击移动 THE SYSTEM SHALL 正确更新 3D 场景中玩家对象的 `{x, y, z}` 并保持相机跟随。
- WHEN 玩家点击敌人 THE SYSTEM SHALL 通过 `Raycaster` 正确识别点击的实体并触发 `CombatSystem` 既有逻辑。
- WHEN 玩家释放技能 THE SYSTEM SHALL 在 3D 场景中显示技能特效与粒子效果。
- WHERE 实体仅有 `SpriteComponent` THE SYSTEM SHALL 以 billboard 精灵方式渲染，并使用现有 8 方向动画。
- WHERE 实体同时具有 `Model3DComponent` THE SYSTEM SHALL 优先加载 glTF 模型，失败时降级为 sprite billboard。

### US-6 世界子层正确排序

**作为**关卡设计师，**我希望**地面、装饰、角色、飞行物、特效按固定顺序渲染，**以便**避免穿插错误。

**验收标准**：
- WHEN 实体挂载 `LayerComponent(worldLayer='ground')` THE SYSTEM SHALL 在最底层绘制且不参与 Y-sort。
- WHEN 实体挂载 `LayerComponent(worldLayer='entity')`（或未挂载 LayerComponent）THE SYSTEM SHALL 按 `position.z` Y-sort 排序绘制。
- WHEN 实体挂载 `LayerComponent(worldLayer='aerial')` THE SYSTEM SHALL 在所有 entity 之上绘制。
- WHEN 实体挂载 `LayerComponent(worldLayer='effect')` THE SYSTEM SHALL 在 aerial 之上绘制，并允许自定义混合模式。
- WHEN 同层内多个实体共享相同 `worldLayer` THE SYSTEM SHALL 再按 `renderOrder`（若指定）细排，未指定时按 `position.z` 排序。
- WHERE 3D 后端生效 THE SYSTEM SHALL 将 `worldLayer` 映射为 `Object3D.renderOrder`，保证视觉顺序一致。

### US-7 FlightSystem 使用真实 elevation

**作为**游戏功能开发者，**我希望**飞行、跳跃、抛物线等视觉抬升由 `transform.position.elevation` 驱动，而非临时改 `sprite.offsetY`，**以便**在 2D/3D 下统一表现。

**验收标准**：
- WHEN `FlightSystem.updateFlyPhase` 运行 THE SYSTEM SHALL 通过修改 `transform.position.elevation` 实现弧线抬升，不再修改 `sprite.offsetY`。
- WHEN 2D 后端渲染具有 `elevation > 0` 的实体 THE SYSTEM SHALL 把实体的屏幕 Y 上移 `elevation * kIso`。
- WHEN 3D 后端渲染具有 `elevation > 0` 的实体 THE SYSTEM SHALL 将 `mesh.position.y = elevation`。
- WHEN 飞行开始 THE SYSTEM SHALL 临时把玩家 `worldLayer` 切为 `aerial`，飞行结束恢复为 `entity`。
- WHERE 其他具有视觉高度需求的功能（跳跃、击飞、投掷武器抛物线）THE SYSTEM SHALL 使用相同的 `elevation` 机制。
- IF `elevation` 为负 THEN THE SYSTEM SHALL 允许其表示坑洞或水下（2D 后端在屏幕上向下偏移）。


### US-8 多层地图与楼层切换

**作为**关卡设计师，**我希望**同一张地图能定义多个楼层（1F/2F/地下）并通过 portal 连接，**以便**制作立体场景。

**验收标准**：
- WHEN 地图数据包含 `floors: [...]` 多层定义 THE SYSTEM SHALL 按 `defaultFloor` 初始化玩家 `transform.floorId`。
- WHEN 实体进入 portal 触发区域 AND portal.trigger === 'touch' THE SYSTEM SHALL 自动切换该实体的 `floorId` 并更新位置。
- WHEN 实体进入 portal 触发区域 AND portal.trigger === 'interact' THE SYSTEM SHALL 等待交互键按下后再切换。
- WHEN 楼层切换完成 THE SYSTEM SHALL 派发 `floorChanged` 事件供 UI、音频订阅。
- WHEN 进行碰撞检测 THE SYSTEM SHALL 使用实体当前 `floorId` 对应的 `collision` 数组，而非全局单层数组。
- WHERE 2D 后端生效 THE SYSTEM SHALL 默认只绘制玩家所在楼层的实体与地面。
- WHERE 3D 后端生效 THE SYSTEM SHALL 按楼层创建独立 `THREE.Group(position.y=elevation)`，非当前层可按配置半透明显示。
- IF 地图只定义单层 THEN THE SYSTEM SHALL 行为与当前完全一致（向后兼容）。

### US-9 HUD/UI 跨后端一致

**作为**玩家，**我希望**UI 面板、血条、悬浮文字、小地图在 2D/3D 模式下外观和交互完全一致，**以便**视觉切换不干扰操作。

**验收标准**：
- WHEN 3D 后端启动 THE SYSTEM SHALL 创建独立的 overlay canvas 叠加在 WebGL canvas 上层，CSS 设置 `pointer-events: none`（除需要交互的 HUD 外）。
- WHEN 2D 后端启动 THE SYSTEM SHALL 使 HUD 使用主 canvas（或复用 overlay，二选一由配置决定）。
- WHEN `UISystem.render` 被调用 THE SYSTEM SHALL 渲染到 `backend.getHUDContext()` 返回的 2D 上下文。
- WHEN 现有 DOM 面板（AttributePanel、InventoryPanel、ShopPanel 等）显示 THE SYSTEM SHALL 不依赖后端类型，行为一致。
- WHERE HUD 需要世界→屏幕坐标（如头顶血条、FloatingText）THE SYSTEM SHALL 调用 `backend.camera.worldToScreen` 获取屏幕位置。
- IF 窗口缩放 THEN THE SYSTEM SHALL 同步调整主 canvas 与 overlay canvas 的尺寸。

### US-10 资源管理支持多后端资产

**作为**引擎开发者，**我希望**同一份资产 ID 可以挂不同后端的实际资源（PNG vs glTF），**以便**3D 升级渐进进行。

**验收标准**：
- WHEN 资源注册为 `{ type: 'image', url, backends: ['2d','3d'] }` THE SYSTEM SHALL 在 2D/3D 下都返回 Image。
- WHEN 资源注册为 `{ type: 'gltf', url, backends: ['3d'] }` THE SYSTEM SHALL 仅在 3D 后端下提供 glTF，2D 后端请求时返回 `null` 或降级资源。
- WHEN 同一 name 同时注册了 2D 和 3D 两份资源 THE SYSTEM SHALL 按当前后端 mode 自动选择。
- WHEN 请求未注册资源 THE SYSTEM SHALL 返回 `null` 并记录 warning，不抛异常。
- WHERE 资源加载失败 THE SYSTEM SHALL 不阻塞其他资源加载，记录错误后继续。

### US-11 性能预算与降级

**作为**玩家，**我希望**3D 模式下常规场景仍能稳定 60FPS，**以便**获得流畅体验。

**验收标准**：
- WHEN 3D 后端运行一个典型战斗场景（约 200 可见实体、约 500 活跃粒子）AND 设备为中端 PC THE SYSTEM SHALL 平均帧率 ≥ 55FPS。
- WHEN 实际帧率低于 30FPS 持续 5 秒 THE SYSTEM SHALL 在控制台输出性能警告，并允许通过 `?mode=2d` 重启降级。
- WHEN 离屏实体超出相机视锥 THE SYSTEM SHALL 跳过渲染（视锥剔除由 three.js 内置或手动完成）。
- WHERE 粒子数量超过预算 THE SYSTEM SHALL 使用批量绘制（`THREE.Points` / InstancedMesh）减少 draw call。
- IF 设备检测到低性能标志（如 `navigator.deviceMemory < 4` 或明确低端 GPU）THEN THE SYSTEM SHALL 默认选择 2D 后端。

### US-12 测试与回归保护

**作为**测试工程师，**我希望**关键组件有单元测试并覆盖双后端的关键分支，**以便**防止未来修改引入回归。

**验收标准**：
- WHEN 执行 `npm test` THE SYSTEM SHALL 包含以下新增测试：
  - `TransformComponent` 三维 + 兼容 getter 的行为
  - `Canvas2DBackend` 分桶排序、elevation 投影
  - `ICameraAdapter.worldToScreen / screenToWorld` 双后端一致性（容差内）
  - `MovementSystem` 多 floor 的碰撞查询与 portal 触发
- WHEN `ThreeBackend` 在无 WebGL 环境（如 jsdom）初始化 THE SYSTEM SHALL 优雅失败并允许测试 mock 替换。
- WHERE 现有 `*.test.js` 存在 THE SYSTEM SHALL 在阶段 A 完成后全部继续通过。
- IF 测试需要 three.js mock THEN THE SYSTEM SHALL 提供最小可用的 mock 工具或使用依赖注入替换。

### US-13 配置化与可调参数

**作为**引擎开发者，**我希望**渲染相关参数可通过配置调整而无需改代码，**以便**快速验证不同视觉方案。

**验收标准**：
- WHEN 构造 `BackendConfig` THE SYSTEM SHALL 支持：
  - `mode: '2d' | '3d' | 'auto'`
  - `three.camera: 'ortho' | 'perspective'`
  - `three.pitchDeg` / `three.yawDeg`
  - `layers.order` / `layers.crossFloorAlpha`
- WHEN 未提供某项配置 THE SYSTEM SHALL 使用 design.md 中约定的默认值。
- WHEN 配置冲突（如 `mode=3d` 但环境不支持）THE SYSTEM SHALL 按降级链处理，不抛错。
- WHERE URL 参数与代码配置同时存在 THE SYSTEM SHALL 以 URL 参数优先。


## 5. 非功能需求（NFR）

| 编号 | 类别 | 描述 | 验收 |
|---|---|---|---|
| NFR-1 | 兼容性 | 现有所有 `*.test.js` 必须在迁移后继续全绿 | `npm test` 退出码 0 |
| NFR-2 | 性能（2D） | 迁移后 2D 后端帧率与当前持平（偏差 ≤ 5%） | 对比测试脚本 |
| NFR-3 | 性能（3D） | 200 实体 + 500 粒子 @ 中端 PC ≥ 55 FPS | 手动基准测试 |
| NFR-4 | 浏览器 | 支持 Chrome / Edge 最新两个版本，Firefox 最新版 | 手动抽查 |
| NFR-5 | 代码风格 | 遵循 `.kiro/steering/custom.md`：ES6+、PascalCase 类名、ECS 架构 | Code Review |
| NFR-6 | 可观测性 | 后端初始化、切换、降级在 `Logger` 中有明确日志 | 日志目视 |
| NFR-7 | 模块化 | 渲染后端位于独立目录（如 `src/rendering/backends/`），其他模块不直接依赖 `three` | 依赖扫描 |
| NFR-8 | 文档 | 每个新增核心模块至少有 JSDoc 顶部说明 | Code Review |
| NFR-9 | 测试覆盖 | 关键新增模块（Backend / Adapter / LayerComponent / Floor 相关）单测覆盖率 ≥ 80% | 覆盖率报告 |
| NFR-10 | 包体 | 引入 three.js 之后生产构建 gzip 增量 ≤ 200KB（可按需懒加载 3D 后端） | 构建产物分析 |

## 6. 约束与假设

- **约束 C1**：项目遵循 ECS 架构，新增组件必须继承 `Component` 基类。
- **约束 C2**：不引入新的包管理机制，仅使用 `npm`；three.js 通过 `npm install three` 接入。
- **约束 C3**：不要求一次性删除 `SpriteComponent.offsetY`、`position.y` 旧语义（留待阶段 B）。
- **约束 C4**：HUD overlay 与主 canvas 不能同时响应同一次鼠标点击，必须由统一的点击分发机制处理。
- **约束 C5**：多层地图的网络同步暂不在本 spec 范围，本地 `floorId` 变更不触发网络广播。
- **假设 A1**：主要用户使用 Chromium 系浏览器，具备 WebGL2。
- **假设 A2**：现有美术资源以 PNG 精灵为主，短期内不会替换为 glTF。
- **假设 A3**：`GameEngine` 当前仅绑定单一 `canvas`，本 spec 保留该假设；HUD overlay 通过 DOM 自动创建。

## 7. 依赖与前置条件

- 现有 ECS 基础设施（`Entity`、`Component`、`TransformComponent`、`SpriteComponent`）
- 现有 `GameEngine` 的游戏循环与 `SceneManager`
- 现有 `RenderSystem`、`Camera`、`SpriteRenderer`、`ParticleSystem` 将被包装复用
- 需要新增依赖：`three`（通过 npm 安装）
- 需要遵守 `.kiro/steering/custom.md` 中的团队规范

## 8. 交付物清单

### 8.1 代码
- `src/rendering/backends/IRenderBackend.js`（接口约定与文档）
- `src/rendering/backends/Canvas2DBackend.js`
- `src/rendering/backends/ThreeBackend.js`
- `src/rendering/backends/Camera2DAdapter.js` / `Camera3DAdapter.js`
- `src/rendering/backends/Picker2D.js` / `Picker3D.js`
- `src/rendering/backends/ParticleRenderer2D.js` / `ParticleRenderer3D.js`
- `src/ecs/components/LayerComponent.js`
- `src/ecs/components/Model3DComponent.js`（占位，允许阶段 B 完整实现）
- `TransformComponent` 扩展（新增 elevation / z / 兼容 getter）
- `FlightSystem` 改造为 elevation 驱动
- `MapData` / `MovementSystem` 扩展（`floors`、`floorId`、portal）
- `GameEngine` / `Scene` 签名改造为 `render(backend)`

### 8.2 测试
- 新增单元测试按 NFR-9 要求
- 现有测试保持全绿

### 8.3 文档
- 按 custom.md 要求，涉及模块补充 README.md / JSDoc
- 不主动追加总结性文档（custom.md 约定）

## 9. 里程碑（供 tasks 阶段细化）

1. **M1 基础设施**：接口定义 + Canvas2DBackend 包装（不改视觉，跑通 2D 路径）
2. **M2 Transform 三维化**：兼容 getter + 阶段 A 迁移，回归测试全绿
3. **M3 分层与楼层**：`LayerComponent` + `MapData.floors` + `MovementSystem` 扩展
4. **M4 FlightSystem 迁移**：elevation 驱动化，视觉回归
5. **M5 three.js 后端骨架**：场景、相机、billboard 精灵、粒子
6. **M6 3D 玩法闭环**：拾取、特效、楼层遮挡、HUD overlay
7. **M7 测试与性能**：单测补齐、基准测试、降级链验证

## 10. 不做的事（明确列出防误解）

- 不创建测试页面（除非用户明确同意，遵守 custom.md）
- 不主动写新的 `.md` 总结（遵守 custom.md）
- 不修改网络协议或服务端接口
- 不删除或重命名现有公开 API（阶段 A 仅新增）
- 不强制要求业务开发者理解 three.js
