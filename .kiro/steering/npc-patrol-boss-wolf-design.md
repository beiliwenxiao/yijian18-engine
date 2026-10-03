# 设计：NPC 巡逻/警戒/追击 + Boss 攻击预警 + 追逐野狼改五只掉狼牙

> 状态：已完成（v4，2026-10-03）；三批全部交付（第一批内容 9862b7e / 第二批 AI+编辑器 a98fded / 第三批 Boss 预警，见六章）
> 需求：①NPC 有巡逻路线/警戒范围/追击范围，场景编辑器可编辑（类似「可碰撞」勾选与五边形调整）；②Boss 预先放出攻击范围/技能虚线框（与玩家技能瞄准同款表现）；③追逐野狼 20→5 只，杀完刷野狼 Boss，掉「狼牙」匕首（攻击+12，可装备）。

## 一、现状关键结论（勘察实证）

1. AI 只有 4 种类型（battleFormation/aggressive/defensive/support），aggressive 索敌半径硬编码 400px（AISystem.js:263），无巡逻/警戒/追击/回家概念；怪物库定义（library.json:912/949）无任何范围字段。
2. Boss 数据结构有现成先例但未接入：data/EnemyData.json:401 `city_commander`（isBoss + combat{attackRange,detectionRange,aggroRange} + skills[] + drops{}）。
3. 编辑器可照抄的控件全部现成：「可碰撞」三态下拉（SceneEditorUI.js:1462）、五边形顶点编辑通用机制（SceneEditorInteraction.js:239 getEditablePolygon/writeEditablePolygon，碰撞与攀爬区共用）、placement 覆盖点路径写入（:1087 overrides.xxx + 空对象剪枝）。
4. 虚线范围框渲染现成：CombatSystem.js:3240 addSkillRangeIndicator + renderCircleIndicator（虚线椭圆）/renderPathIndicator（路径虚线框），目前只有玩家技能瞄准用。
5. 掉落链现成：怪物 lootTable → generateLoot（CombatSystem.js:2276）→ 地面掉落物；武器样例 iron_sword（equipment + stats.attack）。
6. 追逐狼：S01S02SceneFlow.js:56 `MAX_CHASE_WOLVES = 20` + S01.json 20 个 placement（spawnWhen 按 pursuit.spawned 逐只激活）+ trg_s01_chase_wolf_killed 计数。

## 二、设计

### 2.1 AI 属性数据模型（一次定形，引擎与内容共用）

怪物库定义（library.json enemy）新增可选 `ai` 块（不做则维持现状）：

```jsonc
"ai": {
  "detectionRange": 260,     // 警戒半径：进入则转向/警戒
  "pursuitRange": 420,       // 追击半径：超过则放弃追击
  "leashRange": 300,         // 离出生点最远距离，超出回家（回家途中无敌意）
  "patrol": {
    "enabled": true,
    "mode": "loop",          // loop=沿路径点循环 | pingpong=往返
    "points": [ {"x":..,"y":..}, ... ]   // 场景局部坐标，相对 placement 锚点由编辑器换算
  },
  "telegraph": { "windupMs": 800 }      // 攻击前摇（boss 用，普通怪可 0=即时）
}
```

- 单个场景想微调个别怪：placement 上 `overrides.ai.*` 点路径覆盖（编辑器写这里），运行时 EntityFactory 合成「库默认 ← 场景覆盖」。
- AISystem 状态机：`patrol（沿点巡逻）→ alert（玩家进 detectionRange，停住面向玩家）→ chase（pursuit 内追击）→ return（超出 pursuit/leash 回出生点，回完继续 patrol）`。aggressive 现行为作为无 ai 块时的默认不变——**零回归**。

### 2.2 场景编辑器

placement 面板（选中场景里的怪）新增「AI」区块，照「可碰撞」同款交互：

1. 勾选「启用巡逻」（写 overrides.ai.patrol.enabled）。
2. 数字输入：警戒范围 / 追击范围 / 回家距离（px），画布上以选中怪为圆心画三圈虚线预览（警戒=黄、追击=红、回家=灰，半径拖拽后续迭代，先数值驱动）。
3. 巡逻路线：**复用现有五边形编辑机制**注册第三种可编辑路径「巡逻路线」（开放路径不闭合）：选中怪后画布出现路径顶点手柄，可拖动、边上点击插点；首尾区别于闭合碰撞多边形。
4. 全部写回 placement `overrides.ai.*`，经既有 `_pruneEmptyObjects` 清理，导出 S01.json 链路不变。

