# 可攀爬地形属性 + 逃生藤蔓编辑器支持

## Context

逃生藤蔓（S01-cliff-vine）已有数据驱动的 `semanticRole: "climbSurface"` 攀爬链路（跳跃进入 → ClimbSystem 受控攀爬），但存在三个问题：
1. 攀爬区域（climbBounds）、出口、速度等参数无法在场景编辑器中修改，只能手改 JSON；
2. 地形 shape 只有「可碰撞/可落脚」两种属性，策划无法画一块通用攀爬区（如岩壁藤蔓、悬崖绳索）；
3. 「离开」目前是硬编码剧情出口（S01S02SceneFlow._updateControlledVineClimb 爬到顶触发转场），不符合"通过跳离开"的预期。

用户已确认：编辑器两方面都做（地形 shape 勾选「可攀爬」+ 藤蔓放置物参数可视化编辑）；攀爬中按跳跃随时脱离（S01 剧情出口保留）；游戏内攀爬区纯半透明色块显示（装饰贴图策划另摆）。

## 设计要点

### 1. 数据模型：三态互斥
`collide / walkable / climbable` 互斥（沿用现有互斥约定）。理由：若 climbable 与 walkable 共存，`Scene1Terrain.isBlocked` 的 walkable 优先会让玩家直接走进攀爬区而非跳入；互斥语义清晰。

场景 JSON 地形层对象新增：`{"climbable": true, "points"/"x/y/width/height": ...}`。

### 2. 运行时桥接（复用 climbSurface 链路，ClimbSystem/LocomotionSystem 不改）
- `example/sanguo_zhangjiao/scenes/Scene1Terrain.js`
  - `_applySceneData`（:339-356）：新增分支收集 `obj.climbable === true` 的 shape → `_climbableShapes`（同款投影，不参与碰撞/常规渲染）；
  - 新增 `getClimbableSurfaces()` 访问器；
  - 新增半透明色块渲染（如 `rgba(90,200,140,.3)` + 虚线边框）。
- `src/core/scene/SceneClimbTargetResolver.js` `resolve()`（:28）
  - 新增入参 `climbableShapes = []`，与 projected climbSurface 一同参与最近面评选；
  - 合成规则：`climbBounds` = shape 自身；`radius` = shape 对角线一半（覆盖默认 96，入区即命中）；`climbTarget` = 玩家当前位置（`climbTargetWorld: true`，经 :61-63 有限性校验）；`climbExit` = 玩家位置、`climbExitRadius` = max(w,h)（永远"在出口"，不拦 finish）；`requiresClimbAbility: false`；`climbMode: 'controlled'`。
- `src/core/scene/SceneWorldQuery.js` `resolveClimbTarget`（:23）：把 `terrain.getClimbableSurfaces?.()` 透传给 resolver。

### 3. 跳离（随时可跳）
- `src/core/scene/SceneFramePipeline.js`（:264-268）：保留跳跃蓄力抑制；新增跳跃**按下沿**检测（本帧 held 且上帧未 held 且 `climbSystem.isControlledClimb(player)`）→ 调 `climbSystem.cancel(player)`（ClimbSystem.js :188 已存在，`restoreStart:false` 留在原地，`_finish` 自动恢复 walk 层）。
- **防秒回攀**：`ClimbSystem.cancel` 记录 `detachAt` 时间戳；`src/core/scene/SceneCombatActions.js` `jumpByDirection`（:167-188）两个 climbTarget 分支前检查：距 detach < 250ms 则跳过攀爬判定，让这次跳跃走普通跳——即「跳离开」。
- **S01 剧情出口共存**：`S01S02SceneFlow._updateControlledVineClimb`（:2023-2045）依赖攀爬 presentation 状态，脱离后 presentation 为空直接 return，出口剧情逻辑零改动——爬到出口仍 finishControlledClimb + 转场，中途跳离则只是落地。
- S13 traverse 模式不受影响（跳离仅挂 controlled 模式）。

### 4. 场景编辑器
- `editor/SceneEditorUI.js`
  - `_buildShapeProperties`（:2143 起，勾选框 :2200）：加「可攀爬」checkbox；互斥提交逻辑（:936-957）扩为三选一（勾任一清其余两态，取消仅清自身）；
  - `_buildRefProperties`：`semanticRole === 'climbSurface'` 的放置对象追加「攀爬参数」分区——climbMode 下拉（controlled/traverse）、climbSpeed / climbExitRadius / prompt、climbBounds x/y/w/h、climbExit x/y 数字输入（默认回填本体范围）；**数字表单而非拖拽 handles**（handles 需命中测试+拖拽状态机+框选冲突处理，工作量不成比例），附「画布高亮」定位按钮；
  - ref 的 collision-mode 下拉（:1356-1361）不动。
- `editor/SceneEditorCanvas.js`：参照 walkable 的 3 处渲染——climbable shape 画青绿半透明+虚线框；选中的藤蔓放置物画 climbBounds 色块与 exit 圆点（含 exitRadius 圈）。

### 5. 校验链
- `editor/EditorSceneCommandService.js` `validateAndCanonicalize`（:373）：shape 三态互斥 canonicalize（勾 climbable 时清除 collide/walkable）。
- `ScenePlacementRuntime.js:957` 与 `SceneTerrainBinding.js:146` 的 collision.mode 白名单不走此路，无需改。

### 6. 兼容性
- S01 现有藤蔓、S13 traverse 模式链路零改动；
- 无 climbable shape 的场景新数组为空、resolver 注入空列表，零影响。

## 实施清单（按序）

| # | 文件 | 改动 |
|---|---|---|
| 1 | example/sanguo_zhangjiao/scenes/Scene1Terrain.js | 收集 `_climbableShapes` + `getClimbableSurfaces()` + 色块渲染 |
| 2 | src/core/scene/SceneClimbTargetResolver.js | 新入参 `climbableShapes` + 合成 controlled surface |
| 3 | src/core/scene/SceneWorldQuery.js | 透传 terrain climbable 列表 |
| 4 | src/systems/ClimbSystem.js | cancel 记录 `detachAt`（防秒回攀时间戳） |
| 5 | src/core/scene/SceneFramePipeline.js | 跳跃按下沿 → cancel（随时跳离） |
| 6 | src/core/scene/SceneCombatActions.js | detach 250ms 冷却守卫 |
| 7 | editor/SceneEditorUI.js | 三态互斥勾选 + climbSurface 参数表单 |
| 8 | editor/SceneEditorCanvas.js | climbable shape 与藤蔓 bounds/exit 叠加渲染 |
| 9 | editor/EditorSceneCommandService.js | 保存时三态互斥 canonicalize |

## 验证

1. **编辑器**：scene-workflow.html 画一个 shape 勾「可攀爬」→ 保存 → assets/scenes/S01.json 中该对象 `climbable:true` 且 collide/walkable 被清除；选中藤蔓改 climbSpeed/climbBounds → 保存后 JSON 更新；画布能看到攀爬区色块与藤蔓 bounds/exit 叠加。
2. **运行时**：vite dev（port 3000）进入游戏 → 跳向攀爬区进入受控攀爬（半透明色块范围内移动）；攀爬中按空格随时脱离且 250ms 内不立即回攀；再跳可重新进入。
3. **回归**：S01 爬藤蔓到出口仍触发剧情转场；S13 traverse 模式正常；无 climbable 区域的场景行为无差异。
