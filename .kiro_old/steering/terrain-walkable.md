---
inclusion: fileMatch
fileMatchPattern: '{**/Scene1Terrain*,**/SceneTerrain*,**/SceneEditorUI*,**/CollisionSystem*,**/MovementSystem*,**/PathfindingSystem*,**/SceneFramePipeline*}'
---

# 地形碰撞与可落脚区域

## 两种互斥的地形多边形属性

编辑器中 shape 对象有两个复选框，互斥（勾选一个自动取消另一个）：

- **可碰撞** (`collide: true`) — 不可通行区域，玩家碰到被弹回
- **可落脚** (`walkable: true`) — 可行走区域，**即使脚下有碰撞区也放行**

## 运行时判定顺序（Scene1Terrain.isBlocked）

```
1. 遍历 walkableShapes → 点在内部 → return false（放行）
2. 遍历 collisionShapes → 点在内部 → return true（阻塞）
3. 不再使用椭圆盆地或区块边缘作为自动物理边界
```

**walkable 优先于 collide**：可以在整片碰撞区（如树林）中画一条 walkable 多边形（小路），路上的点先命中 walkable 直接放行。

## 数据收集（_applySceneData）

```js
this._collisionShapes = [];  // obj.type === 'shape' && obj.collide
this._walkableShapes = [];   // obj.type === 'shape' && obj.walkable
```

- 碰撞和可落脚 shape 无论图层是否可见都收集（逻辑层不依赖视觉）
- 两者都不放入 `_editorShapes`（避免 worldOffset 双重偏移）
- worldOffset 阶段对两者都做坐标偏移

## 表现与调试

- `walkable` 虽然不进入 `_editorShapes`，仍必须由 `Scene1Terrain._renderEditorShapes()` 直接绘制同一份已投影 `_walkableShapes`；不得为表现再次投影或重新偏移坐标。
- `SceneDiagnostics.renderCollisionShapes()` 必须委托 Terrain 的 `renderCollisionShapesDebug()`，同时绘制 `collision`（橙红）和 `walkable`（青绿）区域；调试层只读，不得改变物理判定或场景数据。

## 编辑器属性面板

SceneEditorUI.js 中 `_buildShapeProperties` 末尾：
```html
可碰撞: <checkbox data-prop="collide">
可落脚: <checkbox data-prop="walkable">
```

互斥逻辑在 `data-prop` change 处理器中：勾选 collide 时 `obj.walkable = false`，反之亦然。取消勾选则两个都为 false（普通装饰形状）。
## 非战斗碰撞停顿（不自动绕障）

玩家移动被地图/瓦片阻挡，或实体碰撞、地形碰撞把玩家推出时，`SceneFramePipeline` 在全部碰撞解算完成后只维护既有接触停顿和自动停止：

- 禁止调用 `MovementSystem.tryRerouteAfterContact()` 或以 `PathfindingSystem` 对碰撞后的输入执行 A*；玩家必须自行改变方向或重新右键指定点位。
- 右键保留原始点击终点的单点移动，键盘、触屏摇杆和手柄轴输入保留直接方向 intent；三端继续共用 `getMoveAxis()` 和 `moveIntentRouter`，驾驶席不得另建旁路。
- 仅地图/静态地形阻挡触发既有 0.5 秒 contact lock；实体（怪物/NPC）顶撞不算静态阻挡，战斗状态不启动接触停顿。
- 持续被静态障碍阻挡仍按既有阈值自动停止并要求松开方向输入后恢复；锁只影响移动，不修改全局暂停，不禁用攻击、交互或 UI。
- 相机只能在移动、实体碰撞和地形修正完成后跟随最终位置，避免推挤抖动。