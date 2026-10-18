# 骨骼编辑器部件库统一入库改造计划

## Context

骨骼编辑器左侧「图片库」与内容库（`library.json`）物品定义割裂：同一装备的背包图标（内容库 imageId，40×40）和骨骼部件图（manifest assetId，64×64）是两份独立资产，策划需在三处手动对齐命名，容易出错。用户要求统一到内容库——装备物品和身体部件都入库管理，骨骼编辑器面向「部件」而非「裸图片」。

## 设计决策

1. **新建 `skeletonParts` collection**（`library.skeletonParts`），不用 `items.type='bodyPart'`——物品走背包/掉落逻辑，部件是外观资源，职责不同。
2. **装备引用 part id**：`item.skeletonPart = { partId, bone, slotId, weaponKey, offset }`；部件几何（assetId/宽高）在 `skeletonParts` 定义一次，物品只挂引用。改造型只改 part，不动物品。
3. **编辑器左侧**：默认显示「部件库」（按 category 分组：head/torso/arm/weapon/…），原图片库折叠为「素材」Tab（底层兜底）。
4. **向后兼容**：player.json 槽位 attachment 新增可选 `partId`；加载先查 partId→part.assetId，查不到回退旧 assetId。无 partId 的旧槽位继续工作。

## Schema 变更

**`library.json`** 新增 `skeletonParts` 数组（自动并入 DefinitionRepository，因 `CanonicalSnapshot.js:39` 已遍历 `project.library.*`）：

```jsonc
"skeletonParts": [
  { "id": "part.head.front", "category": "head", "direction": "front",
    "assetId": "player.parts.head-front", "width": 64, "height": 64, "tags": ["body"] },
  { "id": "part.weapon.axe", "category": "weapon", "weaponKey": "axe",
    "assetId": "player.parts.weapon-axe", "width": 64, "height": 64 }
]
```

**items 数组**新增可选字段：

```jsonc
"skeletonPart": { "partId": "part.weapon.axe", "bone": "armFR",
  "slotId": "toolHand", "weaponKey": "axe", "offset": { "x": 17.8, "y": -7.2, "rot": 0 } }
```

**player.json** 槽位 attachment 新增可选 `partId`。

## 分阶段实施

### P1 数据底座
- 新建 `src/animation/SkeletonPartResolver.js`：`resolvePart(partId)` → `{ assetId, width, height, weaponKey }`，`resolveItemPart(item)` → 优先 `item.skeletonPart`，回退 `weaponKey/toolType`。
- `example/sanguo_zhangjiao/project/library.json`：写入 part.head-front/side/back、part.torso、part.arm\*、part.weapon.axe/spear 记录；`tool.worn_axe`、`weapon.wolf_fang` 等补 `skeletonPart`。
- `example/sanguo_zhangjiao/assets/skeletons/player.json`：槽位补 `partId`。

### P2 运行时
- `src/animation/PlayerSkeletonStateMapper.js`：`weaponKeyOf` 优先读 `item.skeletonPart.weaponKey`；`updateWeaponSlots` 支持 partId 直查槽位（优先）+ weaponKey 正则（兜底）。
- `src/systems/items/ItemRuntimeFactory.js`：`projectPresentation` 若 `definition.skeletonPart` 存在，改用 part 资源尺寸。

### P3 编辑器
- `editor/SkeletonEditorCommandService.js`：加 `fetchLibrary(gameRoot)` → GET `/${gameRoot}/project/library.json`。
- `editor/SkeletonEditor.js`：`_loadManifest` 并行拉取 library.json 构建 `partCatalog`（Map partId→part）；新增 `_renderPartLib`（分组、缩略图、点击「挂到骨骼」→ `_bindPartToSelectedBone(partId)` 创建含 partId 的槽位）；原 `_renderImageLib` 移入折叠「素材」Tab。
- `editor/skeleton-editor.html`：图片库容器改为 Tab 容器（部件库/素材）。
- 槽位属性面板补 partId 只读显示。

### P4 兼容
- 旧 player.json（无 partId）运行结果与基线一致。
- 编辑器保存时不强制迁移；新挂的部件写入 partId。

## 关键文件

- `editor/SkeletonEditor.js`、`editor/SkeletonEditorCommandService.js`、`editor/skeleton-editor.html`
- `src/animation/PlayerSkeletonStateMapper.js`、`src/animation/SkeletonPartResolver.js`（新增）
- `src/systems/items/ItemRuntimeFactory.js`
- `example/sanguo_zhangjiao/project/library.json`、`example/sanguo_zhangjiao/assets/skeletons/player.json`

## 验证

1. 单测：`SkeletonPartResolver` 对 `part.weapon.axe` 返回正确 assetId/offset；Mapper 在只有 `skeletonPart.weaponKey`（无 weaponKey/toolType）时正确切槽。
2. 手测：编辑器部件库点 axe → 挂到 armFR，保存后 player.json 含 partId；游戏内装备/卸下 axe 时 toolHand 槽显隐正确。
3. 回归：`npx vitest run src/animation` 全过。
