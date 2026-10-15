# 实现计划：张角黄巾起义序章

## 概述

本实现计划将张角黄巾起义序章的设计转换为可执行的开发任务。计划分为多个阶段，每个阶段包含具体的编码任务。所有任务都基于需求文档和设计文档，充分复用现有游戏引擎功能。

## 任务列表

### 阶段 1: 核心系统搭建

- [x] 1. 创建序章管理器 (PrologueManager)
  - 创建 `src/prologue/PrologueManager.js` 文件
  - 实现序章初始化、六幕流程管理、场景切换逻辑
  - 集成 SceneManager、AudioManager、InputManager
  - _需求: 1, 7, 8, 13, 19, 24, 32_

- [x] 2. 创建序章场景基类 (PrologueScene)
  - 创建 `src/prologue/scenes/PrologueScene.js` 文件
  - 继承现有 Scene 基类，添加序章特定功能
  - 实现场景生命周期方法（enter, exit, update, render）
  - _需求: 1, 7, 8_

- [x] 3. 创建进度管理器 (ProgressManager)
  - 创建 `src/prologue/systems/ProgressManager.js` 文件
  - 实现进度保存到 localStorage
  - 实现进度加载和检查点管理
  - 实现进度继承到正式游戏的数据准备
  - _需求: 33, 38_

- [ ]* 3.1 编写进度管理器的属性测试
  - **属性 3: 进度保存往返一致性**
  - **验证: 需求 38**

### 阶段 2: 装备和背包系统

- [x] 4. 创建装备系统 (EquipmentSystem)
  - [x] 4.1 创建 `src/prologue/systems/EquipmentSystem.js` 文件
    - 实现装备数据结构（Equipment interface）
    - 实现装备穿戴和卸下逻辑
    - 实现装备属性计算（包括负属性）
    - _需求: 4, 10, 13, 14_
  
  - [ ]* 4.2 编写装备系统的属性测试
    - **属性 2: 装备属性加成正确性**
    - **验证: 需求 4, 10, 13, 14**

- [x] 5. 创建背包系统 (InventorySystem)
  - 创建 `src/prologue/systems/InventorySystem.js` 文件
  - 实现物品添加、移除、堆叠逻辑
  - 实现背包容量管理
  - _需求: 3, 4_

- [x] 6. 创建装备强化系统 (EnhancementSystem)
  - 创建 `src/prologue/systems/EnhancementSystem.js` 文件
  - 实现装备强化逻辑（成功率、货币消耗）
  - 实现装备拆解逻辑（货币返还）
  - 实现强化等级和属性加成计算
  - _需求: 17, 18_

- [x] 7. 创建商店系统 (ShopSystem)
  - [x] 7.1 创建 `src/prologue/systems/ShopSystem.js` 文件
    - 实现商店注册和物品管理
    - 实现购买交易逻辑
    - 实现出售交易逻辑
    - _需求: 15, 16_
  
  - [ ]* 7.2 编写商店系统的属性测试
    - **属性 4: 货币交易守恒性**
    - **验证: 需求 15, 16, 17**

### 阶段 3: 教程和对话系统

- [x] 8. 创建教程系统 (TutorialSystem)
  - 创建 `src/prologue/systems/TutorialSystem.js` 文件
  - 实现教程注册和触发逻辑
  - 实现教程完成状态管理
  - 实现教程显示和隐藏
  - _需求: 2, 3, 4, 5, 11, 12, 37_

- [x] 9. 创建对话系统 (DialogueSystem)
  - 创建 `src/prologue/systems/DialogueSystem.js` 文件
  - 实现对话节点管理
  - 实现打字机效果
  - 实现对话选择分支
  - _需求: 6, 9, 35_

- [x] 10. 创建任务系统 (QuestSystem)
  - 创建 `src/prologue/systems/QuestSystem.js` 文件
  - 实现任务注册和触发
  - 实现任务进度跟踪
  - 实现任务完成和奖励发放
  - _需求: 36_

### 阶段 4: 职业和技能系统集成

