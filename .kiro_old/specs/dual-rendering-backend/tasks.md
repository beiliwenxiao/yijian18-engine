# 双后端渲染架构 · 实施任务清单

> 对应文档：`design.md` / `requirements.md`
> 约定：`[ ]` 未开始 · `[x]` 已完成 · `[-]` 进行中 · `[ ]*` 可选
> 除特别标记外，所有任务均为必需（Required）

## 里程碑 M1：基础设施（后端抽象 + 2D 包装）

目标：搭建渲染后端抽象层，把现有 Canvas2D 实现包装为 `Canvas2DBackend`，跑通 2D 路径，不改变任何视觉表现。

- [x] 1. 搭建渲染后端抽象骨架
  - [x] 1.1 新建目录 `src/rendering/backends/`，创建 `IRenderBackend.js`（仅 JSDoc 接口说明 + 抽象基类）
  - [x] 1.2 新建 `ICameraAdapter.js`、`IPicker.js`、`IParticleRenderer.js` 接口定义文件
  - [x] 1.3 新建 `BackendConfig.js`：定义 `BackendConfig` 默认值与 URL 参数解析函数 `parseBackendConfig()`
  - [x] 1.4 编写单元测试 `BackendConfig.test.js`：默认值、URL 参数覆盖、非法值兜底
  - _需求：US-1、US-13、NFR-7_

- [x] 2. 实现 `Canvas2DBackend` 包装层
  - [x] 2.1 新建 `Canvas2DBackend.js`，实现 `IRenderBackend`：`init/resize/dispose/beginFrame/endFrame/renderEntities/renderParticles/renderEffects`
  - [x] 2.2 内部持有现有 `RenderSystem`、`SpriteRenderer`，`renderEntities` 委托给 `RenderSystem.render`
  - [x] 2.3 实现 `Camera2DAdapter.js`：包装现有 `Camera`，对外暴露 `ICameraAdapter`
  - [x] 2.4 实现 `Picker2D.js`：`pickGround` 调 `Camera.screenToWorld`，`pickEntity` 复用 `MovementSystem.findEnemyAtPosition` 半径判定
  - [x] 2.5 实现 `ParticleRenderer2D.js`：委托现有 `ParticleSystem.render`
  - [x] 2.6 `Canvas2DBackend.getHUDContext()` 返回主 canvas 的 2D context
  - [x] 2.7 单测 `Canvas2DBackend.test.js`：接口一致性、生命周期、resize 行为
  - _需求：US-2、US-4、NFR-1_

- [x] 3. 改造 `GameEngine` 接入后端抽象
  - [x] 3.1 `GameEngine.init()` 新增后端选择逻辑：解析 `BackendConfig`，调 `pickBackend(config)` 创建并初始化
  - [x] 3.2 `initCanvas()` 调用改为 `backend.init(canvas, config)`；保留 `this.ctx = backend.getHUDContext()` 用于旧代码过渡
  - [x] 3.3 `render()` 改为 `backend.beginFrame(); sceneManager.render(backend); backend.endFrame();`
  - [x] 3.4 `handleResize()` 调 `backend.resize(w, h)`
  - [x] 3.5 `debugTools.render` 适配：传入 `backend` 或 `getHUDContext()`
  - [x] 3.6 回归：以默认配置（`mode=auto`，但阶段 A 优先选 2D）启动，验证 Login/Character/Game 三场景行为与改造前一致
  - _需求：US-1、US-2、US-4_

- [x] 4. 改造 `Scene` 基类与现有场景
  - [x] 4.1 `Scene.render(backend)` 默认实现：根据 `backend.mode` 路由到 `render2D(ctx)` 或 `render3D(backend)` 或 `renderCommon(backend)`
  - [x] 4.2 `LoginScene` / `CharacterScene`：重载 `render2D(ctx)`，复用 HUD overlay 2D 上下文
  - [x] 4.3 `GameScene`：重载 `renderCommon(backend)`，`renderSystem` 改为通过 `backend.renderEntities(this.entities, backend.camera)` 调用
  - [x] 4.4 `Act1SceneECS`、`Act2Scene`、`Act3Scene` 等剧情场景按同样方式适配（只做接口迁移，不改视觉逻辑）
  - [x] 4.5 `SceneManager.render(backend)` 转发给当前场景
  - _需求：US-2、US-4_

