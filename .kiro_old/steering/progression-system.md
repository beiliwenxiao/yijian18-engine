---
inclusion: fileMatch
fileMatchPattern: "**/*{Skill,Talent,Progression,Ability,Effect,Class}*.js"
---

# RPG 成长系统设计约定

## 适用范围

本规则用于技能、职业天赋、POE 式天赋盘、Roguelike 局内强化、属性效果及其 UI/存档设计。结论来自项目现有功能分析，不依赖任何 Spec。

## 核心结论

采用“多种成长表现、单一底层内核、项目配置选主”的方案：

- 同时保留传统技能树、职业天赋树和 POE 式天赋盘。
- 三者共用 `ProgressionGraphSystem`，不得维护三套重复的节点和点数逻辑。
- 游戏开发者通过 `game.project.json` 选择主要成长系统及辅助系统。
- 定义数据与角色运行状态必须分离，禁止将角色节点等级写回共享定义。
- 所有成长效果必须通过统一 `EffectResolver` 应用，不得在各系统中持续增加效果字段 `if/else`。
- 旧 `SkillTreeSystem`、`TalentSystem` API 先通过适配器兼容，禁止无迁移方案的一次性删除。

## 三类系统职责

### 技能树 SkillTree

负责“角色能做什么”：

- 主动技能解锁和等级
- 技能强化分支
- 技能形态替换
- 终极技能
- 快捷栏可用技能

技能如何消耗、冷却、选目标、命中和结算由独立 `AbilitySystem` 负责，不能由技能树节点直接执行。

### 职业天赋树 TalentTree

负责“角色擅长什么”：

- 职业专精和战斗风格
- 职业被动
- 互斥路线和二选一节点
- 少量强规则修改
- 专精终极节点


### POE 式天赋盘 PassiveBoard

负责“Build 如何长期构筑”：

- 多职业起点和路径连接
- 普通节点、重要节点、核心天赋、精通和插槽
- 属性、生存、元素、武器、采集、制造、建造和载具被动
- 跨职业路线及其过路成本
- 改变玩法规则且具有取舍的核心天赋

大型天赋盘必须使用邻接索引、区域索引、局部查询、增量效果缓存和 UI 视口裁剪，禁止每帧遍历整张图。

## 主流游戏的成长分层

### 传统 RPG / MMORPG

通常使用“主动技能树 + 职业专精树 + 装备”。职业定位清晰，天赋允许重置或保存多套方案。大型被动盘不是必需功能。

### ARPG

通常使用“主动技能及其强化 + 职业天赋 + 被动盘 + 装备词缀”。前期先开放技能，后期逐步开放复杂被动盘，避免一次暴露全部系统。

### POE 型游戏

通常将主动技能、辅助技能、大型被动盘、职业专精和装备词缀分开。天赋盘主要定义整体 Build，不直接承担完整主动技能执行。

### Roguelike / Roguelite

主要成长应拆为：

- 局内随机成长：技能、祝福、遗物、卡牌或武器进化，单局结束后重置。
- 局外永久成长：角色、武器、技能池、刷新次数和系统功能解锁。

局外成长应优先增加选择空间，而不是只堆叠永久数值。局内随机选择需要独立 `WeightedOfferSystem`，支持权重、稀有度、标签、前置、互斥、等级、进化和保底。

## 项目配置选主

`game.project.json` 可配置：

```json
{
  "progression": {
    "primary": "talentTree",
    "enabled": ["skillTree", "talentTree", "passiveBoard"],
    "secondary": ["passiveBoard"],
    "pointPools": {
      "skill": "independent",
      "talent": "independent",
      "passive": "independent"
    }
  }
}
```

`primary` 支持：

- `skillTree`：技能树为主要成长。
- `talentTree`：职业天赋为主要成长。
- `passiveBoard`：POE 天赋盘为主要成长。
- `hybrid`：多套系统同等重要。

主系统决定默认 UI、升级提示、教程和未分配点数提示；禁用系统不显示 UI，但存档命名空间保持稳定。

## 推荐游戏 Profile

- `classicRpg`：技能树 + 职业天赋树。
- `arpg`：技能树 + 职业天赋 + 小型被动盘 + 装备词缀。
- `poeLike`：技能/辅助系统 + 大型被动盘 + 职业专精 + 装备构筑。
- `roguelite`：基础能力 + 局内随机强化 + 局外解锁树。

默认推荐 `arpg`：技能树负责主动能力，职业天赋负责专精，小型 POE 盘负责长期被动 Build。

## 点数池规则

优先使用独立点数池：

- 技能点用于技能树。
- 天赋点用于职业天赋树。
- 被动点用于 POE 天赋盘。

允许游戏配置共享或部分共享点数，但必须由 `PointLedger` 统一管理。任何节点分配都必须先验证、再一次性扣点和提交，不允许节点已分配但点数扣除失败。

## 统一数据模型

```js
GraphDefinition {
  id, mode, version, pointPool, startNodes, nodes, edges, rules, layout
}

NodeDefinition {
  id, kind, maxRank, costs, prerequisites, choiceGroup,
  position, region, effects
}

ProgressionState {
  characterId, graphs, pointPools, revision
}
```

`NodeDefinition.kind` 至少支持：

- `activeSkill`
- `skillModifier`
- `passive`
- `specialization`
- `minor`
- `notable`
- `keystone`
- `mastery`
- `socket`
- `start`

节点前置应支持 AND、OR、互斥组、累计投入点数、等级和标签条件。

## 统一效果协议

标准效果类型包括：

- `attribute.modify`
- `combat.modify`
- `skill.unlock`
- `skill.modify`
- `status.grant`
- `gather.modify`
- `construction.unlock`
- `inventory.modify`
- `vehicle.modify`
- `rule.override`

效果操作至少支持 `add`、`multiply` 和 `override`，并记录 `sourceId`、持续时间、条件及叠加规则。最终能力由职业基础、装备、技能树、职业天赋、天赋盘和状态效果共同解析。

## UI 规则

统一“角色成长”入口，根据配置显示：技能、职业天赋、天赋盘页签。传统树复用现有面板并逐步改接统一 ViewModel；POE 天赋盘使用独立大画布，支持缩放、平移、搜索、路径高亮、分配预览、重置预览和视口裁剪。

## 设计原则与禁止事项

- 一个游戏应明确一套主要成长系统，其他系统承担辅助职责。
- 不同系统不得重复只提供同类数值；技能树解锁能力，职业天赋强化玩法，天赋盘构筑长期被动，装备动态改变 Build。
- 高级节点优先改变规则并带来取舍，而不是只增加百分比。
- 复杂系统应按角色等级或流程逐步开放。
- 支持单节点撤销、全盘重置和多套 Build；是否收费及切换地点由项目配置决定。
- 禁止在共享 GraphDefinition 中保存 `currentRank`、`isLearned` 等角色状态。
- 禁止让 UI 直接修改节点和点数；UI 必须提交领域命令。
- 禁止技能树直接执行战斗技能；技能执行统一进入 AbilitySystem。
- 禁止三套系统各自直接修改 Stats；统一进入 EffectResolver。
- 禁止为了新增 POE 盘立即删除旧 API；应通过适配器渐进迁移。