- [x] 11. 创建职业系统 (ClassSystem)
  - [x] 11.1 创建 `src/prologue/systems/ClassSystem.js` 文件
    - 实现职业数据管理（战士、弓箭手、法师）
    - 实现职业选择逻辑
    - 集成现有 SkillTreeSystem（复用技能树系统）
    - 集成现有 UnitSystem（复用兵种系统）
    - 实现兵种特化系统
    - _需求: 19, 20, 21, 22, 23_
  
  - [ ]* 11.2 编写职业系统的属性测试
    - **属性 5: 技能依赖关系正确性**
    - **验证: 需求 21**

### 阶段 5: AI 和战斗系统扩展

- [x] 12. 扩展战斗系统支持大规模战斗
  - [x] 12.1 修改 `src/systems/CombatSystem.js`
    - 添加大规模战斗单位管理
    - 实现友军和敌军自动战斗
    - 实现战场态势计算
    - 实现士气系统
    - 集成现有 ElementSystem（复用元素伤害计算）
    - 集成现有 StatusEffectSystem（复用状态效果系统）
    - 复用现有 CombatEffects（伤害数字、暴击、治疗特效）
    - _需求: 24, 25, 26, 27, 30_
  
  - [ ]* 12.2 编写战斗系统的属性测试
    - **属性 1: 战斗伤害计算一致性**
    - **验证: 需求 5, 24, 25, 26, 27**

- [x] 13. 创建 AI 系统 (AISystem)
  - 创建 `src/prologue/systems/AISystem.js` 文件
  - 实现 AggressiveAI、DefensiveAI、SupportAI 控制器
  - 实现敌人寻路和攻击逻辑
  - 复用现有 MovementSystem（移动和路径寻找）
  - 复用现有 CollisionSystem（攻击判定）
  - _需求: 5, 24, 25, 26, 27_

- [x] 14. 创建历史武将系统
  - [x] 14.1 创建 `src/prologue/entities/HistoricalGeneral.js` 文件
    - 实现历史武将数据结构
    - 实现武将登场特写镜头（复用 CameraSystem）
    - 实现武将特殊技能（复用 SkillTreeSystem）
    - 实现武将撤退逻辑
    - 复用现有 ParticleSystem（武将特效）
    - 复用现有 SkillEffects（技能特效）
    - _需求: 25, 26, 27, 31_
  
  - [ ]* 14.2 编写历史武将系统的单元测试
    - 测试武将登场逻辑
    - 测试武将技能触发
    - 测试武将撤退条件
    - _需求: 31_

- [x] 15. 创建 NPC 招募系统
  - [x] 15.1 创建 `src/prologue/systems/NPCRecruitmentSystem.js` 文件
    - 实现 NPC 数据管理
    - 实现招募条件检查
    - 实现 NPC 加入队伍逻辑
    - _需求: 25, 26, 29_
  
  - [ ]* 15.2 编写 NPC 招募系统的属性测试
    - **属性 6: NPC招募条件一致性**
    - **验证: 需求 25, 26, 29**

### 阶段 6: UI 组件开发

- [x] 16. 创建装备面板 (EquipmentPanel)
  - 创建 `src/prologue/ui/EquipmentPanel.js` 文件
  - 继承现有 UIElement 基类（复用 UI 框架）
  - 实现装备槽位显示
  - 实现装备属性和强化等级显示
  - 实现负属性红色标注
  - 复用现有 UISystem 管理面板生命周期
  - _需求: 4, 14, 18_

- [x] 17. 创建背包面板 (InventoryPanel)
  - 创建 `src/prologue/ui/InventoryPanel.js` 文件
  - 继承现有 UIElement 基类（复用 UI 框架）
  - 实现网格式物品显示
  - 实现物品拖拽功能（复用 InputManager）
  - 实现物品使用/装备按钮
  - _需求: 3, 4_

- [x] 18. 创建商店面板 (ShopPanel)
  - 创建 `src/prologue/ui/ShopPanel.js` 文件
  - 继承现有 UIElement 基类（复用 UI 框架）
  - 实现购买/出售标签页
  - 实现物品列表显示
  - 实现交易按钮和货币显示
  - _需求: 16_

