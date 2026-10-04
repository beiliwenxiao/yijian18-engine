# 内容库与场景编辑器改造计划（NPC 合并 · 战斗技能 · 通用列表）

## Context

内容库编辑器（editor/LibraryEditor.js）的 NPC/敌人表单与真实数据**全面错位**：表单读写模板形态的 `sprite.src/baseStats/ai.type/loot`（LibraryEditor.js:65-72、658-669），而 library.json 真实条目是 `imageId/sprite{width,height}/stats/lootTable/ai.telegraph`（运行时 EntityFactory.js:186-310 按真实字段消费）——掉落表、AI 属性在编辑器里既看不到、编辑还会写垃圾字段。同时：装备与战斗技能只有 JSON 文本域；列表无缩略图、无类型筛选；`config/skills.json`（玩家技能权威数据，烈焰掌等 8 技能）完全无编辑 UI；敌人运行时零技能路径。

**用户决策**：① NPC/敌人/BOSS 用 **UI 合并**（保留 npcs/enemies 两个 section + 条目加 `npcType` 字段）；② 战斗技能**复用 config/skills.json**；③ **分两期**交付。

---

## 第一期：内容库改造

### 1. 数据结构

**npcType 值域**（条目顶层字段，npcs/enemies 都有；`_load()` 内 `_ensureNpcTypes()` 幂等推导，随保存落盘）：

| 值 | 含义 | 推导规则 |
|---|---|---|
| `ally_npc` | 同阵营NPC | section===npcs |
| `enemy` | 敌人 | section===enemies、非 boss、imageId 含 `.character.` |
| `enemy_boss` | 敌人BOSS | 同上、isBoss===true |
| `monster` | 怪物 | section===enemies、非 boss、imageId 含 `.enemy.` |
| `monster_boss` | 怪物BOSS | 同上、isBoss===true |

- 「怪物 vs 敌人」按 imageId 路径段推导（`s01.enemy.wolf` vs `s09.character.*`），推导不出回退 `enemy`，不加 species 字段。
- 粮仓哨兵（faction:'friendly' 的 enemy）留在 enemies、npcType=`enemy`，列表加阵营徽标——不迁移，运行时它是 createEnemy 产物。
- **UI 类型切换 = 条目在 npcs/enemies 数组间移动**（`_migrateEntryBetweenSections`），补齐目标 section 缺省字段；spawn 端按 section 不变。

