<!--
/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/
-->

# P2.3 成长与 UI 收口规格（progression 接线）

## 目标

打通「P2.3 成长与 UI」闭环：加点效果进战斗属性、面板加点即时刷新技能快捷栏、ARPG 击杀经验与角色升级、升级发成长点。修复全部 P0 断点（A/B/C/D），F 随 C 自然解决；E（三端入口）延后另行排期。

## 已确认的现状基线（勘察证据）

1. 配置装载链通：GameLoader._buildProgressionDraft（src/core/GameLoader.js L278-325）构造 ProgressionProfile + ProgressionGraphSystem（共享 effectResolver）+ SkillRegistry，8 张图注册。
2. 战斗发点链通：SceneBattleRuntime L335-353 grantPointsOnce（S03-S14 byScene + intervention/victory）。
3. 面板已接：DataDrivenPrologueScene L436 装配 SanguoProgressionPresentationCoordinator（ProgressionPanel + T 热键 + 新档四池各 1 点）。
4. 加点提交链通：ProgressionGraphSystem.allocateNode → effectResolver.addSource（L486）。
5. 装备链通：EquipmentSystem.updateEntityStats 差量写 live stats（L145-194），CombatSystem 读 stats 即得。
6. ClassSystem.calculateFinalStats（L653-703）已有完整结算管线：基础属性+attributeGrowth 等级成长 → attributeSystem.applyAttributeEffects → effectResolver.resolveAll（同一共享实例，SceneGameplaySystemAssembler L708 注入）→ **生产零调用**。

## 断点与改法（决策完整）

### 断点 A+D：战斗属性不消费成长效果（含 onChange 空置）

**改法（方案 1，差量投影层）：**

1. 新建 `example/sanguo_zhangjiao/systems/SanguoProgressionStatsFlow.js`（SceneFlowCoordinator 子类，参照 SanguoProgressionPresentationCoordinator 模式）：
   - 职责：注册 effectResolver.onChange 回调 → 调 classSystem.calculateFinalStats(characterId, character) → 与当前 stats 组件做**差量应用**（仅改写受影响字段：maxHp/maxMp/attack/defense/speed；hp/mp 按比例保持，参照 EquipmentSystem.updateEntityStats L150-185 的差量模式，避免清除装备已提交的加成）。
   - character 来源：stats 组件当前值（level/class 等）。
2. GameLoader 构造 ProgressionGraphSystem 处（L304-307）：effectResolver 由 deps 注入，onChange 在场景装配层注册（SanguoProgressionStatsFlow 内 `effectResolver.onChange = ...`，或 EffectResolver 增加 registerOnChange 聚合——**采用直接赋值**，当前无人注册无冲突）。
3. 首次投影时机：职业选择提交后（classSelected 事实）与读档恢复后（SanguoSceneStateFlow L464 附近）各补一次全量投影，保证进入战斗前基线正确。

**不做：** 不改 CombatSystem 25 处读取点（方案 2 否决——侵入大、收益同）。

### 断点 B：面板加点后技能不重投影

**改法：** SanguoProgressionStatsFlow 的 onChange 回调中，在属性差量应用后调用 `this._syncUnlockedClassSkills()`（DataDrivenPrologueScene L1835 已有出口，转发到 S09ClassSelectionFlow.syncUnlockedClassSkills L352-390，内含冷却保持逻辑 L360/L383-385）。技能解锁变化即刷新快捷栏。

### 断点 C+F：ARPG 击杀经验与角色升级

1. **经验值数据**：library.json 各 enemy 定义补 `experience` 字段（数值对齐当前关卡强度：普通野怪 5-15、精英 20-40、Boss 50-100；狼王 80）。
2. **经验链**：新建 `example/sanguo_zhangjiao/systems/SanguoExperienceFlow.js`（SceneFlowCoordinator 子类）：
   - 监听 `enemy.killed` 应用事件（SceneApplicationEventBridge 已分发，eventId 幂等）→ 读 enemy 库定义 experience → stats 组件 `gainExperience(exp)`（StatsComponent 已有经验字段与 levelUp()，src/ecs/components/StatsComponent.js L190）→ 升级时：
     - 触发 A 的全量属性重投影（attributeGrowth 生效）
     - progressionSystem.grantPoints(characterId, pool, amount)——按 profile.primary（skillTree→skill 池）每级 +1
     - notificationSystem 提示「升到 X 级，获得 1 成长点」
     - 触发器事件 `character.levelUp {level}`（TriggerCatalog 登记契约）
3. **经验表**：等级阈值用 StatsComponent 现有公式（如有）或线性 `level*100`（以 StatsComponent 实际实现为准，实施时核对）。
4. **点数配置**：升级发点量进 game.project.json progression（新增 `levelUpPoints: { pool: 'skill', amount: 1 }`，ContentSchemas 校验同步）。

### 断点 E：三端入口（延后，不在本次范围）

手柄 LB+面板 / 触屏按钮，参照军队按钮接入模式（SceneRenderPipeline 渲染列表 + screenLayerNames + OnboardingUI 投影），待手柄支持统一迭代。

## 涉及文件清单

| 文件 | 改动 |
|------|------|
| `example/sanguo_zhangjiao/systems/SanguoProgressionStatsFlow.js` | 新建：onChange → 差量属性投影 + 技能重投影 |
| `example/sanguo_zhangjiao/systems/SanguoExperienceFlow.js` | 新建：enemy.killed → 经验 → 升级 → 发点 → 重投影 |
| `example/sanguo_zhangjiao/scenes/DataDrivenPrologueScene.js` | 装配两个新 coordinator |
| `example/sanguo_zhangjiao/game.project.json` | progression.levelUpPoints + 各场景无需改 |
| `example/sanguo_zhangjiao/data/library.json`（或实际 enemy 库路径） | enemy 补 experience 字段 |
| `src/core/validation/ContentSchemas.js` | levelUpPoints schema |
| `src/systems/TriggerCatalog.js` | character.levelUp 事件契约登记 |
| `src/ecs/components/StatsComponent.js` | 核对 gainExperience/levelUp 现状，缺则补（引擎层） |

## 验证（用户批准后执行）

1. Vitest：scene 核心回归 + progression 相关既有测试全绿。
2. 实机冒烟（pw 探针，参照 pw-wolf-boss.mjs 模式）：
   - 打开 T 面板加 1 点攻击系天赋 → 关面板平砍伤害数值上升
   - 加点解锁主动技能 → 快捷栏出现新技能且可释放
   - 杀 1 只野狼 → 经验条增长；刷黑板快速升级 → 通知出现 + T 面板点数 +1 + maxHp 提升
   - 装备狼牙 + 加天赋点 → 攻击叠加正确（差量不互相覆盖）
3. 读档回归：加过点的存档重进 → 属性含成长效果、技能在栏。

## 风险

- 差量投影与 EquipmentSystem 差量并存：两者都只改自己负责的字段来源，EquipmentSystem 先执行（装备变更即投影），成长投影只动 resolveAll 结果与 stats 当前值之差——需在实施时验证叠加顺序（装备加成不被成长投影覆盖）。若冲突，成长投影改为「重算 base+growth+class 后再叠加装备快照」。
- enemy.killed 高频触发：经验累加为 O(1) 字段写入，无性能风险。
