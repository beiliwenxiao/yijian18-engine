# 动作×方向动画抽象层设计（Animation Action/Direction Abstraction）

> 状态：已实施 · 2026-11-05
> 需求：①将角色的「动作、方向」抽象出来，具体实现可以是骨骼动画或序列帧；②动作是主键、
> 方向是次键——一个动作可以有多个方向，也可以只有一个方向；③方向向下挂载对应的骨骼剪辑
> 或序列帧；④根据游戏中的具体情况自由切换序列帧/骨骼动画。

## 1. 现状盘点（勘察实证）

动作×方向的解析逻辑此前在**三处各写一份**，语义相近但互不共享：

| 位置 | 实现载体 | 方向解析方式 | 缺口 |
|------|----------|--------------|------|
| [PlayerSkeletonStateMapper](file:///d:/yijian18-engine/src/animation/PlayerSkeletonStateMapper.js)（部件骨骼） | `asset.clips`（Map，骨骼剪辑） | 手拼 `` `walk_${moveKey}` `` + 手写斜向回退 | 离散动作（attack/gather…）**无方向变体解析**；回退链硬编码 |
| [PlayerLpcFrameMapper](file:///d:/yijian18-engine/src/animation/PlayerLpcFrameMapper.js)（整帧序列，meta.frameMode） | `meta.clipFrames[clip].dirs`（帧表） | 硬编码 IDLE_CLIPS/WALK_CLIPS 表 + DIRECTION_MAP | 剪辑名选择与部件模式重复实现 |
| 纯序列帧（SpriteComponent 4x9/旧格式） | `sprite.animations` + 图集行列 | `directionRowMap` 渲染层按行取 | 动作无方向后缀概念（行即方向） |

- 触发入口已统一：`sprite.playAnimation(action)` → 骨骼实体经 SpriteComponent 兼容转发
  `skeletonDelegate.playClip`（系统侧 24 处调用零改动的基础）。
- 运行时切换缺口：EntityFactory 只有 `setSkeletonForEntity`（骨架→骨架）；
  `sprite.animations` 在挂骨骼时被 clear，**无法切回序列帧**。

## 2. 抽象模型（定案）

```
动作 action（主键）  ：walk / idle / attack / jump / death / climb_back / gather …
方向 direction（次键）：8 朝向字符串（down/left/right/up + 四斜向）→ 形态键（SkeletonDirection）
                        形态键 = down/side/up/SE/SW/NE/NW（+sideL 免镜像，仅附件用）
实现 implementation  ：骨骼剪辑（asset.clips）｜整帧帧表（meta.clipFrames）｜纯序列帧（图集行列）
```

**动作的方向基数由资产自由声明**（引擎逐级探测，不要求资产配齐）：

| 资产形态 | 剪辑命名 | 例 |
|----------|----------|-----|
| 多方向动作 | `${action}_${形态键}` | walk_down / walk_side / walk_SE / attack_side |
| 单方向动作 | 仅 `${action}` | death / soul / climb_back / jump / attack |
| 混合 | 两者共存 | attack + attack_side（触发时按朝向择优） |

**回退链**（`resolveActionClip`，两实现共用同一语义）：

```
① ${action}_${dirKey}                      精确形态（含 8 形态）
② ${action}_${SKELETON_DIAGONAL_FALLBACK}  斜向回退（SE→down、NE→up；正/背/侧无此级）
③ ${action}                                单方向动作
④ null → 调用方回退 defaultClip / 跳过
```

## 3. 实现落点

### 3.1 AnimationActionResolver（新，`src/animation/AnimationActionResolver.js`）

纯函数模块，**双实现探测**——同一查询对骨骼/整帧资产都成立：

| API | 语义 |
|-----|------|
| `hasClip(asset, name)` | `asset.clips`（Map）或 `meta.clipFrames[name]` 任一存在即为有 |
| `resolveActionClip(asset, action, direction)` | 动作×方向 → `{clip, dirKey}`；按 §2 回退链；入参是**原始朝向**（内部 resolveDirectionKey） |
| `resolveDiscreteClip(asset, requestedName, direction)` | 外部 playClip 请求名 → `{clip, base}`：裸动作名优先升级方向变体；带形态后缀的名精确命中优先，缺失降级裸动作；剥离后缀仅认已知形态键（`sit_down` 这类动作名不受误伤） |

### 3.2 PlayerSkeletonStateMapper（部件骨骼）改造

- **连续状态链**（death > soul > climb > jump > walk > idle）：walk/idle/death/soul/climb
  全部经 `resolveActionClip` 选片（jump 沿用 SkeletonJumpClip——它本就是 jump 动作的
  专用解析器，回退链与 resolver 同构）；删除手写拼接与 `walk_|idle_` 前缀猜测回退。
  附带修正：death/soul 剪辑缺失时不再错落回 `idle_down`，直接走 defaultClip。
- **离散动作方向变体（新能力）**：外部 `playAnimation('attack')` 进入 mapperHold 时，
  经 `resolveDiscreteClip` 按当前朝向解析一次——资产有 `attack_side` 就播方向版，
  只有裸 `attack` 就播裸版；**保持期内不跟随转向**（攻击锁朝向，动作游戏惯例），
  连续状态（walk/idle）仍逐帧跟向。
- **连续动作裸名守卫**：AI/移动系统会对骨骼实体调 `playAnimation('walk'/'idle')`
  （裸名），裸名直接视为连续状态放行给映射器接管（不进 hold），避免方向变体升级后
  循环剪辑永久 hold 卡死转向。

### 3.3 PlayerLpcFrameMapper（整帧序列）改造

连续剪辑名（idle/walk）改经 `resolveActionClip`（与部件模式同回退链：
walk_SE 缺失 → walk_down → walk）；
离散剪辑维持 `clipFrames[clip].dirs[dirKey]` 逐方向帧表（该实现天然支持任意动作多方向）。

### 3.4 EntityFactory.setAnimationModeForEntity（运行时自由切换）

```
setAnimationModeForEntity(entity, mode, stableSpriteId)
  ├─ mode === 'skeleton' → setSkeletonForEntity（既有：重建 SkeletonComponent + 映射器；
  │                         整帧资产（meta.frameMode）同样走此路，映射器自动分流 LPC）
  └─ mode === 'sprite'   → _detachSkeletonForFrame（新）：
                            removeComponent('skeleton') → isSkeleton=false、清 skeletonDelegate
                            → 恢复 sprite.animations（addCharacterAnimations）→ 复位 idle 首帧
```

- 切换语义：**动作×方向抽象不变**——系统侧 `playAnimation('walk')` 等调用在两种实现上
  都成立（骨骼=映射器选片，序列帧= animations 表 + directionRowMap 行列）。
- 采集/武器挂点等依赖骨骼槽位的表现随实现切换自然失效/恢复（调用方按剧情/性能场景决定时机）。

### 3.5 骨骼编辑器可视化（2026-11-05 补）

编辑器（[SkeletonEditor.js](file:///d:/yijian18-engine/editor/SkeletonEditor.js)）把
「动作→方向→实现」三级关系显式呈现：

| 改动 | 语义 |
|------|------|
| 剪辑下拉两级分组 | 一级组=动作（stripFormSuffix 剥离方向后缀），组内按方向顺序排列；纯裸剪辑动作组标注「（单方向）」——动作为主键、方向为次键直接可见 |
| 动作覆盖条（新 DOM） | 骨骼模式 `se-action-coverage` / 帧模式 `se-fr-coverage`：当前动作 8 形态徽章——**亮绿**=该方向有实现（点击直达）、**灰（SE→down）**=缺失但运行时按回退链命中、**暗红**=完全缺失无回退；单方向动作显示「单方向」+ 镜像/帧表提示 |
| 实现标识 | 覆盖条尾「实现：骨骼剪辑 / 整帧帧表（meta.clipFrames）」——帧模式方向帧表覆盖按 dirs 键判定 |
| _addClip 提示语 | 带动作_方向命名约定（多方向 `walk_side`/单方向裸名 `attack`），命名即运行时解析契约 |
| 帧面板挂点快速切换 | 「挂点」下拉列出全部 sequence 挂点（含帧数），选中即聚焦属性面板/画布——不同挂点序列帧免翻找 |
| 序列帧路径可见可改 | ①挂点属性「路径」行改输入框（原只读）：按源文件路径匹配图片库即切换（精确 + 唯一后缀命中），序列帧换图自动清帧表重切；②帧模式「帧图」下拉 + 路径输入写 `meta.frameAssetId`（帧条重建签名显式失效） |

- 编辑器与运行时共用 `AnimationActionResolver.stripFormSuffix` + `SkeletonDirection.SKELETON_DIAGONAL_FALLBACK`，
  保证「编辑器所见 = 运行时所得」（同一回退语义，无两处漂移）。

## 4. 不变式（零回归承诺）

1. 系统侧触发入口不变：`sprite.playAnimation(action)`，24 处调用点零改动。
2. 已有资产行为不变：只有 `idle_down`/`walk_side` 的资产，回退链命中结果与旧手拼一致。
3. jump 解析沿用 SkeletonJumpClip（jump_形态 → 裸 jump → null）；`meta.noMirrorFacing`、
   头部三态、背挂换边、mapperHold 时长逻辑全部不动。
4. 武器/头部槽位联动测试（PlayerSkeletonStateMapper.test.js 31 例）全绿。

## 5. 验证

- `AnimationActionResolver.test.js`（新）：hasClip 双实现 / 多方向精确 / 斜向回退 /
  单方向回退 / null / resolveDiscreteClip 升级·降级·后缀名保护。
- 既有回归：animation 目录全量 + EntityFactory 相关测试。
