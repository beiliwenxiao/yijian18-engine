---
inclusion: manual
---
# 图集系统架构

## 数据归属

- 图集（atlases）是**全局共有**的，所有场景共享同一套图集数据
- 全局配置文件：`editor/config/atlases.json`，结构为 `{ atlases: [...] }`
- 每个图集包含：`id / name / path / width / height / slices{}`
- 每个切片包含：`name / sx / sy / sw / sh / collide? / colliderRadius?`
- 可以有多个图集（数组），每个图集对应一张源图

## 图集与场景的关系

- 每个场景的 `sceneData.atlases` 里存了图集的**副本**（不是引用）
- `SceneEditor.loadScene()` 时调用 `_mergeGlobalAtlases()` 将全局配置覆盖到场景数据中
- `_mergeGlobalAtlases()` 用**覆盖模式**：同 id 图集以全局 JSON 为准替换，保证最新切片属性生效
- localStorage 中每个场景各自存了一份 atlases 副本，仅为运行时方便

## 图集保存流程（saveAtlases）

保存时必须同步**三处**：

1. **文件**：`/api/save-file` 写回 `editor/config/atlases.json`
2. **内存缓存**：调用 `updateAtlasesCache(configObj)` 更新 `SceneDataLoader` 模块的 `_atlasesConfig`
3. **localStorage 所有场景**：`_syncAtlasesToAllScenes(atlases)` 遍历当前游戏的所有场景数据，覆盖每个场景的 atlases

如果遗漏任何一处，会导致：
- 漏文件：刷新后丢失修改
- 漏内存缓存：当前会话新建/切换场景时读到旧值
- 漏 localStorage：切换到其他场景时看到旧的切片属性

## localStorage Key 格式

```
yijian18-engine_editor_data_scenes_{gameId}
```

由 `EditorDataManager` 管理，值为场景数组 JSON。

## image 体系与 atlas 体系

两套体系**独立**，不合并：

| 体系 | 用途 | 数据位置 |
|------|------|---------|
| atlas | 图集切片（精灵图拼接） | `sceneData.atlases[].slices{}` |
| image | 独立图片对象（背景大图等） | `sceneData.imageAssets[imageId].src` |

- atlas 对象在场景中表现为 `type:'slice'`，引用 `atlasId + sliceKey`
- image 对象在场景中表现为 `type:'image'`，引用 `imageId`（对应 imageAssets 中的路径）

## 编辑器 UI 交互

### 图集 Tab（左侧资源库）
- 顶部操作栏：`+ 新增图集 / 🗑 删除 / 💾 保存图集`
- 点击图集头部 → 选中（展开属性编辑区：名称、路径、宽高、切片数统计）
- 切片网格可点击选中 → 左侧下方显示切片属性
- 切片属性面板底部有「编辑」按钮 → 弹出切片编辑弹窗

### 切片编辑弹窗
- 全屏遮罩 + 居中弹窗
- 左侧 Canvas：图集原图缩放显示 + 半透明遮罩 + 高亮切片区域 + 绿色线框
- 选框可拖动移动（鼠标在选框内）和右下角缩放
- 右侧参数面板：X/Y/宽/高实时同步
- 确定：写回 slice 数据；取消：恢复原始值

### "添加图片"按钮
- 仅在图集 Tab 激活时显示（`#editor-image-actions` 容器）
- "编辑切片"按钮已移除

## /api/file-size 端点

- `GET /api/file-size?path=相对路径` → `{ ok: true, size: 字节数 }`
- 用于编辑器显示 image 对象的文件大小
- 在根 `vite.config.js` 和 `example/sanguo_zhangjiao/vite.config.js` 均有定义
