---
inclusion: manual
---

# 相机与坐标系统规范

## 核心原则

**渲染时的相机状态 和 输入坐标转换时的相机状态 必须完全一致。**

## 坐标转换链

```
鼠标 clientX/Y → InputManager.mouse.x/y（屏幕坐标）→ Camera.screenToWorld()（世界坐标）
```

- `mouse.x/y` 范围：`[0, camera.width] × [0, camera.height]`
- `Camera.screenToWorld(sx, sy)` = `{ x: sx + position.x - width/2, y: sy + position.y - height/2 }`
- 渲染偏移：`ctx.translate(-viewBounds.left, -viewBounds.top)` 其中 `viewBounds.left = position.x - width/2`

## 相机更新时序（BaseGameScene.update）

正确的顺序必须是：

1. `camera.update(deltaTime)` — 相机跟随玩家
2. `postCameraUpdate()` — 相机后处理（子类覆盖，如 clampCameraToBasin 限制范围）
3. 其他系统使用相机（InputManager.setCameraPosition、MovementSystem、render 等）

**禁止在步骤 2 之后再调用 `camera.update()`**，否则会覆盖 clamp 结果导致渲染和输入坐标不一致。

## MovementSystem 注意事项

- `MovementSystem.update()` 不再调用 `camera.update()`，只负责同步 `setCameraPosition`
- `handleClickMovement()` 使用 `camera.screenToWorld(mouseScreen.x, mouseScreen.y)` 实时转换坐标
- 不依赖 `InputManager.getMouseWorldPosition()` 的预计算值（因为它可能使用过期的 cameraX/Y）

## 子类相机限制（如 Act1SceneECS）

通过覆盖 `postCameraUpdate()` 钩子实现相机范围限制：

```javascript
postCameraUpdate() {
    this.clampCameraToBasin();
}
```

**不要**在 `super.update()` 之后才做相机 clamp —— 那时 MovementSystem 已经用了未 clamp 的相机做坐标转换。

## InputManager.getMouseWorldPosition()

- 2D 模式下（`backend.mode !== '3d'`）直接使用 `{ x: mouse.worldX, y: mouse.worldY }`
- 只有 3D 模式才走 `backend.picker.pickGround()` 路径
- `mouse.worldX/Y` 在 mousedown/mousemove 事件中预计算，使用当时的 `cameraX/Y`

## pointerTransform（竖屏旋转模式）

- 手机竖屏时通过 CSS `rotate(90deg)` 模拟横屏
- `pointerTransform` 负责把物理触摸坐标映射到 canvas 逻辑坐标
- 使用场景的 `logicalWidth/Height` 做归一化，不依赖 `canvas.width`（避免 CSS 拉伸导致不一致）
- 通过 `setupOrientation()` 安装到 `InputManager.setPointerTransform()`

## 常见 Bug 模式

| 现象 | 原因 |
|------|------|
| 点击方向完全相反 | backend.picker 使用了未同步的内部相机（已通过 mode===3d 判断修复） |
| 点击位置有固定偏移 | 相机 clamp 在 screenToWorld 之后执行，导致渲染和输入用了不同相机 |
| 移动距离翻倍/缩小 | canvas.width 和 CSS 显示尺寸不一致，或 DPR 处理不当 |
| 竖屏模式坐标错乱 | pointerTransform 未正确安装，或 X/Y 轴映射方向错误 |
