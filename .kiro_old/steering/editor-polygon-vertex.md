---
inclusion: fileMatch
fileMatchPattern: '{**/SceneEditorInteraction*,**/SceneEditorCanvas*}'
---

# 编辑器多边形顶点编辑

## 右键菜单顶点操作

选中多边形（`type:'shape' shapeType:'polygon'/'path'` 或 `type:'buffZone'` 或 `type:'effectZone'`）后右键：

### 命中顶点时（黄色方块区域，8px 半径）
- `🔴 删除顶点 #N` — 删除该顶点（三角形时置灰，至少保留 3 个）
- `➕ 在顶点 #N 后插入` — 在该点与下一点的中间插入新顶点

### 命中边时（点到线段距离 ≤6px）
- `➕ 在边 #N→#M 中间插入顶点` — 两点中点处插入

### 都没命中时
只显示常规菜单（图层/删除/对齐等），不显示顶点操作。

## 关键方法

| 方法 | 位置 | 作用 |
|---|---|---|
| `getVertexAt(shape, x, y)` | SceneEditorInteraction | 命中顶点检测，返回索引或 -1 |
| `_getEdgeAt(shape, x, y)` | SceneEditorInteraction | 命中边检测（点到线段距离），返回边起点索引或 -1 |
| `_distToSegment(px,py,ax,ay,bx,by)` | SceneEditorInteraction | 点到线段的距离计算 |
| `_syncBoundingBox(obj)` | SceneEditorInteraction | 顶点增删后同步 buffZone/effectZone 的 x/y/width/height |

## 右键菜单自动定位

`handleContextMenu` 中 `document.body.appendChild(menu)` 后测量 `getBoundingClientRect()`：
- 右边溢出 → 向左展开
- 下边溢出 → 向上展开

## effectZone 支持

`effectZone` 在所有多边形操作中与 `buffZone` 等价处理：
- 命中检测：`_pointInPolygon`
- 顶点拖拽：`getVertexAt` → `draggingVertex`
- 整体移动：偏移所有 points + `_syncBuffZoneBBox`
- 选中框：顶点手柄显示
- 对齐：包围盒计算
