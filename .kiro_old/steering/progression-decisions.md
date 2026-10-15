---
inclusion: manual
---

# 成长与位移系统已确认决策

本文件记录用户已拍板的选择，后续实现必须遵循。总体方案见 #[[file:optimization-plan-b-plus.md]]，通用规则见 #[[file:progression-system.md]]。

## 已确认选项

| 编号 | 决策项 | 选择 |
|---|---|---|
| 1 | 位移能力方案 | A：跳跃、用力跳跃、轻功、攀爬四种独立能力 |
| 2 | 生活技能方案 | A：熟练度 + 配方 + 天赋盘被动，不消耗战斗点数 |
| 3 | 实施时机 | A：在 S1–S4 成长内核完成后作为首个验证内容 |
| 4 | 职业与兵种建模 | A：职业天赋 + 兵种天赋两层，弓骑兵为交叉解锁 |
| 5 | 兵种天赋形式 | C：兵种树负责解锁，POE 盘负责数值 |
| 6 | 兵种点来源 | A：由参战与战役行为获得 |
| 7 | 箭楼建模 | 只有一种箭楼：建筑类工事，同时可载人 |
| 8 | Demo 是否启用天赋盘 | 启用，四类成长结构全部在 Demo 中可用 |
| 9 | 烹饪实现时机 | 留到 Demo 之后，本轮只做采集熟练度 |
| 10 | 起始阶段 | S1 起步，先实现 `EffectResolver` |
| 11 | 新成长内容位置 | 放在 `example/sanguo_zhangjiao`，不新建 example |
| 12 | 天赋盘首版节点数 | 45 个节点 |
| 13 | 默认 Profile | `arpg` |
| 14 | 重构授权 | 允许直接修改现有系统，不必只做旁路新增 |

## 14. 重构授权

重构期间可以直接修改 `src` 下的现有系统，包括 `SkillTreeSystem`、`TalentSystem`、`ClassSystem`、`AttributeSystem`、`FlightSystem`、`InputManager`、`ProgressManager` 等。

仍需遵守的边界：

- 保持现有对外方法可用，或在同一次改动中更新全部调用点。
- 现有 Vitest 用例必须继续通过，行为变化需同步更新用例。
- 旧张角六幕 Demo 必须保持可运行。
- 不修改 `desktop` 目录。
- 历史内容与数值仍留在 `example`，不上移到 `src`。

## 1. 位移能力（方案 A）

拆分为四种独立能力，各自 3 个功能等级；等级只改变“能不能做”，数值成长交给天赋盘。

- 跳跃：瞬发、短距、无蓄力。
- 用力跳跃：蓄力、中距、有落地硬直。
- 轻功：瞄准、远距、有冷却，复用现有 `FlightSystem` 作为内部实现。
- 攀爬：持续状态，消耗体力，体力耗尽会坠落。

状态机：

```text
Ground → Jump / PowerJump / Flight → Airborne
Airborne → LedgeGrab → Climbing
Climbing → ClimbMove / ClimbJump / ClimbExitTop / Falling
Airborne → Land → Ground
```

要求：

- 动作与形态节点放技能树，距离、冷却、体力、落地规则放 POE 盘。
- 场景可攀爬面通过对象属性 `climbable` 标记，复用现有场景数据。
- 现有 `FlightSystem` 的特效、相机和 `aerial` 图层行为不得回退。


## 2. 生活技能（方案 A）

采集与烹饪采用三层结构，不占用战斗成长点。烹饪按决策 9 延后实现，当前只落地采集与建造熟练度：

```text
熟练度  使用中自动提升，决定可处理的资源等级
配方    解锁配方、工具和加工方式
天赋盘  效率、产量、耐久、风险等被动数值
```

- 伐木、采矿、采集、烹饪各自独立熟练度，1–3 级对应资源等级。
- 配方由 Registry 管理，产出 Buff 统一走 `EffectResolver`。
- 禁止用技能点或天赋点购买采集与烹饪等级。
- 生活相关 keystone 必须带取舍，例如采集加速但更易被发现。

## 3. 实施时机（方案 A）

顺序固定为：

```text
S1 EffectResolver
S2 技能定义与 AbilitySystem
S3 ProgressionGraphSystem
S4 旧 SkillTree/Talent 适配器
→ 位移能力与生活技能作为首个验证内容
```

位移与生活技能不得早于 S1–S4 实现，避免重复建设效果与状态逻辑。

## 4. 职业与兵种建模（方案 A）

两层结构，互不替代：

```text
职业天赋树   战士 / 弓箭手 / 法师
兵种天赋树   步兵 / 弓弩 / 骑兵
```

- 职业天赋决定角色定位与流派。
- 兵种天赋决定战场作战形态。
- 弓骑兵为交叉解锁，需要弓弩树与骑兵树各达到配置点数。
- `UnitSystem` 继续负责兵种类型、升级链和克制矩阵，保持只读。
- 兵种天赋通过效果调整克制结果，禁止直接修改 `UnitCounterTable`。
- `ClassSystem.specializations` 逐步改为读取兵种天赋解锁结果。