- [x] 19. 创建强化面板 (EnhancementPanel)
  - 创建 `src/prologue/ui/EnhancementPanel.js` 文件
  - 继承现有 UIElement 基类（复用 UI 框架）
  - 实现装备选择界面
  - 实现成功率和消耗显示
  - 实现属性对比预览
  - _需求: 18_

- [x] 20. 创建职业选择面板 (ClassSelectionPanel)
  - 创建 `src/prologue/ui/ClassSelectionPanel.js` 文件
  - 继承现有 UIElement 基类（复用 UI 框架）
  - 实现三个职业卡片显示
  - 实现教官 NPC 显示
  - 实现职业特性和技能树预览（复用 SkillTreePanel）
  - _需求: 19, 20_

- [x] 21. 创建对话框 (DialogueBox)
  - ✅ 创建 `src/prologue/ui/DialogueBox.js` 文件
  - ✅ 继承现有 UIElement 基类（复用 UI 框架）
  - ✅ 实现打字机效果
  - ✅ 实现角色头像显示
  - ✅ 实现对话选项按钮
  - ✅ 复用现有 AudioManager（对话音效）
  - ✅ 创建单元测试（10个测试全部通过）
  - ✅ 创建测试页面 `test/test-dialogue-box.html`
  - ✅ 创建实现文档 `docs/DIALOGUE_BOX_IMPLEMENTATION.md`
  - _需求: 6, 9, 35_

- [x] 22. 创建教程提示 (TutorialTooltip)
  - 创建 `src/prologue/ui/TutorialTooltip.js` 文件
  - 继承现有 UIElement 基类（复用 UI 框架）
  - 实现目标元素高亮
  - 实现提示文本和箭头显示
  - 实现多步骤教程导航
  - _需求: 2, 3, 4, 5, 37_

- [x] 23. 创建任务追踪器 (QuestTracker)
  - 创建 `src/prologue/ui/QuestTracker.js` 文件
  - 继承现有 UIElement 基类（复用 UI 框架）
  - 实现任务列表显示
  - 实现任务进度条
  - 实现任务完成提示
  - _需求: 36_

### 阶段 7: 场景实现 - 第一幕

- [x] 24. 实现第一幕场景 (Act1Scene) **【教程专用简化实现】**
  - [x] 24.1 创建 `src/prologue/scenes/Act1Scene.js` 文件
    - 实现角色创建界面
    - 实现移动教程（简化实现，未使用 MovementSystem）
    - 实现拾取教程（简化实现，未使用 CollisionSystem）
    - 实现装备教程（简化实现，未使用 EquipmentSystem）
    - **注**: 采用教程专用简化实现，不依赖完整 ECS 架构
    - _需求: 1, 2, 3, 4_
  
  - [x] 24.2 实现第一幕战斗系统
    - 实现三波战斗（野狗→官府→土匪）
    - 实现战斗教程（简化实现，未使用 CombatSystem）
    - 实现死亡机制
    - 实现简化的战斗特效（攻击圆圈、伤害数字）
    - **注**: 测试页面直接处理战斗逻辑
    - _需求: 5, 6_
  
  - [x] 24.3 实现第一幕场景过渡
    - 实现黑屏效果
    - 实现场景切换到第二幕（复用 SceneManager）
    - _需求: 7_
  
  - [x] 24.4 创建测试页面和文档
    - 创建 `test/test-act1-scene.html` 测试页面
    - 实现键盘输入处理（WASD移动、E拾取、I背包、空格攻击）
    - 实现鼠标点击移动
    - 创建 `docs/ACT1_SCENE_IMPLEMENTATION.md` 实现文档
    - **注**: 主游戏场景将使用完整的 ECS 架构和核心系统
    - _需求: 1, 2, 3, 4, 5, 6, 7_