### 2.3 Boss 攻击预警（telegraph）

- 库定义接入 EnemyData 先例：boss 怪挂 `isBoss:true` + `skills[]`（技能含 range/形状/伤害/前摇）。
- 表现复用玩家技能瞄准同款渲染：boss 进入攻击前摇（windupMs）时，在其攻击落点画虚线攻击范围圆 + 技能形状虚线框（addSkillRangeIndicator/renderCircleIndicator），前摇结束才结算伤害——「先看见范围，再挨打」。
- 普通怪 telegraph.windupMs 缺省 0 = 现行为不变。

### 2.4 追逐野狼 20→5 + 狼王 Boss + 狼牙

1. `MAX_CHASE_WOLVES = 5`；S01.json chase-wolves placement 裁到 5 条（保留现有逐只 spawnWhen 递进）。
2. 计数确认：trg_s01_chase_wolf_killed 已走 recordChaseWolfKilled（记 killed 计数）→ 新增 placement `S01-wolf-boss`（spawnWhen: storyState.s01Survival.pursuit.killed gte 5），数据驱动无需改触发器（若计数路径名不同以实测为准）。
3. library.json 新增「狼王」（isBoss + skills[扑咬：近战圆范围] + lootTable[狼牙 ×1 必掉]），体型/血量放大（攻击+12 的匕首持有者约第 2 天强度，狼王数值压在可打赢但需要走位）。
4. 新武器「狼牙」：equipment / subType weapon / 匕首类 / stats.attack 12 / 描述「野狼王的獠牙磨制的匕首」；掉落走 lootTable → 现成地面掉落链，拾取即入背包可装备。

## 三、实施顺序（三批，每批可独立验收）

1. **第一批（内容，见效最快）**：追逐狼 20→5 + 狼王 Boss 刷出 + 狼牙掉落可装备。改动集中在 S01.json/library.json/触发器计数核对。
2. **第二批（AI + 编辑器）**：ai 块数据模型 + AISystem 状态机 + 编辑器 AI 区块（勾选/半径/巡逻路线编辑）。
3. **第三批（Boss 预警）**：telegraph 前摇 + 虚线范围渲染接入敌人攻击。

每批交付跑 scene 核心回归 + 实机冒烟。

## 四、第一批交付记录（2026-10-03）

- `MAX_CHASE_WOLVES = 5`（S01S02SceneFlow.js:56）；S01.json chase-wolves 裁至 5 条（spawnWhen gte 1..5）。
- `story.s01.chase.kill`（commands.json）：计数门 `killed lte 19→lte 4`（killed 停在 5）；补刷 `min(20,+2)→min(5,+2)`。
  数学：开局 3 只（leaveShelter 写 spawned:3）+ 杀一补二封顶 5，杀满 5 只触发狼王。
- 狼王 placement `S01-wolf-boss`（spawnWhen: pursuit.killed gte 5，双保险之一）；
  `recordChaseWolfKilled` 杀满后显式 `_ensureSpawnedPlacement`（运行中即时登场 + 幂等防重）+ 屏幕提示「狼王登场」。
- library.json 新增：`enemy.s01_wolf_king` 狼王（isBoss/level 2/hp 110/攻 9/防 2，体型 96×64，
  lootTable：狼牙×1 必掉 + 生狼肉 2-5）；`weapon.wolf_fang` 狼牙（equipment/weapon，attack+12，rarity 2）。
  **TODO：狼牙暂复用铁剑图标 inventory.equipment.ironSword，待专属贴图 + assets.json manifest 条目。**
- 验证：JSON 三件合法；s01FirstWolfPack + RealCanonicalColdRestartReplay 13/13；
  实机冒烟（pw-wolf-boss.mjs）：写黑板 pursuit{killed:4} → fire enemy.killed → killed=5、
  狼王实体刷出（placementId/hp 110/name 正确）、lootTable 挂载正确、generateLoot 产出 2 掉落物、
  onLootDrop 地面投影回调触发、无 pageerror。真实击杀掉落与拾取装备留玩家实测。

## 五、第二批交付记录（2026-10-03）：AI 画像 + 编辑器 AI 区块

### 5.1 数据与运行时

