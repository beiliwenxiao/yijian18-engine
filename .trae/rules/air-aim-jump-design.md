---
inclusion: fileMatch
fileMatchPattern: "**/*{Jump,AirAim,JumpCharge}*.js"
---

# AIR_AIM 悬停瞄准状态机设计（子弹时间跳跃）

## 适用范围

本设计定义新跳跃流程的状态机、输入映射、表现层与网络版方案。核心裁定（已确认）：**网络版不做全局时间缩放，AIR_AIM 是服务器权威的"悬停状态"，子弹时间只是起跳玩家本地的表现层**。实施按第 9 节改动清单另行启动。

## 1. 背景与诉求

> 起跳改为按下（手柄 Y 键，PC 空格键）就触发。如果按下后 0.5 秒后都没有释放（即跳到最高空了），玩家角色进入子弹时间，暂停 3 秒。这时候可以调整落点（PC 端用鼠标右键调整落点），再次释放起跳按钮（PC 释放空格）时，跳到落点。

与现状的本质差异：**现有是"起跳前蓄力瞄准，松手起跳"；新设计是"按下即跳，跳到最高点后悬停瞄准，松手跳向落点"** —— 瞄准时机从起跳前反转为滞空中。

## 2. 现状盘点（真实接口）

| 模块 | 关键接口/事实 | 位置 |
|------|--------------|------|
| **JumpSystem** | `startJump(entity, direction, options{distance,duration,peakHeight,chargeDuration,mode,startProgress})`；elevation 视觉高度 + 地面位移逐帧增量（easeOutQuad），仍被碰撞系统逐帧修正，不穿静态障碍；落点起跳瞬间锁定；`startProgress` 支持从任意进度开播（= 悬停恢复的现成机制） | `src/systems/JumpSystem.js` L74-116, L94-96, L139 |
| **JumpChargeController** | 现流程：按住 0.2s（tapMaxMs）进瞄准、蓄力决定距离 30~120、松手起跳；`setTargetPosition` 距离裁剪、`getAimTarget`、`setJumpCallback` 注入；触屏 `beginTargeting/selectTarget` 点选即跳 | `src/core/scene/JumpChargeController.js` L28-33, L116-119, L139-153 |
| **场景接线** | AIMING 态优先消费指针事件（现为左键/触点）；虚拟跳跃键 `beginTargeting` | `example/sanguo_zhangjiao/scenes/BaseGameSceneBehaviors.js` L337-338, L623 |
| **渲染** | `AimPreviewRenderer.renderRange/renderTarget` 范围圈+落点标记，直接复用 | `src/rendering/AimPreviewRenderer.js` |
| **网络层** | 服务器权威 + 客户端预测/reconcile；100ms `PLAYER_SYNC` 状态广播；`PLAYER_ACTION` 动作通道 | `src/network/NetworkManager.js` L94-104, L178-185, L246-253 |
| **调试开关** | `Logger.log/warn/error` 受 `IS_TEST` 控制，悬停状态机日志统一走它 | `src/core/Logger.js` L30-59 |

**关键结论**：跳跃动画（elevation+逐帧位移）与瞄准 UI 可整体复用；需要重写的是控制器的状态流（触发时机反转）+ JumpSystem 的悬停分支 + 输入键位（PC 落点从左键改右键）。

## 3. 状态机定义

```
ON_GROUND --按下起跳键--> JUMPING --按住≥apexHoldMs--> AIR_AIM --释放键且有落点--> RELOCATE --到达--> ON_GROUND
                            |                            |--超时 aimWindowMs--> JUMPING(恢复原跳跃剩余段) --> ON_GROUND
                            |                            |--打断(死亡/硬控/对话/切场景)--> JUMPING(恢复) 或死亡流程
                            +--提前释放(<apexHoldMs)--> JUMPING 自然落地
```

### 3.1 状态与转换条件（开始/结束条件显式化）