## 5. 兵种天赋形式（方案 C）

- 兵种树只负责解锁战场能力，如盾墙、冲锋、齐射、越障、抗骑冲锋。
- 数值成长放入 POE 盘的步兵区、弓弩区、骑兵区。
- 兵种树保持节点少、层级清晰、便于比较，不做成大图。

## 6. 兵种点来源（方案 A）

- 兵种点由参战、战役胜利、指挥单位存活等军事行为获得。
- 不随普通升级发放，不与技能点或天赋点共用。
- 点数池仍由 `PointLedger` 统一管理。

## 成长图清单

```text
class-skill      技能树，含位移动作与形态
class-talent     职业天赋树
unit-talent      兵种天赋树
global-passive   POE 天赋盘，含位移、生活、兵种数值区域
```

点数池：技能点、天赋点、兵种点、被动点，四者独立。

## 7. 箭楼建模

箭楼只有一个定义，不拆分为工事箭楼和载具箭楼。

- 由 `Building_System` 负责建造、材料、耐久、损毁和维修。
- 由 `Vehicle_System` 负责席位、乘降和武器控制路由，规则与载具一致。
- 术语上称为 `Manned_Structure`，当前仅箭楼属于该类。
- 箭楼耐久归零时由建造系统停止武器攻击，并请求载具系统弹出全部乘员。
- `Vehicle` 列表只包含马、马车、云梯和投石车，不再包含箭楼。
- 实现时禁止出现 `structure_arrow_tower` 与 `vehicle_arrow_tower` 两套定义。

## 8. Demo 启用范围

黄巾生存战争 Demo 同时启用四类成长结构：

```text
class-skill      技能树
class-talent     职业天赋树
unit-talent      兵种天赋树
global-passive   天赋盘
```

天赋盘首版仍保持小型规模，验证后再扩展节点数量。

职业固定修正是基线，天赋盘只能在其上叠加，且必须可追溯来源：

```text
战士  伐木挖矿时长 75%
战士  资源负重上限 80%
弓手  采集时长 125%
军师  傀儡被摧毁扣 20% 最大生命
```

由于全程观战路线可获得的兵种点很少，兵种天赋不得成为主线必需能力。

## 9. 烹饪时机

- 本轮只实现采集与建造相关熟练度。
- 烹饪、配方和食物 Buff 留到 Demo 之后实现。
- `RecipeSystem` 保留在规划中，但不属于当前 Demo 范围。

## 实施进度

S1–S10 已完成并通过测试。实施结果与必须遵循的约定见 #[[file:progression-implementation.md]]。

```text
S1  效果内核        已完成
S2  技能定义分离    已完成
S3  成长图内核      已完成
S4  旧系统适配      已完成
S5  暗黑式技能树    已完成
S6  小型 POE 盘     已完成（45 节点）
S7  配置选主        已完成（默认 arpg）
S8  统一成长 UI     已完成
S9  输入与存档      已完成
S10 校验与场景提取  已完成
S11 Demo 迁移验证   待进行
```

## 10. 起始阶段

实现顺序从 S1 开始，首个交付物为 `src/systems/effects/EffectResolver.js` 及其效果类型与修饰栈。在 EffectResolver 稳定前，不实现 ProgressionGraphSystem、位移能力和天赋盘。

## 11. 新成长内容位置

新的技能树、职业天赋、兵种天赋和天赋盘配置放在 `example/sanguo_zhangjiao`，不再新建独立 example。

约束：

- 引擎通用能力仍放 `src`，`example` 只放配置与内容。
- 旧六幕剧情、场景和数值不得被破坏，改动需保持现有 Demo 可运行。
- 新增配置以独立文件加入，避免直接重写 `game.project.json` 既有字段。
- 忽略 `desktop` 目录。

## 12. 天赋盘首版规模

首版 `global-passive` 固定为 45 个节点，建议分配：

```text
起点节点        3   对应战士、弓手、军师入口
普通小点       24   属性、体力、耐久、效率
重要节点        9   位移、采集、战斗、运输方向
分类精通        4   步兵、弓弩、骑兵、生活
核心天赋        3   带明确取舍
插槽            2   预留扩展
```

节点总数在验证完成前不得扩大，避免平衡与 UI 成本提前膨胀。

## 13. 默认 Profile

默认 Profile 为 `arpg`：

```json
{
  "progression": {
    "primary": "talentTree",
    "enabled": ["skillTree", "talentTree", "unitTalent", "passiveBoard"],
    "secondary": ["passiveBoard"],
    "pointPools": {
      "skill": "independent",
      "talent": "independent",
      "unit": "independent",
      "passive": "independent"
    }
  }
}
```

技能树负责主动能力与位移动作，职业天赋为主成长，兵种天赋解锁战场能力，天赋盘承担长期被动数值。