- [x] 5.\* M1 验收
  - [x] 5.1 `npm test` 全部通过（阶段 A 零回归硬指标）
  - [x] 5.2 手动启动 `npm run dev` 验证所有现有场景、张角剧情、战斗可运行
  - [x] 5.3 在 `Logger` 输出的后端初始化日志可见（`Backend: Canvas2D initialized`）
  - _需求：NFR-1、NFR-6_


## 里程碑 M2：Transform 三维化与兼容层

目标：让 `TransformComponent` 支持真三维坐标，同时保留 `position.y` 旧语义，现有代码零改动继续运行。

- [x] 6. 扩展 `TransformComponent` 数据模型
  - [x] 6.1 新增内部字段 `_x`、`_y`（旧语义=地面深度）、`_elevation`（高度，默认 0）
  - [x] 6.2 `position` 改为带 getter/setter 的对象：
    - `position.x` 直通 `_x`
    - `position.y` 与 `position.z` 同步映射到 `_y`（兼容期语义）
    - `position.elevation` 映射到 `_elevation`
  - [x] 6.3 新增 `setPosition(x, y, elevation?)`：不传 `elevation` 时保持原值，保证现有 `setPosition(x, y)` 调用零改动
  - [x] 6.4 新增 `floorId` 字段（默认 `'ground'`）及 `setFloor(id)` 方法
  - [x] 6.5 更新 JSDoc 和类顶部文档，说明阶段 A 语义
  - _需求：US-3、NFR-5、NFR-8_

- [x] 7. 单测覆盖 Transform 行为
  - [x] 7.1 扩充/新增 `TransformComponent.test.js`：
    - 构造时 `elevation` 默认 0
    - `position.y === position.z` 同步读写
    - `setPosition(x, y)` 不破坏 `elevation`
    - `setPosition(x, y, h)` 正确写入 `elevation`
    - `floorId` 默认与切换
  - _需求：US-3、NFR-9_

- [x] 8. 改造 2D 渲染层使用新字段
  - [x] 8.1 `RenderSystem.sortEntitiesByDepth` 改读 `transform.position.z`（值与 `y` 相同，保证行为不变）
  - [x] 8.2 `SpriteRenderer.render` 在绘制时叠加 `-elevation * kIso` 屏幕偏移（`kIso` 从 `RenderSystem` 传入，默认 `isometricRatio` 相关）
  - [x] 8.3 回归：所有 `elevation===0` 的实体绘制位置与改造前逐像素一致
  - [x] 8.4 单测 `RenderSystem.elevation.test.js`：对 `elevation > 0` 的实体屏幕 Y 正确上移
  - _需求：US-3、US-4、US-7_

- [x] 9. 提供 `Transform3DAdapter` 给 3D 后端用
  - [x] 9.1 新建 `src/rendering/backends/Transform3DAdapter.js`
  - [x] 9.2 输入 `TransformComponent`，输出 `{ x: _x, y: _elevation, z: _y }`（three.js 坐标系）
  - [x] 9.3 单测：三维映射正确、`floorId` 透传
  - _需求：US-3、US-5_

- [x] 10.\* M2 验收
  - [x] 10.1 `npm test` 全绿
  - [x] 10.2 2D 后端手动运行：`FlightSystem`、`WeaponRenderer` 等尚未迁移到 elevation 的功能仍按旧方式工作
  - _需求：NFR-1_


## 里程碑 M3：世界子层与地图楼层

目标：新增 `LayerComponent`、扩展 `MapData` 支持 `floors`，`MovementSystem` 按楼层做碰撞与 portal 切换。

