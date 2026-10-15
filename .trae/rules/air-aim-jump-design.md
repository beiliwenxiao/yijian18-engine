# 按下即跳跳跃系统设计（大跳 / 二段跳 / 空中轻推转向）

> v2.2（2026-10-16 三次变更）：**恢复滞空方向控制，语义为「轻推+惯性」**——方向键/右键/
> 左摇杆在滞空中仍可转向，但响应强度低于行走（衰减），且起跳方向保留主导权（一阶响应，
> 渐进转向，剩余距离守恒）。非 v2 的瞬时旋转，也非 v2.1 的完全锁定。
> v2.1：滞空微调废弃（已被 v2.2 取代）；v2：取消 v1 的「按住悬停瞄准 + 子弹时间」整链。

## 1. 背景与诉求（2026-10-16 用户原话）

1. 起跳按下（空格/Y 键）就触发。
2. 起跳后，如果按空格键时间超过 0.3 秒，会变成大跳，跳出最远距离。
3. 起跳后，0.5 秒内再次按跳，可以形成 2 段跳。2 段跳相当于再跳一次。
4. v2.2：起跳后，方向键/右键/左摇杆，还是可以控制方向，**但比直接行走时控制得要轻一些，
   仍然要保持落下的惯性**。

核心语义：跳跃方向是**惯性主导、输入轻推**的——起跳瞬间方向获得主导权，滞空输入只按
衰减强度渐进偏转它（blend 矢量混合，时间积分）；落点随之缓慢旋转，剩余飞行距离守恒。

## 2. 现状盘点 → v2.2 处置

| 模块 | v2.1 状态 | v2.2 处置 |
|------|-----------|-----------|
| **AirAimController** | T1/T2/T3，无滞空输入 | +T4 连续轻推（键盘/摇杆，blend=strength×dt）；+T5 右键/触点单次推（blend=pointerBlend）；+setSteerCallback |
| **JumpSystem** | extendJumpTo + relocateJump | +`steerJump(entity, {direction, blend})`：矢量混合转向原语（距离守恒、反向死区、原地跳可拉向输入） |
| **SceneFramePipeline** | update 无 dt | 传 dt（blend 时间积分） |
| **SceneGameplaySystemAssembler** | 三回调 | +steer 回调接线 |
| **BaseGameSceneBehaviors / SceneInputFlow** | chargedJump 通道已删 | 恢复为 airSteer 通道（AIMING 优先级，右键/触点推方向） |
| **SceneRenderPipeline** | 无渲染 | 不恢复落点标记（轻推无需瞄准 UI） |

## 3. 状态机定义

```
ON_GROUND --按下跳键--> JUMPING --持续按住≥bigJumpHoldMs--> JUMPING(升级大跳)
                        |--0.5s内再次按下(上升沿)--> JUMPING(二段跳, 限一次)
                        |--方向键/摇杆持续--> JUMPING(轻推转向: 渐进, 距离守恒)
                        |--右键/触点点击--> JUMPING(单次较强推方向)
                        +--落地(progress≥1)--> ON_GROUND
```

| # | 当前态 | 触发条件 | 动作 |
|---|--------|----------|------|
| T1 | ON_GROUND | 跳键**按下沿** | 立即 `startJump` 短跳：方向=移动输入（无输入=朝向原地跳），distance=`pressJump.distance`；发 `jump.performed` |
| T2 | JUMPING | 跳键**保持按住** holdMs ≥ `bigJumpHoldMs`(300) 且本段未升级 | **大跳升级**：`extendJumpTo(maxJumpDistance)`；发 `jump.big` |
| T3 | JUMPING | 松手后再**按下沿**，距首跳 ≤ `doubleJumpWindowMs`(500)，未二段跳过 | **二段跳**：`relocateJump` 从空中位置再跳一段；发 `jump.double` |
| T4 | JUMPING | 方向键/左摇杆**持续输入**（每帧） | **空中轻推**：`steerJump {direction, blend: strength×dt}`——渐进转向，剩余距离守恒；不发事件 |
| T5 | JUMPING | 右键/触点**点击**（AIMING 指针通道） | **单次推方向**：`steerJump {direction: 点击方向, blend: pointerBlend}`——比连续输入强一档，仍非瞬时对齐 |
| T6 | JUMPING | 落地 progress ≥ 1 | 落地烟尘；`jump.landed`；二段跳加发 `jump.relocate.landed` |
| T7 | JUMPING | 死亡/对话/冥想/切场景（blocked） | 停止跟踪，跳跃自然落地 |

## 4. 时序与距离参数（可配置，scene.airAimConfig 覆盖）

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `pressJump.distance` | 84 | 按下即跳的短跳距离 |
| `pressJump.duration` | 0.6 | 短跳时长 |
| `bigJumpHoldMs` | 300 | 按住多久触发大跳升级 |
| `doubleJumpWindowMs` | 500 | 首次起跳后多久内允许二段跳 |
| `maxJumpDistance` | 120 | 大跳最远距离 |
| `airSteer.strength` | 1.2 | 连续轻推强度（/秒）——0.6s 全程按住约转一半方向；越小惯性越强 |
| `airSteer.pointerBlend` | 0.5 | 右键/触点单次推的混合比——一次点击转一半，剩余保留惯性 |

