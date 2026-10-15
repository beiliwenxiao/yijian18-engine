---
inclusion: fileMatch
fileMatchPattern: '{**/EffectZoneRenderer*,**/Particle*,**/ParticleSystem*,**/SceneEditorAssets*,**/Scene1Terrain*}'
---

# 特效区域（effectZone）

## 概述

`type: 'effectZone'` 是编辑器中的多边形对象，在游戏运行时区域内持续生成粒子，实现火焰、流水、湖面、冰面等面状特效。

## 数据结构

```json
{
  "type": "effectZone",
  "name": "特效区域",
  "effectType": "fire",
  "points": [[x,y], ...],
  "x": minX, "y": minY, "width": w, "height": h,
  "particleRate": 12,
  "particleLife": 1.2,
  "particleSize": 6,
  "particleSpeed": 40,
  "particleColor": "#ff6622",
  "particleAlpha": 0.8,
  "depthSort": true,
  "sortY": 493,
  "fillColor": "rgba(255,120,30,0.15)",
  "borderColor": "rgba(255,140,40,0.7)"
}
```

`depthSort` 默认关闭，关闭时粒子保持在世界特效顶层。需要与角色前后遮挡的烟雾、火焰等可设置 `depthSort:true`，由共享 `ParticleSystem.collectDepthSorted()` 加入实体 Y-sort 队列；`sortY` 为该区域固定脚底基线，省略时使用区域底边。跨 chunk 投影必须对 `sortY` 应用一次且仅一次 Y 偏移。编辑器属性面板提供“世界深度/排序基线Y”，画布以青色虚线显示；整体拖动、对齐、方向键、图层批量偏移或带偏移粘贴区域时，显式 `sortY` 必须同步相同 Y 位移。顶点编辑或外框尺寸调整不自动移动显式基线。

## 模块

| 文件 | 职责 |
|---|---|
| `src/rendering/EffectZoneRenderer.js` | 收集场景 effectZone → 按 rate 在多边形内随机生成粒子 |
| `src/rendering/Particle.js` | 粒子渲染，支持 shape: circle/streak/ripple |
| `editor/SceneEditorAssets.js` | "图形"标签页可拖入"特效区域" |
| `editor/SceneEditorUI.js` | 属性面板：特效类型/粒子参数/预览色 |
| `editor/SceneEditorCanvas.js` | 编辑器内渲染（橙色虚线多边形 + 标签） |
| `editor/SceneEditorInteraction.js` | 命中检测 + 顶点拖拽 + 右键菜单 |

## 特效预设

| effectType | shape | 生成位置 | 表现 |
|---|---|---|---|
| fire | circle（火焰渐变） | 底部 30% | 上浮红黄粒子 |
| water | streak（扁平光条） | 均匀分布 | 水平流动蓝色条纹 |
| lake | ripple（椭圆环） | 均匀分布 | 扩散淡出涟漪 |
| ice | circle | 均匀分布 | 小亮点缓慢上飘 |
| smoke | circle | 底部 30% | 灰白大块上升 |
| sparkle | circle | 均匀分布 | 金色快闪小点 |

## 粒子形状（Particle.shape）

- `circle`：默认实心圆（火焰加渐变发光）
- `streak`：水平扁平椭圆光条（宽=size×3.5，高=size×0.6），模拟水面波光
- `ripple`：扁平椭圆环 + stroke，随生命从 1x 扩大到 3x 并淡出

## 接入路径

- 《三国张角传》只使用 `DataDrivenPrologueScene` 的多 chunk 世界管线，不再保留 `BaseGameScene._initEditorTerrain/_initEffectZones` 单 chunk 文件读取入口。
- `WorldMapLoadSession` 只从 canonical `layers[].objects[]` 收集 `effectZone`，并通过 `SceneObjectProjector` 应用一次 worldOffset；`SceneStreamingRuntime` 汇总已加载 chunk 后调用 `SceneTerrainBinding.setEffectZones(effectZones)` 装配已投影区域。
- `Scene1Terrain` 必须由世界会话注入有效 `sceneData.layers`，不得自行读取磁盘或 localStorage；缺少 canonical 数据直接失败。
- 每帧 `effectZoneRenderer.update(deltaTime)` 生成粒子，由已有 `particleSystem.update/render` 驱动

## 编辑器使用提示

水面效果建议：生成速率 40~60、粒子大小 2~3、生命 2~3 秒。条纹越密越小越透明越像水面。