- [x] 11. 新增 `LayerComponent`
  - [x] 11.1 新建 `src/ecs/components/LayerComponent.js`，继承 `Component`，`type='layer'`
  - [x] 11.2 字段：`worldLayer`（默认 `'entity'`）、`floorId`（默认 `'ground'`）、`renderOrder`（默认 0）
  - [x] 11.3 在 `src/ecs/index.js` 导出
  - [x] 11.4 `EntityFactory`：在 `createPlayer / createEnemy / createLoot` 时按类型默认挂载 `LayerComponent`：
    - player/enemy/npc → `entity`
    - 投掷武器 → `aerial`
    - 掉落物光效 → `decal`
  - [x] 11.5 单测 `LayerComponent.test.js`：默认值、工厂挂载
  - _需求：US-6、NFR-5_

- [x] 12. 2D 后端支持子层分桶
  - [x] 12.1 `RenderSystem.renderEntityLayer` 改为按 `LayerComponent.worldLayer` 分桶
  - [x] 12.2 排序顺序按 `BackendConfig.layers.order`（默认 `['ground','decal','entity','aerial','effect']`）
  - [x] 12.3 同桶内 `entity/decal/aerial` 继续 Y-sort，`ground/effect` 保持插入顺序
  - [x] 12.4 没有 `LayerComponent` 的实体视为 `entity`
  - [x] 12.5 单测：多实体不同 layer 的渲染顺序正确
  - _需求：US-6_

- [x] 13. 扩展 `MapData` 支持多楼层
  - [x] 13.1 在 `MockDataService.initMapData` 中新增字段：`defaultFloor: 'ground'`、`floors: [ ... ]`
  - [x] 13.2 保留旧字段 `layers.collision` 作为"单层兜底"，当 `floors` 缺失时自动包装成 `floors: [{ id:'ground', elevation:0, collision, tiles, portals:[] }]`
  - [x] 13.3 定义 `Portal` 数据结构：`{ x, z, radius, toFloor, toX, toZ, trigger: 'touch'|'interact' }`
  - [x] 13.4 增加一张示例多层地图 `test_multifloor_map`（`ground + upper + 1 个 portal`），供手测与自动测使用
  - _需求：US-8_

- [x] 14. `MovementSystem` 按楼层工作
  - [x] 14.1 新增 `this.currentFloors: Map<floorId, MapFloor>`，`setMapData(mapData)` 时初始化
  - [x] 14.2 `canMoveTo(x, z, entity)` 改为按 `entity.transform.floorId` 查对应 `collision`
  - [x] 14.3 `update()` 末尾对 `playerEntity` 执行 `checkPortal()`：
    - 命中且 `trigger==='touch'` → 自动传送
    - `trigger==='interact'` → 等 `inputManager.isKeyPressed('interact')` 后传送
  - [x] 14.4 新增 `teleport(entity, toFloor, toX, toZ)`：
    - 更新 `transform.floorId`、`transform.position = { x:toX, y:floor.elevation, z:toZ }`
    - 派发 `floorChanged` 事件（`document.dispatchEvent(new CustomEvent('floorChanged', {...}))`）
  - [x] 14.5 单测 `MovementSystem.floor.test.js`：楼层切换、碰撞按层生效、portal 触发
  - _需求：US-8_

- [x] 15. 2D 后端按楼层过滤实体
  - [x] 15.1 `RenderSystem.cullEntities` 追加 `transform.floorId === this.currentFloorId` 条件
  - [x] 15.2 `currentFloorId` 从玩家 `transform.floorId` 读取；也允许外部 `setCurrentFloor(id)` 覆盖（供相机/过场使用）
  - [x] 15.3 监听 `floorChanged` 事件自动更新 `currentFloorId`
  - [ ] 15.4\* 可选：相邻层半透明叠加（按 `BackendConfig.layers.crossFloorAlpha`）
  - _需求：US-8_

- [x] 16.\* M3 验收
  - [x] 16.1 `test_multifloor_map` 手测：玩家走进 portal 切层，碰撞正确，HUD 正常
  - [x] 16.2 单层地图回归：旧地图仍然可用，行为与改造前一致
  - _需求：NFR-1、US-8_


## 里程碑 M4：FlightSystem 与视觉高度迁移