- [x] 24.5 **ECS 架构重构** - 完整集成核心系统
  - [x] 创建 `src/prologue/scenes/Act1SceneECS.js` 文件
    - 使用完整的 Entity 和 Component 系统
    - 集成 EntityFactory 创建真实实体
    - 集成 InputManager 处理所有输入
    - 集成 Camera 系统管理视野
    - 集成 CombatSystem 处理战斗
    - 集成 MovementSystem 处理移动
    - 集成 EquipmentSystem 处理装备
    - 集成 RenderSystem 渲染实体
    - 集成 CombatEffects 战斗特效
    - _需求: 1, 2, 3, 4, 5, 6, 7_
  
  - [x] 更新主入口文件 `index.html`
    - 创建完整的游戏界面
    - 添加 UI 覆盖层（教程面板、调试面板）
    - 实现加载屏幕和进度条
    - 实现游戏循环和 FPS 显示
    - 集成教程系统回调
    - _需求: 1, 2, 3, 4, 5, 6, 7_
  
  - [x] 创建重构文档
    - 创建 `docs/ACT1_SCENE_ECS_REFACTOR.md`
    - 记录架构变更和系统集成
    - 提供使用指南和性能优化建议
    - _需求: 1, 2, 3, 4, 5, 6, 7_

- [x] 24.6 **实现渐进式教程提示系统** ✅ **【已完成】**
  - [x] 24.6.1 扩展 TutorialSystem 支持渐进式提示 ✅
    - ✅ 验证 TutorialSystem 已有完整实现
    - ✅ 确认支持优先级队列和自动触发
    - _需求: 1.5_
  
  - [x] 24.6.2 在 Act1SceneECS 中集成渐进式提示 ✅
    - ✅ 注册6条渐进式提示（优先级100-95）
    - ✅ 实现C键完成提示1（查看属性）
    - ✅ 实现WASD移动完成提示2
    - ✅ 实现E键拾取完成提示3
    - ✅ 实现B键背包完成提示4
    - ✅ 实现装备物品完成提示5
    - ✅ 实现V键装备面板完成提示6
    - ✅ 所有触发条件已添加安全检查
    - _需求: 1.5_
  
  - [x] 24.6.3 更新 index.html 显示渐进式提示 ✅
    - ✅ 调整教程面板位置到屏幕顶部（top: 20px）
    - ✅ 增强样式（背景、边框、阴影）
    - ✅ 增大字体提高可读性
    - ✅ 添加淡入动画效果（translateY）
    - ✅ 所有提示标题统一为"提示"
    - ✅ 按键说明已更新（B键背包，V键装备）
    - _需求: 1.5_
  
  - [x] 24.6.4 创建测试和文档 ✅
    - ✅ 更新 `docs/ACT1_SCENE_ECS_REFACTOR.md` 记录新功能
    - ✅ 文档化6条渐进式提示的实现方式
    - ✅ 文档化提示触发条件和完成逻辑
    - _需求: 1.5_

### 阶段 8: 场景实现 - 第二幕和第三幕

- [x] 25. 实现第二幕场景 (Act2Scene)
  - 创建 `src/prologue/scenes/Act2Scene.js` 文件
  - 实现复活和张角粥棚场景
  - 实现符水剧情对话
  - 实现装备升级系统
  - 集成现有 AttributeSystem（属性提升教程）
  - 复用现有 AttributePanel（属性分配界面）
  - 集成现有 SkillTreeSystem（技能学习）
  - 复用现有 SkillTreePanel（技能树界面）
  - _需求: 8, 9, 10, 11, 12_

- [x] 26. 实现第三幕场景 (Act3Scene)
  - 创建 `src/prologue/scenes/Act3Scene.js` 文件
  - 实现铜钱法器剧情
  - 实现负属性展示
  - 实现货币系统
  - 实现商店和强化系统
  - _需求: 13, 14, 15, 16, 17, 18_

### 阶段 9: 场景实现 - 第四幕

- [x] 27. 实现第四幕场景 (Act4Scene)
  - 创建 `src/prologue/scenes/Act4Scene.js` 文件
  - 实现职业选择界面
  - 实现三位教官 NPC 系统
  - 集成现有 SkillTreeSystem（职业技能树）
  - 复用现有 SkillTreePanel（技能树显示）
  - 集成现有 UnitSystem（兵种特化）
  - 复用现有 UnitInfoPanel（兵种信息显示）
  - 集成现有 AttributeSystem（天赋树）
  - _需求: 19, 20, 21, 22, 23_

