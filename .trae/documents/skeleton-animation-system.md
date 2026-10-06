# 骨骼动画系统 + 骨骼动画编辑器 实施计划

## Context（背景）

游戏前期缺乏角色美术资源，现有 NPC/载具/主角全靠 SpriteComponent 序列帧/整图渲染，缺乏骨骼级动画能力（无法做换装、局部动画、朝向插值等）。本计划新增一套**功能完善的骨骼动画系统**，并按用户确认的三个决策落地：

1. **混合模式**：骨骼控制空节点（rig 先行），槽位（slot）可绑定 空节点/单图/图集切片/**序列帧动画**附件（序列帧跟随骨骼运动并自播帧），后续有正式美术可无缝换成图片/网格附件。
2. **编辑器**：独立编辑器页面（editor/ 新 html + NAV_GROUPS 注册），含骨骼树、画布 gizmo、关键帧时间轴、槽位附件编辑、播放预览。
3. **替换机制**：Manifest 资产级替换——`assets.json` 条目 `runtime2D.mode` 扩展 `'skeleton'`，imageId 背后换成骨骼资产后，所有引用该 ID 的 NPC/载具/主角/场景对象自动切换骨骼渲染，实体数据零迁移。
4. **数据格式**：自定义 JSON（Spine 导入留作后续增强，不在本期）。

## 一、骨骼资产 JSON 格式

文件位置：`example/<game>/assets/skeletons/<skeletonId>.json`；manifest 条目 `runtime2D: { mode: 'skeleton', path: 'assets/skeletons/xx.json' }`，`imageId === assetId`（骨骼引用的图片仍是 assets/images 下的既有 imageId）。

```json
{
  "schemaVersion": 1,
  "skeletonId": "skeleton.hero",
  "bones": [ { "id": "root", "parent": null, "x": 0, "y": 0, "rot": 0, "scaleX": 1, "scaleY": 1, "length": 40 } ],
  "slots": [ { "id": "body", "bone": "root", "z": 0,
    "attachment": { "type": "empty|image|slice|sequence", "assetId": "img.x",
      "spriteSheet": "img.x", "row": 0, "frames": [0,1,2], "fps": 8, "x": 0, "y": 0, "rot": 0 } } ],
  "clips": [ { "name": "walk", "durationMs": 800, "loop": true,
    "tracks": [ { "bone": "root", "keys": [ { "t": 0, "x": 0, "y": 0, "rot": 0, "sx": 1, "sy": 1, "ease": "linear|easeInOut" } ] } ] } ]
}
```

## 二、运行时（P0）

新目录 `src/animation/`：
- `SkeletonAsset.js`：`parseSkeletonAsset(json)` → bones Map + clips 索引（纯数据，可单测）
- `SkeletonPose.js`：纯函数 `sampleClip(clip, timeMs)`（关键帧插值 + 父链变换组合）；`computeSlotWorldTransform(pose, slot)`。**与 DOM 解耦，供 vitest 与编辑器预览共用**
- `src/ecs/components/SkeletonComponent.js`：Component('skeleton')；持有 skeletonAsset/currentClip/clipTime/每槽位序列帧独立推进状态（帧算法对齐 SpriteComponent.update 的 `1000/fps` + loop wrap，但按槽位而非按实体）；pose 缓存 + dirty 脏标记；`update(dt)` 挂 Entity.update 链（src/ecs/Entity.js:87 自动驱动组件）
- `src/rendering/SkeletonRenderer.js`：`render(ctx, entity, skeletonComponent, x, y, width, height)`——槽位按 z 排序 → 附件世界变换 → drawImage（image=AssetManager.getImage / slice=图集帧 / sequence=当前帧）；根骨骼原点对齐**底部中心锚点**（与 _renderSprite 一致）；flipX 用整体 scale(-1,1)；alpha 乘 sprite.alpha

接线（5 个既有文件小改）：
| 文件 | 改动 |
|---|---|
| [EntityRenderer2D.js](file:///d:/yijian18-engine/src/rendering/EntityRenderer2D.js) `_renderSprite`（:189） | 开头判 `sprite.isSkeleton` → 委托 SkeletonRenderer，其余分支零感知 |
| [AssetManifestSchemas.js](file:///d:/yijian18-engine/src/data/schema/AssetManifestSchemas.js)（:22-32） | `runtime2D.mode` 枚举 + `'skeleton'` |
| [AssetManager.js](file:///d:/yijian18-engine/src/core/AssetManager.js) `registerManifest`（:112） | skeleton 分支：JSON 描述符加载 → parseSkeletonAsset 缓存 → 内部引用 imageId 入队 |
| [SceneAssetCollector.js](file:///d:/yijian18-engine/src/core/SceneAssetCollector.js)（:73） | mode 白名单 + 'skeleton' |
| [EntityFactory.js](file:///d:/yijian18-engine/src/ecs/EntityFactory.js) createNPC(:405)/createVehicle(:617)/addCharacterAnimations(:356) | `getManifestEntry(spriteSheet).runtime2D.mode === 'skeleton'` 时：SpriteComponent 加 `isSkeleton=true`（保留 width/height/alpha/flip 外观语义，animations 清空），并挂 SkeletonComponent；`playAnimation` 名字兼容转发到 SkeletonComponent.playClip |

## 三、编辑器（P1）

- `editor/skeleton-editor.html` + `editor/SkeletonEditor.js`（命令层拆 `editor/SkeletonEditorCommandService.js`）
- 注册：[EditorShared.js](file:///d:/yijian18-engine/editor/EditorShared.js) `EDITOR_PAGES`（:16）+ `NAV_GROUPS` 资产系统组（:49）加 `{ id: 'skeleton-editor', label: '🦴 骨骼' }`；[vite.config.js](file:///d:/yijian18-engine/vite.config.js) `build.rollupOptions.input` 加 skeleton-editor 入口
- 布局四区（仿 library-editor 页面骨架）：
  - 左·骨骼树面板：骨骼增删/改名/改父/排序
  - 中·画布：gizmo 交互仿 [LibraryEditor.js](file:///d:/yijian18-engine/editor/LibraryEditor.js) `_bindSkillShapeCanvas`（:1449）——选中骨骼画骨线 + 位移手柄 + 旋转环，拖拽实时写回 bone.x/y/rot；叠加绘制各槽位附件
  - 右·槽位检查器：attachment 四类型切换；image 从 Manifest 图片目录下拉；sequence 选 spriteSheet + row/frames/fps（先例 SceneEditorUI.js:1289 imageIdSelect）
  - 底·时间轴：clip 下拉/新建、per-bone 轨道行、帧标尺、播放头 seek、自动关键帧（K 键写入当前 pose）、插值选择、播放/暂停/循环——预览直接驱动 SkeletonPose 同一套采样代码
- 保存：新增 `POST /api/skeleton-asset-transaction`（[EditorFileApiPlugin.js](file:///d:/yijian18-engine/src/dev/EditorFileApiPlugin.js) 仿 :420 分支）→ 新文件 `src/dev/SkeletonAssetTransaction.js`（仿 [SceneImageAssetTransaction.js](file:///d:/yijian18-engine/src/dev/SceneImageAssetTransaction.js) 的 prepare→commitPrepared 原子模式）：SkeletonAssetValidator 校验 → 写 `assets/skeletons/*.json` → manifest upsert（bounds=槽位包围盒，revision+1）
- 新校验器 `src/core/validation/SkeletonAssetValidator.js`（仿 SharedAtlasCatalogValidator）：bones 无环、slot/track 骨骼引用存在、keys 时间单调、attachment 引用可解析

## 四、绑定入口（P1 收尾）

- 场景对象属性面板与内容库 NPC/载具/主角定义弹窗的 imageId 下拉（SceneEditorUI.js:1289、SceneEditorUI.js:1798-1979、LibraryEditor.js:1064）：列 skeleton 资产并标注 `[骨骼]`——imageId 不变即实现资产级热替换，NPC 定义/存档零迁移

## 五、阶段与验证

**P0 运行时 + 格式**（可先手写 demo JSON 验证）
- 新增：src/animation/SkeletonAsset.js、SkeletonPose.js、src/ecs/components/SkeletonComponent.js、src/rendering/SkeletonRenderer.js、src/core/validation/SkeletonAssetValidator.js
- 修改：上表 5 个文件 + example/sanguo_zhangjiao/assets/skeletons/demo.json（手写示例：root+两根子骨、一个 sequence 槽位、一个 walk clip）
- 验证：vitest（SkeletonPose 插值/循环/层级组合；Validator 非法输入拒绝；骨架文件放 src/animation/*.test.js 同目录先例）+ `node --check` 全部新文件 + 浏览器（临时把某个 NPC 的 manifest 条目改 mode:'skeleton' 指向 demo.json，目测锚点/翻转/循环/层级跟随）

**P1 编辑器**
- 新增：editor/skeleton-editor.html、editor/SkeletonEditor.js、editor/SkeletonEditorCommandService.js、src/dev/SkeletonAssetTransaction.js
- 修改：EditorShared.js、vite.config.js、EditorFileApiPlugin.js
- 验证：编辑器创建骨骼→gizmo 摆姿→打关键帧→保存→刷新回读一致→把某 NPC imageId 指向该骨骼资产→游戏内确认渲染切换

**P2 收尾（本期不含，留档）**
- 3D billboard 兜底（EntityView3D 用离屏 canvas 画当前 pose → CanvasTexture）、Spine JSON 导入、IK、网格变形

## 六、风险与对策

- **性能**：每帧 O(bones) 采样+矩阵——pose 脏标记（仅 clipTime 推进/数据变更时重算）；无轨道骨骼直接用默认 pose 缓存
- **并存语义**：isSkeleton 实体的 SpriteComponent.animations 清空，playAnimation 由 SkeletonComponent 兼容转发，杜绝双驱动
- **存档兼容**：骨骼纯资产级替换，不进存档，无兼容问题；manifest 条目 revision 按既有约定 +1
- **3D**：本期 schema 只扩 2D mode，3D 端沿用 billboard 兜底（P2）