## 5. 输入映射

| 平台 | 起跳（T1） | 大跳（T2） | 二段跳（T3） | 轻推（T4） | 单次推（T5） |
|------|-----------|-----------|-------------|-----------|-------------|
| PC | 空格按下 | 按住 ≥0.3s | 0.5s 内再按 | WASD 持续 | 右键点击 |
| 手柄 | Y 按下 | 按住不放 | 再按 Y | 左摇杆持续 | — |
| 触屏 | 虚拟键按下 | 按住不放 | 再按虚拟键 | 虚拟摇杆持续 | 触点点击 |

## 6. 落点规则与实现原语（JumpSystem）

- **`steerJump(entity, {direction, blend})`（轻推原语，v2.2 核心）**：把当前跳跃方向与输入
  方向做**矢量混合**（blend ∈ (0,1]，1=行走式即时改向）：
  - 距离守恒：剩余水平总量不变，落点随方向旋转；
  - 惯性：blend<1 时起跳方向保留主导权（一阶响应，转向需要时间）；
  - 反向死区：输入正反且 blend=0.5 时矢量抵消 → 保持原方向（空中无法"刹车"）；
  - 原地跳（direction={0,0}）可被轻推拉向输入方向。
  键盘/摇杆每帧传 `blend = strength × dt`（时间积分）；右键/触点单次传 `blend = pointerBlend`。
- **`extendJumpTo(entity, totalDistance)`（大跳）**：剩余距离拉满，重力弧线照常。
- **`relocateJump(entity, direction, options)`（二段跳）**：从空中点续起新段。
- **合法性**：滞空位移逐帧增量 + 碰撞修正，天然不穿墙。

## 7. 表现层

- 无落点标记渲染（轻推是手感机制，无需瞄准 UI）。
- 大跳升级瞬间可加音效/拖尾（后续表现迭代项）。
- 远程玩家（网络版二期）：按 `PLAYER_SYNC` 跳跃 state 插值渲染。

## 8. 网络版（二期，随联机排期）

| 项 | 方案 |
|----|------|
| 状态同步 | 跳跃 state 增发 `{dirX, dirY, distance, phase}`，客户端按 100ms 快照插值（轻推细节本地预测） |
| 动作消息 | `jump_big {}`、`jump_double {dirX,dirY}` 走 PLAYER_ACTION；轻推走状态同步不走动作 |
| 服务器校验 | 大跳/二段跳次数限制、distance ≤ maxJumpDistance、二段跳窗口计时 |
| 时钟 | 0.3s/0.5s 阈值以服务器时钟为准，客户端预测 + reconcile |

## 9. 事件输出（策划编排用）

| 事件 | payload | 触发 |
|------|---------|------|
| `jump.performed` | {entity} | T1 起跳（沿用） |
| `jump.big` | {entity, distance} | T2 大跳升级 |
| `jump.double` | {entity} | T3 二段跳 |
| `jump.landed` | {entity, from, to} | T6 落地（沿用） |
| `jump.relocate.landed` | {entity, from, to} | T6 二段跳落地 |

轻推（T4/T5）不发事件（高频/手感级输入）。

## 10. 实现落点（v2.2 改动清单，已实施）

1. **JumpSystem**：新增 `steerJump`（矢量混合原语）。
2. **AirAimController**：`setSteerCallback`；update 加 dt（blend=strength×dt 积分）；
   `canSteer`/`steerTowardsPointer`（右键/触点单次推，blend=pointerBlend）。
3. **SceneGameplaySystemAssembler**：steer 回调接线（→ steerJump）。
4. **SceneFramePipeline**：update 传 dt。
5. **BaseGameSceneBehaviors / SceneInputFlow**：恢复 AIMING 指针通道（airSteer，
   右键/触点推方向——与 v2 chargedJump 同优先级不同语义）。

## 11. 决策点（v2.2 后）

| # | 决策 | 取值 |
|---|------|------|
| ① | 大跳弧线不改 duration/peakHeight | 不变——中途改高度会穿帮 |
| ② | 二段跳后可再升级大跳 | 能（每段一次） |
| ③ | 二段跳次数 | 每次落地前限 1 次 |
| ④ | 轻推强度量化 | strength 1.2/s（0.6s 转一半）——策划可在 airAimConfig 调；低于行走响应（行走=即时） |
| ⑤ | 右键语义 | 推方向（单次 blend 0.5），非 v2 的"指定落点"——保持惯性，不会瞬移对齐点击点 |
| ⑥ | 空中刹车 | 不支持——反向死区保持原方向（跳跃无刹车，符合物理直觉） |
| ⑦ | 跳跃冷却 | 沿用现有，独立配置项待网络版统一定 |
