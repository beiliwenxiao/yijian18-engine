---
inclusion: manual
---

# 场景数据一致性规则

## 核心原则

**localStorage 缓存与磁盘 JSON 文件必须始终一致。** 文件是唯一真实数据源（single source of truth），localStorage 只是加速缓存。

## 数据流

```
编辑器修改 → sceneData（内存）
                ↓ 保存
         ┌──────┴──────┐
    localStorage     JSON 文件
    (缓存加速)      (持久存储)
```

## 保存时必须同时写入两处

`SceneEditorHistory.save()` → `onSceneChange(sceneData)` 必须：
1. 写入 localStorage（`EditorDataManager.updateScene()`）
2. 写入 JSON 文件（`/api/save-file`）

**不允许只写一处。**

## 清理缓存后恢复的正确行为

清理 localStorage 后打开场景时：
1. `setCurrentScene()` 返回的数据如果**没有 `layers` 字段**，视为"未完整加载"
2. 必须从 JSON 文件重新加载完整数据
3. 加载后回写 localStorage

## 场景 id 与文件名的关系

- 场景文件名由 `_scene_order.json` 中的 `scenes[id].name` 决定
- 文件路径：`assets/scenes/{name}.json`
- 文件内部的 `id` 字段必须与 `_scene_order.json` 中的 key 一致
- **重命名场景时必须同步修改**：`_scene_order.json` 的 name、JSON 文件名、JSON 内部的 id/name

## 加载优先级（_loadSceneFromFile）

尝试加载场景文件时，按以下顺序查找：
1. `{sceneId}.json`（以 id 作为文件名）
2. `{name}.json`（以 _scene_order 中的 name 作为文件名）

只接受包含 `layers` 字段的完整数据。

## 全局共享数据的同步

图集（atlases）和图片（images）是全局共享的，保存时必须：
1. 写入全局配置文件（`config/atlases.json` / `config/images.json`）
2. 更新内存缓存（`updateAtlasesCache` / `updateImagesCache`）
3. 同步到 localStorage 中**所有场景**的数据

## 禁止事项

- ❌ 修改场景 name 后不更新文件名
- ❌ 只保存 localStorage 不保存文件
- ❌ 只保存文件不更新 localStorage
- ❌ `initScenesFromFile` 写入的元信息（无 layers）被当作完整数据使用
- ❌ 全局资源只更新当前场景不同步其他场景