### 阶段 10: 场景实现 - 第五幕（四场战斗）

- [x] 28. 实现第五幕场景 (Act5Scene)
  - [x] 28.1 创建 `src/prologue/scenes/Act5Scene.js` 文件
    - 实现战斗管理器
    - 实现战斗选择系统
    - 实现战斗结果处理
    - _需求: 24, 28_
  
  - [x] 28.2 实现起义之战
    - 实现大规模战斗
    - 实现占领县城目标
    - _需求: 24, 30_
  
  - [x] 28.3 实现广宗之战
    - 实现救援张梁逻辑
    - 实现曹操登场
    - 实现管骇招募
    - _需求: 25, 29, 31_
  
  - [x] 28.4 实现阳城之战
    - 实现救援张宝逻辑
    - 实现刘关张登场
    - 实现周仓招募
    - _需求: 26, 29, 31_
  
  - [x] 28.5 实现黄巾终战
    - 实现救援张角逻辑
    - 实现众多武将登场
    - 实现张角病逝剧情
    - _需求: 27, 31_
  
  - [ ]* 28.6 编写第五幕战斗的集成测试
    - 测试四场战斗流程
    - 测试救援选择分支
    - 测试 NPC 招募
    - _需求: 24, 25, 26, 27, 28, 29, 30, 31_

### 阶段 11: 场景实现 - 第六幕（结局）

- [x] 29. 实现第六幕场景 (Act6Scene)
  - 创建 `src/prologue/scenes/Act6Scene.js` 文件
  - 实现结局分支系统
  - 实现进度继承系统
  - 实现序章完成奖励
  - _需求: 32, 33, 34_

### 阶段 12: 数据配置和资源

- [x] 30. 创建场景数据配置文件
  - 创建 `src/prologue/data/Act1Data.json`
  - 创建 `src/prologue/data/Act2Data.json`
  - 创建 `src/prologue/data/Act3Data.json`
  - 创建 `src/prologue/data/Act4Data.json`
  - 创建 `src/prologue/data/Act5Data.json`
  - 创建 `src/prologue/data/Act6Data.json`
  - _需求: 所有需求_

- [x] 31. 创建装备和物品数据
  - 创建 `src/prologue/data/EquipmentData.json`
  - 创建 `src/prologue/data/ItemData.json`
  - 定义所有装备属性和负属性
  - _需求: 3, 4, 10, 13, 14_

- [x] 32. 创建敌人和武将数据
  - 创建 `src/prologue/data/EnemyData.json`
  - 创建 `src/prologue/data/GeneralData.json`
  - 定义所有敌人和历史武将属性
  - _需求: 5, 25, 26, 27, 31_

- [x] 33. 创建对话数据
  - 创建 `src/prologue/data/DialogueData.json`
  - 定义所有对话节点和分支
  - _需求: 6, 9, 35_

### 阶段 13: 音效和配乐集成

- [x] 34. 集成音效系统
  - 配置序章主题音乐
  - 配置战斗音乐
  - 配置各种音效（攻击、受伤、拾取、对话等）
  - 复用现有 AudioManager
  - _需求: 39_

### 阶段 14: 测试和优化

- [x] 35. 创建序章测试页面
  - 创建 `test/test-prologue.html`
  - 实现序章快速测试入口
  - 实现场景跳转调试功能
  - _需求: 所有需求_

- [x] 36. 性能优化
  - 优化大规模战斗性能
  - 复用现有 ObjectPool（对象池减少 GC 压力）
  - 复用现有 RenderSystem（视锥剔除优化渲染）
  - 使用空间分区优化碰撞检测
  - 优化场景加载时间（复用 AssetManager 懒加载）
  - 优化内存使用
  - 复用现有 PerformanceMonitor（性能监控）
  - _需求: 30_

- [ ]* 37. 编写端到端测试
  - 测试完整序章流程（第一幕到第六幕）
  - 测试不同职业选择路径
  - 测试不同战斗选择路径
  - 测试进度保存和加载
  - _需求: 所有需求_

### 阶段 15: 文档和收尾

