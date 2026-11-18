# 装备上身视觉链路与对位流程设计（Equipment Visual Slots）

> 状态：已实施（P1）· 2026-11-18
> 需求：①装备武器/防具时，武器/衣物出现在人物身上；②装备部件与本体部件精确对位，换美术可一键重新对位。
> 分期：P1 预建槽位 + 映射器联动（已实施）；P2 动态虚拟槽位（任意装备挂任意骨架，待排期）。

## 1. 现状盘点 → P1 处置

| 模块 | P1 前 | P1 后 |
|------|-------|-------|
| 武器上身 | ✅ 已通：物品 `skeletonPart.weaponKey` → 骨架预建 `weapon-{key}` 槽位 → 映射器写 visible 覆盖（手持/腰挂/背挂） | 不变 |
| 衣物/防具 | ❌ 三缺口：物品无部件绑定、骨架无防具槽位、覆盖层不支持换图 | 全部补齐（见 §3/§4） |
| 内容库主角模型 | 角色固定 CharactersConfig[0]（整帧 female-hero） | ✅ `library.players[].skeletonId` 直接换模型（[DemoPlayerFactory.applyLibraryDefinition](file:///d:/yijian18-engine/example/sanguo_zhangjiao/entities/DemoPlayerFactory.js) → `setSkeletonForEntity`，读档路径同样生效；`visual` 为显示尺寸唯一权威） |

## 2. 数据模型与约定

### 2.1 防具槽位命名约定（与武器槽同风格，编辑器所见即所得）

| 骨架槽位 ID | 挂点骨骼 | z | 覆盖目标 |
|-------------|---------|---|---------|
| `armorTorso` | chest | 25 | 躯干（torsoSlot z21 之上） |
| `armorSkirt` | spine | 26 | 腰裙（skirtFront z22 之上） |
| `armorBootL` / `armorBootR` | footL / footR | 13 | 左/右脚（foot 槽 z12 之上） |
| `helmet` | head | 14 | 头部（hair 槽 z13 之上） |

- 识别规则 = **槽位 ID 前缀约定**（映射器内置映射表），新防具槽位在骨骼编辑器加完即被联动识别。
- 骨架未预建对应槽位的旧资产：装备不上身、零回归（与武器收纳槽缺失同语义）。

### 2.2 装备槽 → 防具槽位映射（映射器内置，物品声明可覆盖）

| EquipmentComponent 槽 | subType | 骨架防具槽位 |
|----------------------|---------|-------------|
| `armor` | armor | armorTorso |
| `pants` | pants / skirt | armorSkirt |
| `boots` | boots | armorBootL + armorBootR（两槽共用同一件装备部件图） |
| `helmet` | helmet | helmet |
| `accessory` | accessory | **无默认映射**——物品 `skeletonPart.slots` 显式声明才上身（护腕 `['armorWristL','armorWristR']`；戒指/项链无声明不上身） |
| belt / ring / necklace… | — | 同上，声明即上身 |

### 2.3 物品绑定：`skeletonPart` 视觉块

```jsonc
"skeletonPart": {
  "assetId": "player.parts.wolf-hide-vest",  // 物品自带部件图（优先）
  "width": 64, "height": 64,                 // 绘制尺寸（缺省用图片原尺寸）
  "directionOffsets": { "side": {...} },     // 可选 5 方向形态覆盖（缺省回退基准图）
  "slots": ["armorWristL", "armorWristR"],   // 可选：显式声明骨架槽位（优先于装备槽 kind 映射表；
                                             //   饰品类上身的唯一途径——声明即意图，新槽位零映射器改动）
  "partId": "part.armor.leather",            // 可选：引用部件库 assetId（无 assetId 时的回退路径）
  "weaponKey": "axe"                         // 武器类沿用（武器上身走既有链路）
}
```

- 部件画布约定：**64×64、图片中心 = 骨骼挂点**（与角色部件一致）。
- 解析入口：[SkeletonPartResolver.resolveItemVisual](file:///d:/yijian18-engine/src/animation/SkeletonPartResolver.js)（assetId 优先 → partId→部件库回退）。

## 3. 实现落点

1. **映射器防具联动**（[PlayerSkeletonStateMapper](file:///d:/yijian18-engine/src/animation/PlayerSkeletonStateMapper.js)）：
   `resolveArmorState` 装备签名（armor/pants/boots/helmet/**accessory** 五槽物品标识拼接）守卫——签名变化才写覆盖层，穿/脱下一帧自动生效，无需事件；
   `updateArmorSlots` 写换图覆盖（有装备→`{visible:true, type:'image', assetId, width, height, directionOffsets?}`；未装备/无绑定→`{visible:false, type:'empty', assetId:''}`）；
   目标槽位 = 物品 `skeletonPart.slots` 显式声明 > 装备槽 kind 映射表；
   **残留清理**：`updateArmorSlots` 返回本轮换图槽位集合，签名变化时对「上轮已写、本轮不再覆盖」的槽位补写隐藏
   （卸下 slots 声明的装备时声明信息丢失，靠上轮集合恢复）。
2. **覆盖层换图契约**（[SkeletonComponent.setSlotOverride](file:///d:/yijian18-engine/src/ecs/components/SkeletonComponent.js)）：patch 在状态覆盖（visible/flipX/frames…）之外正式支持
   `{type, assetId, width, height, directionOffsets}`——经 `resolveSlotAttachment` 的 spread 合并生效，
   实现实体级部件替换（empty 槽位写 type:'image' 即挂上装备部件图）。调用方须传稳定引用、内容变化才调用。
3. **骨架预建槽位**（[player.json](file:///d:/yijian18-engine/example/sanguo_zhangjiao/assets/skeletons/player.json)）：
   armorTorso z25 / armorSkirt z26 / armorBootL·R z13 / helmet z14 / armorWristL z16·armorWristR z25，
   防具槽位附件指向默认防具部件图（编辑器所见即所得；运行时由映射器接管，未装备自动隐藏）。
4. **狼皮装备四件套**：[gen-wolf-hide-armor-parts.mjs](file:///d:/yijian18-engine/scripts/gen-wolf-hide-armor-parts.mjs)
   程序化生成 64×64 部件图（vest/skirt/boots/bracers + manifest 幂等登记）；library.json 四件装备补 `skeletonPart` 绑定
   （护腕走 `slots` 显式声明）。

### 3.1 骨架级装备皮 meta.armorSkinByAsset（2026-11-18，装备尺寸随角色体型）

**问题**：装备部件图是按某个角色体型画的（狼皮四件套按旧 player 体型）——套到体型差异大的骨架
（skeleton.player-girl-001 纤细体型）上比例失衡。装备物品的定义（library.json）是全局的，
不能为每个骨架出一套物品定义。

**方案**：骨架 JSON `meta.armorSkinByAsset` 声明「全局装备 assetId → 本骨架专属三形态部件」——
映射器换图时 skin 接管；骨架无此 meta 走物品原部件（零回归）。

```jsonc
// player-girl-001.json meta 节选
"armorSkinByAsset": {
  "player.parts.wolf-hide-vest":   { "front": "player-girl-001.parts.armor-vest-front",
                                     "side": "...-side", "up": "...-up" }
}
```

- **映射器接管**（[PlayerSkeletonStateMapper.updateArmorSlots](file:///d:/yijian18-engine/src/animation/PlayerSkeletonStateMapper.js)）：
  skin 存在 → patch 写 `{assetId: skin.front, x:0, y:0, directionOffsets:{side,up}}`——
  **rot 不写入**（顶层 spread 合并缺省键沿用基础附件 → 骨骼自转补偿保留：foot 骨 −90° 的靴 +90 /
  前臂 ±4° 的护腕 ∓4）；skin.side/up 条目只带 assetId（渲染器形态条目按字段合并，x/y/rot 沿用）；
  斜向（SE/SW/NE/NW）未配 → 回退正面基准（渲染器既有口径）。
- **基础附件同步**（编辑器所见=运行时所得）：girl-001 JSON 防具槽位附件已指向装备皮新图
  （x/y=0、rot 保留补偿、directionOffsets 只带 side/up）。
- **装备皮部件来源**（[gen-player-girl-001.mjs](file:///d:/yijian18-engine/scripts/gen-player-girl-001.mjs)）：
  从「主角女2.png」（girl-001 穿狼皮套三视图，身体为浅绿幽灵剪影）差分素体切出——
  ①幽灵/绿幕残留键控（阈值 g>r+12：幽灵 g−r>22，绿褐毛皮 g−r≈0~10 不能误杀）；
  ②按素体各 form 的实际缩放比缩放装备内容 + 脚底对齐 y95、中轴对齐（两源图人物大小不同，
  不能各自压满 96px）；③差分素体（素体透明或 sum 色差>40 → 装备像素；阈值高了会误剔贴身
  皮革——护腕/靴筒与阴影皮肤 diff≈50~60）；④按装备锚点 Voronoi 分派（vest→chest /
  skirt→spine / boots→footR / bracers→forearmR，yRange 区域约束 + xMin 避开躯干柱；
  L 侧锚点 dispatch-only 抢像素不落画布——左右槽共用 R 侧图）。

## 4. 对位流程（换美术 → 一键重新对位）

[tune-armor-slot-offsets.mjs](file:///d:/yijian18-engine/scripts/tune-armor-slot-offsets.mjs)：按渲染器同款变换链自动求防具槽位 `x/y/rot` 并写回骨架 JSON。

```bash
node scripts/tune-armor-slot-offsets.mjs          # dry-run 打印计算结果
node scripts/tune-armor-slot-offsets.mjs --apply  # 写回 player.json
```

- **变换链**（与 `SkeletonRenderer._attachmentAnchor` 一致）：
  锚点世界 = 骨骼世界位置 + R(骨骼世界旋转) · 附件偏移；
  内容中心世界 = 锚点世界 + R(骨骼世界旋转 + 附件 rot) · (内容bbox中心 − 图片中心)。
- **对齐规则**：防具内容中心 = 被覆盖本体部件的内容中心（静止姿态）。
- **脚骨自转抵消**：footL/footR 骨骼自带 rot −90°，脚本自动给防具附件写 rot +90° 抵消（靴图直立绘制）。
- **任意尺寸部件图兼容**：本体/防具图都按 PNG 实际尺寸与 alpha 包围盒计算（foot-down 实际 12×5，非 64×64）。
- **合成验证**：`node Temp/render-armor-alignment.mjs` 输出 4× 静止姿态合成图（渲染链同款数学），目检对位。

## 5. 验证

- 单测：[PlayerSkeletonStateMapper.test.js](file:///d:/yijian18-engine/src/animation/PlayerSkeletonStateMapper.test.js) 防具 12 用例
  （穿胸甲换图 / 靴子双槽共用 / 卸下恢复 / directionOffsets 透传 / 无绑定不上身 / 旧骨架不炸 /
  护腕 slots 声明上身 / 无声明饰品不上身 / 声明优先于映射表 / 同会话卸下残留清理 /
  装备皮换图接管+xy归零+rot沿用 / 装备皮只配 front 不写 directionOffsets+卸下隐藏），
  animation+渲染器+校验器相关 204/204 全绿。
- 游戏内实测：读档 → 控制台/装备栏穿狼皮装备 → 下一帧槽位覆盖生效；内容库 `players[].skeletonId='skeleton.player'`
  换模型后防具槽位随骨架生效（读档路径同样生效）。
- 对位目检：`node Temp/render-armor-alignment.mjs` 输出 4× 静止姿态合成图（渲染链同款数学）。
- 装备皮目检：`node scripts/gen-player-girl-001.mjs` 末尾输出素体 + 穿戴两张合成预览
  （Temp/player-girl-001-preview.png / -worn-preview.png，4×）；装备皮贴合 girl-001 身形
  （背心毛领/裙/双护腕/双靴随骨架锚点落位），旧 player 骨架无 meta 零回归。

## 6. 边界与后续

- **整帧 LPC 资产**（如 skeleton.female-hero，单 frame 槽）不走本链路——整帧装备层是 LPC 帧合成，独立迭代。
- **P2 动态虚拟槽位**：SkeletonComponent 增加 dynamicSlots 覆盖层，装备变化按 `item.skeletonPart {bone, slotId}` 运行时注册虚拟槽位——
  免逐骨架预建槽位、装备跨角色通用；P1 的槽位配置即 P2 的默认绑定数据。
- **5 方向装备图**：斜向行走的装备形态由物品 `skeletonPart.directionOffsets` 提供（同 skirt-girl 批量导入流程出图）；
  缺省回退基准图。
- 武器上身沿用既有链路（parseWeaponSlot / WEAPON_CARRY 收纳位），与防具联动互不干扰。
- 运行时镜像语义（「有配置用配置，无配置走镜像」）见 [animation-action-direction-abstraction.md](file:///d:/yijian18-engine/.trae/rules/animation-action-direction-abstraction.md) 2026-11-17 条目。