| # | 当前态 | 触发条件 | 次态 | 动作与表现 |
|---|--------|----------|------|-----------|
| T1 | ON_GROUND | 起跳键**按下**（PC空格/手柄Y/触屏按住式键） | JUMPING | 立即 `startJump`：方向=移动输入方向（无输入=朝向，原地跳），距离=`pressJump.distance`；起跳烟尘；发 `jump_aim.press` |
| T2 | JUMPING | 起跳键**释放**（holdMs < apexHoldMs） | JUMPING | 无（本次就是普通短跳，自然落地）；区别仅在于玩家没按住 |
| T3 | JUMPING | **持续按住** holdMs ≥ `apexHoldMs`(300ms) 且未被打断 | AIR_AIM | 冻结跳跃进度（速度=0，重力挂起，停在当前 elevation≈顶点）；启动 `aimWindowMs`(3000) 倒计时；显示范围圈+落点标记；**子弹时间表现层开启**；发 `jump.aim.started` |
| T4 | AIR_AIM | 落点输入（PC右键/手柄摇杆/触屏触点） | AIR_AIM | 更新落点标记，距离按 `aimRange` 裁剪 |
| T5 | AIR_AIM | 起跳键**释放** 且已存在有效落点 | RELOCATE | 以悬停点为起点重新 `startJump` 到落点（方向/距离由落点决定）；子弹时间表现层关闭；发 `jump.aim.ended{reason:'release'}` |
| T6 | AIR_AIM | `aimWindowMs`(3000) 超时未释放 | JUMPING | **恢复原跳跃剩余段**（`startProgress` 续播，落回原落点）；表现层关闭；发 `jump.aim.ended{reason:'timeout'}` |
| T7 | AIR_AIM | 打断：死亡 / 硬控（眩晕击飞）/ 进入对话剧情 / 切场景读档 | 对应流程 | 恢复原跳跃剩余段（死亡则走死亡）；表现层关闭；发 `jump.aim.ended{reason:'interrupt'}` |
| T8 | RELOCATE / JUMPING | 到达落点（progress≥1） | ON_GROUND | 落地烟尘；发 `jump.relocate.landed{from,to}` 或 `jump.landed` |

### 3.2 时序参数（可配置）

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `apexHoldMs` | 300 | 按住多久触发悬停；**基础跳 duration 调至 0.6s 使顶点≈0.3s 与阈值对齐**（2026-10-14 手感调参：1.0s→0.6s，阈值 500ms→300ms） |
| `pressJump.distance` | 84 | 按下即跳的短跳距离（提前松手时的落点），策划可调 |
| `pressJump.duration` | 0.6 | 基础跳时长；顶点出现在 duration/2 |
| `aimWindowMs` | 3000 | 悬停瞄准窗口，服务器真实时间权威 |
| `aimRange` | 120 | 悬停点为圆心的最大重定位距离（沿用现 `maxDistance`） |
| `freezeWorld` | false | 单机可选"真·全局子弹时间"（世界 timeScale=0）；**网络版强制 false** |

## 4. 输入映射

| 平台 | 起跳（T1） | 调整落点（T4） | 执行（T5） |
|------|-----------|----------------|-----------|
| PC | 空格按下 | **鼠标右键**：右键按下即将落点标记移到光标世界坐标，可连续右键微调 | 释放空格 |
| 手柄 | Y 按下 | 左摇杆方向+幅度（复用 `setAimFromAxis`） | 释放 Y |
| 触屏 | 按住式跳跃键 | 触点选择落点 | 释放跳跃键 或 点选即跳（复用 `selectTarget`，见决策点⑤） |