- [x] 38. 更新实现文档
  - 创建 `docs/PROLOGUE_IMPLEMENTATION.md`
  - 记录实现细节和技术决策
  - 记录已知问题和限制
  - _需求: 所有需求_

- [x] 39. 代码审查和重构
  - 审查所有新增代码
  - 重构重复代码
  - 优化代码结构
  - 添加必要的注释
  - _需求: 所有需求_

- [x] 40. 最终测试和验收
  - 运行所有单元测试
  - 运行所有属性测试
  - 运行所有集成测试
  - 验证所有需求的验收标准
  - _需求: 所有需求_

## 检查点

- [x] 检查点 1: 核心系统搭建完成（任务 1-3）
  - 确保所有测试通过
  - 询问用户是否有问题

- [x] 检查点 2: 装备和背包系统完成（任务 4-7）
  - 确保所有测试通过
  - 询问用户是否有问题

- [x] 检查点 3: 教程和对话系统完成（任务 8-10）
  - 确保所有测试通过
  - 询问用户是否有问题

- [x] 检查点 4: 职业和战斗系统完成（任务 11-15）
  - 确保所有测试通过
  - 询问用户是否有问题

- [x] 检查点 5: UI 组件完成（任务 16-23）
  - 确保所有测试通过
  - 询问用户是否有问题

- [x] 检查点 6: 前三幕场景完成（任务 24-26）
  - 确保所有测试通过
  - 询问用户是否有问题

- [x] 检查点 7: 第四幕和第五幕完成（任务 27-28）
  - 确保所有测试通过
  - 询问用户是否有问题

- [x] 检查点 8: 序章完整流程测试通过（任务 29-40）
  - 确保所有测试通过
  - 询问用户是否有问题

## 注意事项

1. **任务标记说明**:
   - `*` 标记的任务为可选任务（主要是测试相关）
   - 核心实现任务必须完成
   - 可选任务可以根据时间和资源情况决定是否实现

2. **测试策略**:
   - 单元测试：验证具体功能和边界情况
   - 属性测试：验证通用正确性属性（使用 fast-check 库，每个测试至少 100 次迭代）
   - 集成测试：验证端到端流程

3. **复用引擎功能**:
   - 充分利用现有的 ECS 架构
   - **核心系统复用**：
     - SceneManager（场景管理和切换）
     - AudioManager（音效和配乐）
     - InputManager（输入处理）
     - AssetManager（资源加载和懒加载）
     - ErrorHandler（错误处理）
     - Logger（日志系统）
   - **游戏系统复用**：
     - CombatSystem（战斗系统，需扩展大规模战斗）
     - MovementSystem（移动系统）
     - AttributeSystem（五大属性系统）
     - SkillTreeSystem（技能树系统）
     - ElementSystem（元素伤害计算）
     - StatusEffectSystem（状态效果）
     - UnitSystem（兵种系统）
     - CollisionSystem（碰撞检测和攻击判定）
   - **UI系统复用**：
     - UISystem & UIElement（UI 组件管理）
     - AttributePanel（属性分配面板）
     - SkillTreePanel（技能树面板）
     - StatusEffectBar（状态效果显示）
     - UnitInfoPanel（兵种信息面板）
   - **特效系统复用**：
     - ParticleSystem（粒子特效）
     - SkillEffects（技能特效）
     - CombatEffects（伤害数字、暴击、治疗）
   - **性能优化复用**：
     - ObjectPool（对象池）
     - PerformanceMonitor（性能监控）
     - RenderSystem（渲染优化、视锥剔除、背景缓存）

4. **数据驱动**:
   - 所有场景、对话、装备、敌人数据都通过 JSON 配置
   - 便于后期修改和扩展

5. **性能目标**:
   - 60 FPS 稳定帧率
   - 场景加载时间 < 2秒
   - 大规模战斗（100+单位）保持 30+ FPS

6. **开发规范**:
   - 遵循项目代码风格（ES6+、PascalCase 类名、camelCase 方法）
   - 采用 ECS 架构
   - 保持模块化和可扩展性
   - 核心功能必须有单元测试
   - 所有测试文件放在 test 文件夹
   - 所有文档放在 docs 文件夹