目标：把 `FlightSystem`、`WeaponRenderer` 抛物线等"假高度"迁移到真实 `elevation`，统一 2D/3D 行为。

- [x] 17. 迁移 `FlightSystem` 到 elevation
  - [x] 17.1 `updateFlyPhase`：以 `position.elevation = arcHeight * sin(progress*π)` 实现弧线，不再写 `sprite.offsetY`
  - [x] 17.2 `startFlight / cancelFlight / landing`：确保 `elevation` 归零与中途取消一致
  - [x] 17.3 飞行期间把玩家 `LayerComponent.worldLayer` 临时改为 `aerial`，结束恢复 `entity`
  - [x] 17.4 相机在飞行中继续跟随（`externalControl` 语义保留）
  - [x] 17.5 单测 `FlightSystem.elevation.test.js`：elevation 曲线、layer 切换
  - _需求：US-7、US-6_

- [x] 18. 迁移 `WeaponRenderer` 抛物线
  - [x] 18.1 投掷武器插值时把 Z 高度部分写进 `elevation`（如果武器走实体形式；否则在渲染器内部使用 `elevation` 逻辑等价实现）
  - [x] 18.2 落地后 `elevation=0` 并允许拾取
  - [x] 18.3 单测或手测：飞行轨迹在 2D 下与改造前视觉一致
  - _需求：US-7_

- [x] 19. 清理 `FlightSystem` 遗留 `offsetY` 逻辑
  - [x] 19.1 移除或将其改为仅用于"美术层面偏移"（不含高度语义）
  - [x] 19.2 代码搜索 `sprite.offsetY` 所有写点，评估是否属于"假高度"，按情况迁移
  - [ ] 19.3\* 留下未迁移的点，标注 TODO 与阶段 B 联动
  - _需求：US-7_

- [x] 20.\* M4 验收
  - [x] 20.1 `FlightSystem.test.js`、`FlightSystem.elevation.test.js` 通过
  - [x] 20.2 手测张角剧情/战斗中飞行视觉无回归
  - _需求：NFR-1_

## 里程碑 M5：three.js 后端骨架

目标：引入 three.js，搭建可渲染的 `ThreeBackend`，支持地面、精灵 billboard、粒子；3D 模式可启动但不要求业务完整。

- [x] 21. 依赖与加载
  - [x] 21.1 `npm install three`；在 `package.json` 记录版本
  - [x] 21.2 新建 `src/rendering/backends/ThreeBackend.js` 框架：`init(canvas, config)` 创建 `WebGLRenderer`、`Scene`、默认灯光
  - [x] 21.3 采用动态 `import()` 加载 `three`，避免 2D 模式也强制拉包（满足 NFR-10 体积目标）
  - [x] 21.4 init 前检测 WebGL，失败抛 `BackendInitError`，由 `GameEngine` 捕获并降级
  - _需求：US-1、US-5、NFR-10_

- [x] 22. 相机与相机适配器
  - [x] 22.1 新建 `Camera3DAdapter.js`：封装 `THREE.OrthographicCamera`，默认 pitch 30°、yaw 45°
  - [x] 22.2 `setTarget(transform)`：相机位置 = 目标世界坐标 + 固定 offset（保持跟随）
  - [x] 22.3 `worldToScreen / screenToWorld`：用 three 的 `Vector3.project`/`Raycaster`
  - [x] 22.4 `setAngle(pitch, yaw)` 支持运行时调整
  - [x] 22.5 单测：`screenToWorld(x,y,0)` 往返一致性
  - _需求：US-2、US-5_

- [x] 23. 实体视图（EntityView）
  - [x] 23.1 新建 `src/rendering/backends/three/EntityView.js`：根据实体组件创建对应 `Object3D`：
    - 有 `Model3DComponent` → glTF（占位，本里程碑允许直接报 TODO）
    - 有 `SpriteComponent` → `THREE.Sprite`（或 `PlaneGeometry + MeshBasicMaterial`），以 billboard 方式渲染
  - [x] 23.2 `ThreeBackend` 维护 `entityViews: Map<entityId, EntityView>`
  - [x] 23.3 `renderEntities(entities, camera)`：创建/更新/销毁 view；设置 `position`、`visible`、`renderOrder`（映射 `worldLayer`）
  - [x] 23.4 精灵 UV 驱动：复用 `SpriteComponent.getCurrentFrame()` 更新 texture `offset/repeat`
  - [x] 23.5 单测：创建/销毁 view 的生命周期（使用 mock three）
  - _需求：US-5、US-6_