- **数据链免费复用**：placement `overrides.ai` 经 PlacementSpawner.mergeOverrides（浅一层深合并）
  自动流入 EntityFactory → `entity.aiProfile`（深拷贝注入，EntityFactory.js:280）。
- **points 格式定案**：`[[x, y], ...]` 相对出生锚点偏移（与碰撞多边形同约定，移动物体路线跟随）。
- **AISystem 状态机**（AggressiveAI.makeDecision，AIController 基类提供步进方法）：
  索敌半径 `detectionRange ?? 400`（零回归默认）→ 追击守卫 `distanceFromSpawnAnchor(target) > pursuitRange` 放弃
  → 无目标时 `stepReturnHome`（leashRange，returning 粘滞防抖）→ `stepPatrol`（loop/pingpong，到点停 1s）
  → `wanderNear`（现状默认）。状态存 controller 实例字段（每实体独立 controller，AISystem.js:516）。
- **library.json 样例**：饥饿野狼/追逐野狼（detection 260/pursuit 480/leash 560/patrol pingpong）；
  狼王（detection 320/pursuit 560/leash 640/patrol loop/telegraph windupMs 800——供第三批消费）。

### 5.2 编辑器（照「可碰撞」同款交互）

- **SceneEditorUI ref 面板** enemy 专属「AI 行为（本处覆盖）」区块：警戒/追击/回家三个数字输入 +
  巡逻 checkbox + 巡逻方式 select + 「编辑巡逻路线」开关按钮（data-patrol-toggle，
  `_editingPatrolRoute` 状态；换选非敌怪自动退出防顶点误路由）。
- **巡逻路线编辑**：复用多边形顶点机制——SceneEditorInteraction.getPolygonWorldPoints/
  setPolygonWorldPoints 增 patrol 分流（相对锚点换算）；右键菜单最少点数 patrol=1（闭合多边形仍 3）；
  拖动入口同步放行。
- **SceneEditorCanvas**：选中 enemy 画三圈虚线预览（警戒黄/追击红/回家灰，读 overrides.ai 未配置不画）；
  巡逻编辑态画开放折线 + 蓝色圆点手柄，并隐藏碰撞手柄（防双套手柄互劫）。

### 5.3 验证

- AISystem 26/26（新增 5 例：警戒圈内外索敌 / 无 profile 默认 400 / 追击范围放弃 / 巡逻移动 / 回家）；
  editor 18 文件 94/94；EntityFactory 6/6；RealCanonicalColdRestartReplay 5/5（library 装载链）。

---

## 六、第三批交付记录（2026-10-03）：Boss 攻击预警（telegraph）

### 6.1 实现（CombatSystem.js）

- **performAttack 开头拦截**（:814）：`aiProfile.telegraph.windupMs > 0` 且 enemy 攻击时：
  首次调用 → `attackTelegraphs`（attackerId → {startedAt, windupMs, radius, refs, name}）进入前摇并 return；
  前摇中重入幂等 return（不推进冷却）；前摇满 → 清记录，**目标仍在 attackRange 内才放行结算**，
  跑出圈即落空（不推进冷却，AI 重新走预警循环——躲开机制）。
- **渲染**（renderAttackTelegraphs，render 尾调用）：windup 中敌人脚下画攻击范围 2.5D 虚线椭圆
  （复用 renderCircleIndicator，与玩家技能瞄准同款），红色、半径随剩余时间收圈（0.35→1 倍）——
  直观传达「快打了，快出圈」。
- **生命周期防泄漏**：handleDeath 清死者相关条目（攻击者/目标双角色）；渲染循环兜底清理
  超过 2 倍前摇未结算的孤儿条目（脱战/AI 停驱残留）。
- 普通怪 windupMs 0/未配置 = 现行为不变（立即结算）。
- library.json 狼王已配 telegraph.windupMs 800（第二批数据就位）。

### 6.2 验证

- 实机状态机冒烟（pw-telegraph.mjs，真实 CombatSystem + 假实体探针）五步全过：
  进入前摇（记录创建/零结算）→ 前摇中重入幂等 → 前摇满结算（attack 推进 + 记录清除）→
  出圈落空（不结算 + 记录清除）→ 普通怪立即结算（零回归）；无 pageerror。
- 场景核心 + 存档回归 112/112。

**三批全部交付**。后续可选：狼牙专属贴图、范围圈半径画布拖拽、boss 多技能 telegraph 形状（路径框）。
