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

# P2.3 成长与 UI 收口任务清单

> 前置：spec.md 已评审批准。按序执行，每任务完成后立即勾选。

## 任务 1：核对 StatsComponent 经验/升级现状（引擎层地基）

- [x] 读 src/ecs/components/StatsComponent.js 经验字段、gainExperience、levelUp()（L190）与升级阈值公式的实际实现
- [x] 缺 gainExperience 则补引擎方法（经验累加 + 阈值判定 + 返回是否升级），补 JSDoc 与版权头检查
- 产出：引擎层升级原语确认可用。实施：StatsComponent 已有 addExp/levelUp（无阈值判定）；新增 getExpToNextLevel()（level×100 线性）与 gainExperience(amount)（累加+连升+返回结算结果）
- 2026-10-20 复核修正：gainExperience 原实现 `this.level += 1` 后又调 levelUp()（内部再 level++）导致每次升级 level 双加——已移除外层自增，levelUp() 为唯一等级写入点（level++ + 恢复满血蓝体力）

## 任务 2：SanguoProgressionStatsFlow（断点 A+B+D）

- [x] 新建 example/sanguo_zhangjiao/systems/SanguoProgressionStatsFlow.js（SceneFlowCoordinator 子类 + 完整版权头）
- [x] 注册 effectResolver.onChange → classSystem.calculateFinalStats → stats 组件差量应用（maxHp/maxMp/attack/defense/speed，hp/mp 按比例保持，参照 EquipmentSystem.updateEntityStats 模式）
- [x] onChange 尾部调用 this._syncUnlockedClassSkills()（技能重投影，断点 B）
- [x] 职业选择提交后与读档恢复后（SanguoSceneStateFlow L464 附近）各补一次全量投影
- [x] DataDrivenPrologueScene 装配该 coordinator（services.sanguoProgressionStats + SanguoGameLoaderCoordinator L158 安装）
- 验证：静态 API 核实通过（SceneFlowCoordinator 代理、_ensureClassSystem、resourceScope.track、effectResolver.onChange(entityId) 签名、gameLoader.progressionSystem 赋值链）；实机验证待任务 6

## 任务 3：enemy experience 数据

- [x] 确认 enemy 库实际文件（example/sanguo_zhangjiao/project/library.json "enemies" 段，15 个 enemy）
- [x] 各 enemy 补 experience 字段（普通 8-20 / 精英 55-60 / Boss：狼王 80、孙夏 100）
- 验证：逐条 Edit 插入（"experience" 键按字母序置于 "id" 前），JSON 结构保持

## 任务 4：SanguoExperienceFlow（断点 C+F）

- [x] 新建 example/sanguo_zhangjiao/systems/SanguoExperienceFlow.js（完整版权头）
- [x] 监听击杀链：DataDrivenPrologueScene.onEnemyKilled → handleEnemyKilled → gameLoader.getRegistry('enemies').get(definitionId).experience → stats.gainExperience（实体 _expGranted 防重）
- [x] 升级时：_syncUnlockedClassSkills 重投影 + progressionSystem.grantPoints（读 game.project.json progression.levelUpPoints）+ 通知提示 + triggerSystem.fire('character.levelUp')
- [x] DataDrivenPrologueScene 装配（services.sanguoExperience）
- [x] game.project.json 补 progression.levelUpPoints { pool: 'skill', amount: 1 }
- [x] ContentSchemas.js 补 LEVEL_UP_POINTS_SCHEMA（pool enum + amount min 1）并入 CONTENT_SCHEMAS；TriggerCatalog.js 登记 character.levelUp（事件 schema + identities + source + label）
- 验证：静态核实 gameLoader.project/triggerSystem/progressionSystem.grantPoints/fire(whenType,params)/EntityFactory L336 definitionId 全部存在；实机验证待任务 6

## 任务 5：叠加顺序验证（风险项）

- [x] 静态时序验证：装备差量与成长差量正交（各自只处理自己来源的变化量，live = base + equipΔ + progressionΔ）
- [x] 读档双算防线：SanguoSceneStateFlow 恢复流程插 projectProgressionStats('restore')（L465，重置基线）；authority 恢复期间 onChange 建基线 → stats 权威恢复覆盖中间态 → restore 重置基线，终态收敛正确
- 结论：无需「重算 base+growth+class 后叠加装备快照」的备用方案

## 任务 6：回归与冒烟（2026-10-20 用户明示后执行）

- [x] Vitest：137/137 全绿（progression 3 套件 + progression-config + passive-board + s01FirstWolfPack + RealCanonicalColdRestartReplay）
- [x] 实机冒烟（pw 探针 %TEMP%\w-verify\p23-smoke.mjs）8/8 PASS：
  - scene-ready（登录→创建角色→进场景）、S1 职业注入、S2 基线、S3 八图枚举
  - S4 加点 warrior_toughness → maxHp 100→130（差量投影生效）
  - S5 技能解锁链（getUnlockedSkills）、S6 击杀涨经验（exp 0→8）
  - S7 击杀孙夏升级 level 1→2 + skillPts 0→1（升级发点链）
- [x] 冒烟过程中发现并修复两个实施 bug：
  1. SanguoProgressionStatsFlow install 时序：GameLoader ready 早于场景 enter，playerEntity 未创建导致投影层静默未安装——改为 install 不依赖 playerEntity（回调实时读取）
  2. ClassSystem.calculateFinalStats 引擎级结构缺陷：resolveAll 只在有 specialization 时执行，无特化角色的成长效果被整体跳过——改为无条件统一结算（回归 137/137 确认零破坏）
- 读档实机回归与装备+成长叠加实机验证：冷启动重放 13/13 已覆盖存档链；restore 防线与装备正交性已静态验证（任务 5），实机手感留玩家实测