改动点：场景 AIMING 态的指针优先消费（[BaseGameSceneBehaviors.js](file:///d:/yijian18-engine/example/sanguo_zhangjiao/scenes/BaseGameSceneBehaviors.js) L337）由**左键改为右键**，避免与攻击/交互左键冲突；`canSelectTarget` 相应改为 `isRightDown`。

## 5. 落点规则与校验

- **距离裁剪**：目标超出 `aimRange` 时按方向缩放到上限（复用 `getAimTarget` 的 scale 逻辑，[JumpChargeController.js](file:///d:/yijian18-engine/src/core/scene/JumpChargeController.js#L220-L250)）。
- **落点合法性**：落点须 walkable（复用地形 walkable 判定）；非法点吸附到最近合法点（见决策点④）。
- **弧线不穿墙**：RELOCATE 仍走 JumpSystem 逐帧增量位移 + 现有碰撞修正，天然不穿静态障碍，无需额外轨迹检测。

## 6. 表现层（"子弹时间"= 表现，不是时钟）

- **起跳玩家本地**：暗角/去饱和、音效降调、瞄准 UI（范围圈+落点标记+剩余时间环）。世界与其他实体照常速度运行。
- **远程玩家视角**：该角色悬停在最高点（受击框保持），按 `expireAt` 渲染剩余时间；不感知任何"时间变慢"。
- 单机模式可通过 `freezeWorld: true` 开启真·全局子弹时间；网络版该配置强制失效。

## 7. 网络版设计（服务器权威悬停）

**原则**：0.3s 阈值、3s 窗口、落点校验全部以服务器时钟/服务器裁定为准；客户端本地预测整条链路（T1→T5），偏差 reconcile 收敛。悬停期间角色位置冻结，落点数据稳定，`jump_aim_release` 天然幂等。

| 项 | 方案 |
|----|------|
| 状态同步 | `PLAYER_SYNC` 玩家 state 增加 `airAim: { phase:'aim'\|'relocate', expireAt }`；远程玩家据此渲染悬停与倒计时 |
| 动作消息 | `PLAYER_ACTION` 通道：`jump_aim_start {x,y,elevation,expireAt}`、`jump_aim_release {targetX,targetY}`、`jump_aim_timeout {}`（服务器广播） |
| 服务器校验 | 距离上限 `aimRange`、落点 walkable（非法则裁剪/吸附）、跳跃冷却；校验失败回发权威状态 |
| 超时 | 服务器 3s 真实时间到期强制恢复下落，不依赖客户端上报 |
| 断线/掉帧 | 服务器计时不受客户端掉帧影响；重连后按 `airAim` 状态恢复表现 |
| 时钟偏差 | 客户端用本地时钟做 T2/T3 预测（两条路都是合法状态），T3 进入时刻以服务器确认时间为准，倒计时从 `expireAt - now - rtt/2` 推算 |

## 8. 事件输出（策划编排用）

| 事件 | payload | 触发 |
|------|---------|------|
| `jump.aim.started` | `{entity, expireAt}` | T3 进入悬停 |
| `jump.aim.ended` | `{entity, reason: 'release'\|'timeout'\|'interrupt'}` | T5/T6/T7 |
| `jump.relocate.landed` | `{from, to}` | T8 瞄准跳落地 |
| `jump.landed` | `{entity}` | 普通落地（复用现有） |

打断来源枚举：`death / hardcc / dialogue / sceneSwitch`，供触发器 when 条件引用。

## 9. 实现落点（改动清单）

1. **JumpSystem**：active 数据增加 `hover` 分支——`update()` 悬停时不推进 progress、不推进位移；新增 `resumeFromHover(entity)`（等价于按冻结 progress 续播，复用 `startProgress` 语义）；RELOCATE 直接对悬停实体重新 `startJump`（替换 active 条目）。
2. **JumpChargeController → AirAimController**（新文件 `src/core/scene/AirAimController.js`，旧控制器保留直至切换）：保留 `_begin / setTargetPosition / getAimTarget / AimPreviewRenderer`；删除蓄力距离语义（`tapMaxMs/chargeMaxMs/_distanceForHold`）；状态由"按下保持"改为"跳跃中按住超阈值"，`update()` 入参增加 `isJumping`。
3. **BaseGameSceneBehaviors**：AIMING 优先消费改右键；`update` 驱动传入跳跃状态；接 `airAim` 配置块与事件发布。
4. **配置**：场景 config 增加 3.2 节参数块；`pressJump.duration` 调 0.6s 对齐顶点。
5. **网络版（二期）**：NetworkManager 增加上表 action 与 state 字段；服务器校验逻辑独立成可单测的纯函数。
6. **日志**：状态迁移统一 `Logger.log`（受 `IS_TEST` 开关控制）。

## 10. 需策划拍板的决策点

| # | 决策 | 建议 |
|---|------|------|
| ① | 悬停期间是否可被攻击命中 | 可命中——这是瞄准收益的平衡代价 |
| ② | 悬停期间受击是否解除悬停 | 软受击不解除，硬控（眩晕/击飞）解除（T7） |
| ③ | 其他玩家是否可见落点范围圈 | 可见，增强博弈与反制预判 |
| ④ | 非法落点处理 | 吸附最近合法点（保持手感流畅） |
| ⑤ | 触屏执行方式 | 保留点选落点即跳（`selectTarget` 现模式），同时松开跳跃键也执行 |
| ⑥ | 超时行为 | 恢复原跳跃剩余段落回原落点（而非跳向最后标记） |
| ⑦ | 跳跃冷却数值 | 独立配置项，网络版服务器校验同值 |
