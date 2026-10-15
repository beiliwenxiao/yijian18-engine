---
inclusion: manual
---

# Scene1Terrain 常见陷阱

## 对象引用共享导致 worldOffset 双重偏移

### 问题描述

`_applySceneData` 中遍历 `scene.layers[].objects[]` 收集不同类型对象时，如果同一个 `obj` 引用被 push 到多个数组（如 `_collisionShapes` 和 `_editorShapes`），后续 worldOffset 偏移会对同一个对象的坐标累加多次。

### 根因

```js
// 碰撞 shape push 后没有 continue，后面的 else if (obj.type === 'shape') 再次命中
if (obj.type === 'shape' && obj.collide) {
  this._collisionShapes.push(obj);  // 第一次放入
}
// ... 后续代码 ...
} else if (obj.type === 'shape') {
  this._editorShapes.push(obj);     // 同一个 obj 引用再次放入
}
```

偏移时：
```js
for (const s of this._collisionShapes) { s.points = s.points.map(p => [p[0]+ox, p[1]+oy]); }
for (const s of this._editorShapes)    { s.points = s.points.map(p => [p[0]+ox, p[1]+oy]); }
```
同一个对象被偏移了两次。

### 解决方案

碰撞 shape 收集后立即 `continue`，不再进入后续渲染收集分支：

```js
if (obj.type === 'shape' && obj.collide) {
  this._collisionShapes.push(obj);
}
if (layerHidden || (obj.type === 'shape' && obj.collide)) continue;
```

### 通用规则

在 `_applySceneData` 中收集对象时：
- 同一个 `obj` 引用**不得**同时出现在多个会被 worldOffset 偏移的数组中
- 如果确实需要在多个数组中存储，必须使用深拷贝 `JSON.parse(JSON.stringify(obj))`
- 新增收集分支时，务必检查是否与已有分支存在交集

## DataDrivenPrologueScene 不使用 _initEditorTerrain

### 问题描述

`BaseGameScene` 构造函数中调用 `_initEditorTerrain()`，会以 `editorSceneId`（如 's0-1'）创建一个**不带 worldOffset** 的 terrain。`DataDrivenPrologueScene` 随后在 `_loadWorldTerrains` 中异步创建**带 worldOffset** 的 terrain。如果两者同时存在会引起混乱。

### 解决方案

`DataDrivenPrologueScene` 在类级别覆盖 `_initEditorTerrain` 为空方法：

```js
export class DataDrivenPrologueScene extends BaseGameScene {
  _initEditorTerrain() { /* 由 _loadWorldTerrains 代替 */ }
  ...
}
```

这样 BaseGameScene 构造函数中的调用会走子类的空实现，不会重复创建 terrain。

## SceneTerrainCollision 不依赖 terrain 私有几何方法

`SceneTerrainCollision` 是框架级几何解算器，不能调用具体 terrain 的 `_pointInCollisionShape`、`_pushOutOfPolygon` 等私有方法。曾经的 polygon/path 分支调用了并不存在的 `terrain._pushOutOfPolygon()`，导致实体首次进入多边形碰撞区时才抛出运行时异常。

约定：
- shape 点命中和推出算法由 `SceneTerrainCollision` 自己实现
- terrain 只提供已经应用一次 worldOffset 的 `_collisionShapes` / `_walkableShapes` 等数据
- walkable 仍优先于 collide，polygon/path 仍按闭合多边形处理
- 不得用可选调用或空判断绕过缺失算法，否则会静默丢失多边形碰撞