**skills.json 编辑写入**：fetch 读 + `replaceCanonicalFile`（editor/CanonicalTransactionClient.js:65）整文件原子落盘（`validateCanonicalChangeSet` 允许 config/*.json 原样写盘，EditorFileApiPlugin.js:183）；不经过 canonicalSession.patch('library')。

### 2. 文件改动（主战场 editor/LibraryEditor.js）

| # | 位置 | 改动 |
|---|---|---|
| 1 | CATEGORIES :43-99 | 删 equipment 独立分类 → items 改 `{key:'items', label:'物品与装备', sections:['items','equipment']}`；npcs 改 `{label:'NPC', sections:['npcs','enemies']}`；enemy/npc tpl 改真实 schema（stats/aiType/attackRange/lootTable/npcType）；combatSkills tpl 删（改结构化） |
| 2 | 新增常量 | `NPC_TYPE_DEFS`（值域/标签/推导）、装备 slot 枚举（先 grep 运行时装备消费校准） |
| 3 | `_load` :173-187 | + `_ensureNpcTypes()` |
| 4 | `_current/_catDef/_addEntry/_deleteEntry` :301/919/933 | 按 `sections` 聚合多 section，条目携带 `__section`；增删路由到条目所属 section |
| 5 | `_buildUI` :306-339 | 工具栏加类型筛选下拉（数据源：NPC 分类用 NPC_TYPE_DEFS；items 分类用 `_itemTypeOptions()`:216 + `__section` 区分物品/装备；先例 TriggerEditor.js:391-419） |
| 6 | `_renderList` :413-443 | 缩略图推广为通用 `_listThumb()`：items/equipment/npcs/enemies 都走 manifest imageId（`_renderItemDetail:491-613` 同机制）；行内加类型徽标 |
| 7 | `_renderDetail` :445-476 | 分流：合并 npcs → 重写版 `_renderSpriteDetail`；combatSkills → 新 `_renderSkillDetail` |
| 8 | `_renderSpriteDetail` :635-751 | **重写为真实 schema**：图片区抽 `_renderImagePicker()`（复用 Manifest 下拉+路径+PNG导入+预览）+ sprite 宽高；stats 数字组；敌人区 aiType/attackRange + `_renderLootTableEditor`（行：chance/itemId 下拉(取 library.items)/min/max）修复 `e.loot`→`lootTable` 错位；npcType 下拉（切换触发迁移）；NPC 区保留 title/faction/dialogueId/interaction（:674-698）；+ `_renderSkillRefEditor`（技能 id 下拉引用 skills.json；编排行简版：type/skillId/intervalSeconds） |
| 9 | `_renderSkillDetail`（新） | skills.json 结构化编辑：id/name/description/category/targeting/params{damage,range,radius,cooldown,castTime,healAmount,projectileCount}/costs{mp,stamina}/vfx.effect/tags |
| 10 | `_commitDetail` :814-908 | 按真实 schema 重写提交 + **清理遗留字段**（delete e.loot/e.baseStats/e.ai）；combatSkills 分支读回 skills 内存副本 |
| 11 | `save()` :230-280 | combatSkills 分类走 `_saveSkillsOnly()`（replaceCanonicalFile）；物品校验 `_validateItemLibrary`:796 兼容装备混排 |

### 3. 风险

- 表单重写必须带遗留字段清理，否则新旧字段双写污染数据（保存后 `git diff library.json` 审查）。
- skills.json 绕过 canonical 会话：整文件原子替换 + 保存前 JSON.parse 校验；删技能前检查 library 引用。
- 分类按钮 14→12，统计文案 `_catLabel()`（save :258）同步。
- equipment 现为空数组（library.json:926），slot 枚举实施时按运行时装备消费点校准。

### 4. 验证（第一期）

- 测试：`node --test editor/CanonicalEditorSession.test.js editor/SchemaFieldEditor.test.js`、`node --test test/s01FirstWolfPack.test.js`（狼王 lootTable 不回归）。
- 手测：①NPC 分类合并列表 + 类型筛选；②选中狼王改掉落表 min → 保存 → diff 仅见 npcType 等预期字段、无 baseStats/loot 垃圾；③战斗技能编辑 cleave 的 cooldown → 保存 → `git diff config/skills.json`；④新建 NPC 切类型「怪物」→ 条目迁到 enemies section；⑤物品与装备合并分类、装备结构化表单。

---

## 第二期：场景编辑器联动 + NPC 攻击编排运行时

### 1. attackActions schema（存库定义 `ai.attackActions`，与 telegraph 同级；placement overrides 可覆盖）

```jsonc
{ "id": "wolf_bite", "type": "skill", "skillId": "cleave",
  "intervalSeconds": 8, "afterSkillId": null, "delayAfterSkillSeconds": 0,
  "paramsOverride": { "radius": 150 } }
```

执行语义：时间基准 performance.now()；`intervalSeconds` 兼作开场延迟（0=立即）；实际触发 = interval 到期 && 技能冷却（params.cooldown 硬闸）&& 目标在 range 内；链式：`afterSkillId` 动作释放成功后按 `delayAfterSkillSeconds` 计时，与自身 interval 取先到；多动作就绪按数组顺序取第一个；`type:'basic'` 走原 performAttack；死亡/剧情倒地清 casting 与计时，脱战重置 lastFiredAt。

### 2. 运行时改动

| 文件 | 改动 |
|---|---|
| 新增 `src/core/FactionRules.js` | `isHostileTarget` 从 AISystem.js:35 提升；AISystem 改 import（行为零变化） |
| `src/systems/CombatSystem.js` | 敌我判定重写：applyAOEDamage:2296 的 `e.type!=='enemy'`、applyLinearPathDamage:2202、applyFlamePalmDamage 内嵌 filter、治疗过滤:2102 → 统一 `isHostileTarget(caster, e)`；敌人施法复用 `executeSkill`:1910 + telegraph 预警（skill 用 circle、radius 取 paramsOverride ?? params） |
| 新增 `src/systems/EnemySkillDirector.js` | 按 aiProfile.attackActions 逐帧调度，AISystem.update 链挂接（makeDecision:344 前）；有编排的敌人普攻决策让位 Director |

### 3. 场景编辑器改动

| 文件 | 改动 |
|---|---|
| `editor/SceneEditorUI.js` | `_buildRefProperties` enemy 分支 :1517-1535：掉落/编排只读摘要 +「编辑技能范围」按钮（`_editingSkillRange`，与 `_editingPatrolRoute`:805 同模式）；写 `overrides.ai.attackActions[i].paramsOverride.radius` |
| `editor/SceneEditorInteraction.js` | `get/setPolygonWorldPoints` :271-328 加 skillRange 分支：radius ↔ 正五边形世界坐标换算；`getVertexAt`:334、拖拽 419-456→580-586 全复用（五边形固定 5 点，右键禁增删，拖拽即改半径） |
| `editor/SceneEditorCanvas.js` | 技能范围虚线圆 + 五手柄渲染（参照巡逻点 :1228/:1285） |

### 4. 风险

- applyAOEDamage 是玩家技能主结算路径，敌我重写后玩家 AOE 不再误伤粮仓哨兵（faction friendly）属预期行为变化，需 s09 剧情回归。
- 敌人死亡/plotDowned（AISystem.js:38）不清理 Director 状态会致复用实体瞬发技能——状态按 entity.id 键挂死亡清理。
- 技能前摇只走 telegraph 圈（windupMs=castTime），不与 attackDash 叠加。
- 技能删除时检查场景 overrides 的悬空 skillId 引用。

### 5. 验证（第二期）

- 测试：`node --test src/systems/AISystem.test.js test/s01FirstWolfPack.test.js test/s02RefugeeMigration.test.js`（哨兵阵营不回归）。
- 手测：①狼王配 attackActions → 战斗中 telegraph 圈→伤害→interval 循环→击杀无残留；②玩家 AOE 打哨兵零伤害、打狼王正常；③场景编辑器拖五边形顶点改技能半径 → 保存 → diff 仅见 overrides.ai.attackActions[].paramsOverride.radius；④链式：技能 A 后 2 秒触发技能 B；脱战重进计时重置。