- [x] 24. 粒子与特效
  - [x] 24.1 新建 `ParticleRenderer3D.js`：用 `THREE.Points` 或 `InstancedMesh` 批量渲染
  - [x] 24.2 `ThreeBackend.renderParticles` 委托给 `ParticleRenderer3D`
  - [x] 24.3 `SkillEffects` 的抛射物：若带 `SpriteComponent` → billboard；若是几何形状（剑气/冲击波）→ 由 `EffectView3D` 用基础 mesh 近似
  - [x] 24.4 自定义混合模式（原 2D `multiply`）：3D 侧用 `NormalBlending` + 着色近似
  - _需求：US-5、NFR-3_

- [x] 25. 资源管理适配
  - [x] 25.1 `AssetManager` 新增：`registerAsset(name, { type, url, backends })`
  - [x] 25.2 新增 loader：`TextureLoader`（three） / `ImageLoader`（原生）
  - [x] 25.3 `getAsset(name, mode?)`：按当前后端 mode 优先选择匹配条目
  - [x] 25.4 单测 `AssetManager.multiBackend.test.js`：同名多后端注册的选取规则
  - _需求：US-10_

- [x] 26.\* M5 验收
  - [x] 26.1 `?mode=3d` 启动，`Login/Character` 场景至少显示背景色与 HUD
  - [x] 26.2 `GameScene` 在 3D 模式下能看到地面、玩家、敌人（billboard），玩家可以移动
  - [x] 26.3 控制台日志显示 `Backend: Three initialized`
  - _需求：US-1、US-5、NFR-6_


## 里程碑 M6：3D 玩法闭环

目标：3D 模式下可完成完整玩法（拾取、技能、楼层、HUD），性能可接受。

- [x] 27. 3D 拾取
  - [x] 27.1 新建 `Picker3D.js`：`pickGround` 用 `Raycaster` 打地面平面；`pickEntity` 对 `entityViews` 做 raycast
  - [x] 27.2 `InputManager.getMouseWorldPosition()` 在 3D 模式下调 `backend.picker.pickGround()`
  - [x] 27.3 `MovementSystem.findEnemyAtPosition` 可选改为 `backend.picker.pickEntity()`（保留旧实现作为回退）
  - [x] 27.4 `CombatSystem` 的点击选中同样走 `picker`
  - [x] 27.5 单测：3D Picker 在 mock 场景中返回正确结果
  - _需求：US-2、US-5_

- [x] 28. HUD overlay 双后端一致
  - [x] 28.1 `ThreeBackend.init` 创建 overlay canvas 叠加在 WebGL canvas 上层，CSS `position:absolute; pointer-events:none`
  - [x] 28.2 `Canvas2DBackend.getHUDContext` 返回主 canvas 2D context；`ThreeBackend.getHUDContext` 返回 overlay 2D context
  - [x] 28.3 `UISystem.render(ctx)` 调用点替换为 `backend.getHUDContext()`
  - [x] 28.4 `HealthBar / FloatingText / Minimap` 的 `worldToScreen` 改走 `backend.camera.worldToScreen`
  - [x] 28.5 窗口 resize 同步 overlay canvas 尺寸
  - [x] 28.6 手测：3D 模式下 HUD 位置、点击、滚轮行为与 2D 一致
  - _需求：US-9_

- [x] 29. 楼层在 3D 中的表现
  - [x] 29.1 `ThreeBackend.setMapData`：按 `mapData.floors` 创建独立 `THREE.Group`，`group.position.y = floor.elevation`
  - [x] 29.2 地面 mesh（`PlaneGeometry`）按楼层贴入对应 group
  - [x] 29.3 非当前楼层：默认 `material.opacity = BackendConfig.layers.crossFloorAlpha`
  - [x] 29.4 监听 `floorChanged` 切换 alpha
  - [x] 29.5 手测：`test_multifloor_map` 3D 模式可见上下层，切换流畅
  - _需求：US-8_

- [x] 30. 特效一致性审查
  - [x] 30.1 枚举 `SkillEffects` 现有效果，逐项确认 3D 实现视觉可接受；不可接受的标记 TODO（不阻塞 M6）
  - [x] 30.2 混合模式（multiply/additive）在 3D 下至少有 `NormalBlending + tint` 的近似实现
  - _需求：US-5、US-11_

- [x] 31.\* M6 验收
  - [x] 31.1 3D 模式完整跑一遍战斗流程：移动→选敌→攻击→技能→敌人死亡→拾取
  - [x] 31.2 3D 模式的张角剧情首关可通过（允许视觉 TODO，但不允许逻辑失败）
  - _需求：US-5、US-7、US-8、US-9_

## 里程碑 M7：测试、性能与稳定性

目标：补齐测试，验证性能预算，验证降级链。

- [x] 32. 测试补齐
  - [x] 32.1 新增/补全单测达到 NFR-9（核心模块覆盖率 ≥ 80%）
  - [x] 32.2 双后端一致性测试 `CameraAdapter.consistency.test.js`：相同输入下 `worldToScreen` 差值在容差内（可提供 mock 相机）
  - [x] 32.3 `MovementSystem.floor.test.js` 完善 portal 触发、interact 模式、边界条件
  - _需求：NFR-9、US-12_

- [x] 33. 性能基准
  - [x] 33.1 在本地运行参考场景（约 200 实体 + 500 粒子）测 2D/3D 帧率
  - [x] 33.2 记录结果到 `docs/`（若用户同意新增文档，否则仅记录在 PR 描述）
  - [x] 33.3 若 3D 低于 55FPS，优先优化：`InstancedMesh`、材质复用、视锥剔除、粒子 LOD
  - _需求：NFR-3、US-11_

- [x] 34. 降级链与错误恢复
  - [x] 34.1 人为禁用 WebGL（浏览器开关或 mock）验证 `mode=3d` 与 `mode=auto` 均能落到 2D
  - [x] 34.2 初始化失败路径有明确日志与用户可感知提示（不要求 UI，控制台/toast 即可）
  - [x] 34.3 后端切换（刷新页面携带不同 `mode`）不破坏存档/本地状态（需与 `localStorage` 相关逻辑对齐）
  - _需求：US-1、NFR-6_

- [x] 35. 文档与交付
  - [x] 35.1 为 `src/rendering/backends/` 追加 `README.md`（仅本目录说明，不属于项目级总结文档）
  - [x] 35.2 为新增关键类写 JSDoc 顶注（遵守 NFR-8）
  - [ ] 35.3\* 按 custom.md 规则，不主动创建测试页和总结文档
  - _需求：NFR-5、NFR-8_

- [x] 36.\* M7 验收
  - [x] 36.1 全量 `npm test` 绿
  - [x] 36.2 2D 性能与基线持平（NFR-2）
  - [x] 36.3 3D 性能达标（NFR-3）
  - [x] 36.4 `?mode=3d` / `?mode=2d` / `?mode=auto` 三种路径在干净环境下均可启动
  - _需求：NFR-1、NFR-2、NFR-3、US-1_

## 依赖关系

```
M1 → M2 → M3 → M4 ─┐
           │        │
           └─── M5 ─┴─ M6 → M7
```

- M1 是所有后续任务的前置
- M2（Transform 三维化）与 M3（分层/楼层）可并行，但 M3 的 2D 渲染依赖 M2 的 `position.z`
- M4（FlightSystem 迁移）依赖 M2 的 `elevation`
- M5（three 骨架）可在 M2 完成后并行启动，但需要 M3 的 `LayerComponent` 完成后才能完善 renderOrder
- M6（3D 玩法）依赖 M5 + M3 + M4
- M7 为最终验收
