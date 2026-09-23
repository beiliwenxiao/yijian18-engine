# 一剑十八年引擎(YiJian18-Engine) - 跨平台2D/3D ECS 游戏引擎

一剑十八年引擎(YiJian18-Engine)-跨平台 2D/3D ECS 游戏引擎。
采用 Entity-Component-System (ECS) 架构设计。
前期采用Kiro开发，使用Claude opus 4.6、GPT 5.6 sol、GLM 5.2等模型。
现在开始采用TareCode CN开发，使用GLM 5.3 Flash,DeepSeek 4.1 Flash,Kimi K3等模型
核心系统与游戏逻辑完全分离，支持 Canvas 2D 和 three.js 3D 双渲染后端，
支持魂系动作RPG游戏，并留有多人在线游戏的后续可能。

取名故事：2008年我主程的第一款游戏《铁血英雄》上线，当时在凤天工作室。
后来因为各种原因，转战电商行业，直到2026年，仍然在做电商相关的工作(小程序：值得爱生活服务)。
这中间，正好是十八年。作为一个大龄程序员(2026年45岁)，职业生涯已经见底，却无任何可以拿出手的作品。
而我曾经的同事，却有不少大神级作品。
再加上AI的方便，正好做做以前想做而没空做的项目。游戏正是其中一项。
年轻时划出一剑，转眼已经过了十八年。于是取名一剑十八年。
![闻箫工作室](example/sanguo_zhangjiao/assets/images/闻箫工作室.png)

闻箫工作室 官方QQ群:58607027

![地图编辑器](editor/map_editor.png)


感谢以下图片来源：

感谢元宝！
有大量图片由元宝AI生成。

图片来源：https://opengameart.org

https://opengameart.org/content/2d-lost-garden-zelda-style-tiles-resized-to-32x32-with-additions

图标来源：ravenmore.itch.io

## 🎮 立即开始

### 快速启动

1. 克隆项目
当前可用版本是v0.0.2
   ```bash
   git clone -b v0.0.2 --single-branch --depth 1 https://gitee.com/coderaaa/yijian18-engine.git

   或 
   
   git clone -b v0.0.2 --single-branch --depth 1 https://github.com/beiliwenxiao/yijian18-engine.git

   cd yijian18-engine
   ```

2. 安装依赖
   ```bash
   npm install
   ```

3. 启动开发服务器
   ```bash
   npm run dev
   ```

4. 打开浏览器访问示例项目
   ```
   http://localhost:3000/example/sanguo_zhangjiao/index.html
   ```

### 运行 Demo 项目

三国张角序章 Demo 位于 `example/sanguo_zhangjiao/` 目录。

**方式一：Vite 开发服务器（推荐）**

```bash
npm run dev
```

然后访问：`http://localhost:3000/example/sanguo_zhangjiao/index.html`

**方式二：直接打开文件**

直接在浏览器中打开 `example/sanguo_zhangjiao/index.html`（部分功能可能受限于跨域策略）

### 渲染模式切换

Demo 支持双渲染后端，通过 URL 参数切换：

- `?mode=2d` - Canvas 2D 渲染（默认）
- `?mode=3d` - three.js 3D 渲染 (目前支持不足)
- `?mode=auto` - 自动选择（WebGL 可用时优先 3D）

示例：
```
http://localhost:3000/example/sanguo_zhangjiao/index.html?mode=3d
```

## 📖 项目介绍

本项目是一个通用的 HTML5 游戏引擎框架，采用 ECS 架构设计，核心系统与游戏逻辑分离。

### 引擎特性

- **ECS 架构**：Entity-Component-System 高性能游戏架构
- **模块化设计**：核心系统与业务逻辑完全分离
- **双渲染后端**：支持 Canvas 2D 和 three.js 3D 渲染
- **可扩展性**：易于添加新系统和组件

### 示例项目

`example/sanguo_zhangjiao/` 是基于本引擎开发的完整游戏示例
![游戏预览](example/sanguo_zhangjiao/assets/images/003.png)

## 🏗️ 项目结构

```
.
├── src/                       # 引擎框架（核心）
│   ├── core/                  # 核心引擎
│   │   ├── GameEngine.js      # 游戏引擎
│   │   ├── InputManager.js    # 输入管理
│   │   ├── SceneManager.js    # 场景管理
│   │   ├── AssetManager.js    # 资源管理
│   │   ├── AudioManager.js    # 音频管理
│   │   ├── GameLoader.js      # 数据驱动装配器
│   │   ├── Blackboard.js      # 全局变量黑板
│   │   ├── WorldStreamingManager.js # 九宫格流式加载
│   │   ├── LoadedChunk.js     # 地图块管理
│   │   ├── Registry.js        # 通用定义注册表
│   │   ├── RNG.js             # 可注入种子随机数
│   │   ├── PerformanceMonitor.js
│   │   ├── ObjectPool.js      # 对象池
│   │   └── ...
│   ├── ecs/                   # ECS 架构
│   │   ├── Entity.js
│   │   ├── Component.js
│   │   ├── EntityFactory.js
│   │   └── components/        # 组件定义
│   ├── systems/               # 游戏系统
│   │   ├── CombatSystem.js
│   │   ├── MovementSystem.js
│   │   ├── EquipmentSystem.js
│   │   ├── DialogueSystem.js
│   │   ├── TriggerSystem.js   # 触发器系统（数据驱动事件）
│   │   ├── ExpressionEngine.js # DSL 条件求值
│   │   ├── TriggerActions.js  # 动作注册表
│   │   ├── VehicleSystem.js   # 载具驾乘系统
│   │   ├── TutorialSystem.js
│   │   ├── QuestSystem.js
│   │   ├── resolvers/         # 纯函数结算器
│   │   │   ├── CombatResolver.js
│   │   │   ├── LootResolver.js
│   │   │   └── QuestResolver.js
│   │   └── ...（30+ 系统）
│   ├── rendering/             # 渲染系统
│   │   ├── backends/          # 双渲染后端
│   │   │   ├── Canvas2DBackend.js
│   │   │   ├── ThreeBackend.js
│   │   │   └── ...
│   │   ├── Camera.js
│   │   ├── ShapeRenderer.js   # 统一形状渲染器
│   │   ├── WorldTerrainRenderer.js # 全局地形渲染（空间索引）
│   │   ├── RenderSystem.js
│   │   ├── ParticleSystem.js
│   │   └── ...
│   ├── ui/                    # UI 组件
│   │   ├── DialogueBox.js
│   │   ├── InventoryPanel.js
│   │   ├── PlayerInfoPanel.js
│   │   ├── DebugPanel.js      # 调试面板
│   │   ├── PanelLayoutLoader.js # 面板布局加载器
│   │   ├── UILayoutLoader.js  # UI 布局加载器
│   │   ├── SkillTreePanel.js
│   │   └── ...（25+ 组件）
│   ├── scenes/                # 通用场景
│   │   ├── LoginScene.js
│   │   ├── CharacterScene.js
│   │   └── GameScene.js
│   ├── data/                  # 数据层
│   └── network/               # 网络通信
│       ├── NetworkManager.js
│       ├── WebSocketClient.js
│       └── MockWebSocket.js
├── editor/                    # 地图/UI/面板编辑器
│   ├── index.html             # 编辑器入口
│   ├── SceneEditor.js         # 场景编辑器主入口
│   ├── SceneEditorUI.js       # UI 模块
│   ├── SceneEditorCanvas.js   # 渲染模块
│   ├── SceneEditorInteraction.js # 交互模块
│   ├── PanelEditor.js         # 面板编辑器（新）
│   ├── UIEditor.js            # UI 布局编辑器
│   ├── TriggerEditor.js       # 事件/触发器编辑器
│   ├── DialogueGraphEditor.js # 对话图编辑器
│   ├── LibraryEditor.js       # 内容库编辑器
│   ├── WorldMapEditor.js      # 世界地图编辑器
│   └── config/                # 编辑器配置
├── example/                   # 示例项目
│   └── sanguo_zhangjiao/      # 三国张角序章
│       ├── index.html         # 入口文件
│       ├── assets/            # 资源文件
│       ├── scenes/            # 场景（数据驱动）
│       ├── config/            # 运行时配置
│       │   ├── PanelLayout.json    # 面板布局
│       │   ├── UILayout.desktop.json
│       │   └── UILayout.mobile.json
│       ├── game.project.json  # 工程数据源（触发器/对话/任务/库）
│       ├── data/              # 剧情数据
│       └── entities/          # 实体定义
├── test/                      # 测试文件
├── docs/                      # 项目文档
└── package.json
```

## 🎯 核心系统

### 引擎核心

| 系统 | 说明 |
|------|------|
| GameEngine | 游戏引擎核心，管理游戏循环 |
| InputManager | 统一输入处理（键盘、鼠标、触摸） |
| SceneManager | 场景管理与切换 |
| AssetManager | 资源加载与管理 |
| AudioManager | 音频播放与管理 |
| GameLoader | 数据驱动装配器（读 game.project.json 装配所有系统） |
| Blackboard | 全局变量黑板（触发器/条件的状态容器） |
| WorldStreamingManager | 九宫格流式加载管理器 |
| LoadedChunk | 地图块实例化/状态持久化 |
| Registry | 通用定义注册表（NPC/敌人/物品/装备等） |
| PerformanceMonitor | 性能监控 |
| ObjectPool | 对象池，减少 GC 压力 |

### 游戏系统

| 系统 | 说明 |
|------|------|
| TriggerSystem | 触发器系统（数据驱动：条件→动作，支持启用/停用） |
| ExpressionEngine | DSL 条件求值（JSON 表达式） |
| CombatSystem | 战斗系统 |
| MovementSystem | 移动系统 |
| EquipmentSystem | 装备系统 |
| DialogueSystem | 对话系统 |
| VehicleSystem | 载具驾乘系统（上下车/席位/intent路由） |
| TutorialSystem | 教程系统 |
| QuestSystem | 任务系统 |
| ClassSystem | 职业系统 |
| SkillTreeSystem | 技能树系统 |
| ShopSystem | 商店系统 |
| AISystem | AI 行为系统 |
| ... | 更多系统（30+） |

### 渲染系统

| 系统 | 说明 |
|------|------|
| RenderSystem | 渲染系统（视锥剔除、批量渲染） |
| Canvas2DBackend | Canvas 2D 渲染后端 |
| ThreeBackend | three.js 3D 渲染后端 |
| ShapeRenderer | 统一形状渲染器（5种形状 + 5种填充 + 边缘淡化） |
| WorldTerrainRenderer | 全局地形渲染（空间网格索引 + 视口裁剪） |
| ParticleSystem | 粒子系统 |
| CombatEffects | 战斗特效 |
| SkillEffects | 技能特效 |

### UI 组件

| 组件 | 说明 |
|------|------|
| DialogueBox | 对话框 |
| InventoryPanel | 背包面板（数据驱动布局） |
| PlayerInfoPanel | 属性/装备面板（数据驱动布局） |
| BottomControlBar | 底部控制栏（血球/蓝球/技能槽，已原子化拆分） |
| DebugPanel | 调试面板（帧率/属性/敌人/触发器/跳转） |
| PanelLayoutLoader | 面板布局加载器（读 PanelLayout.json） |
| UILayoutLoader | UI 布局加载器（读 UILayout.json） |
| SkillTreePanel | 技能树面板 |
| ShopPanel | 商店面板 |
| ... | 更多组件 |

## 🎮 控制方式

### 键盘

| 按键 | 功能 |
|------|------|
| W/A/S/D 或 方向键 | 移动 |
| E | 拾取物品 |
| C | 属性面板 |
| V | 装备面板 |
| B | 背包 |
| N | 进入下一幕 |
| 空格 | 攻击 |
| 1-4 | 使用技能 |
| Q | 格挡 |
| Ctrl+左键 | 轻功瞬移 |
| Shift+左键 | 投掷武器 |
| ` (反引号) | 切换调试面板 |

### 鼠标

- 左键点击物品：拾取
- 左键点击空白：攻击
- 右键点击：移动到目标位置

## 🐞 调试面板

按 **`** 键（反引号，键盘左上角）打开/关闭调试面板。

调试面板显示：
- **FPS**：实时帧率
- **玩家位置**：世界坐标 X, Y
- **当前幕**：幕数 + 标题
- **玩家属性**：HP/MP/攻击/防御/速度/等级
- **敌人情况**：当前存活敌人数
- **触发器状态**：总计/待触发/最近触发的触发器 ID

调试面板操作：
- **上一事件 / 下一事件**：浏览待触发的触发器列表
- **执行事件**：强制触发当前选中的触发器
- **跳过事件**：标记当前触发器为已触发（跳过）
- **跳转到指定幕**：下拉选择 1-6 幕，立即切换

也可通过触发器动作 `toggleDebug` 在编辑器中配置自动开启。

## 🗺️ 编辑器

编辑器位于 `editor/` 目录，通过 `http://localhost:3000/editor/` 访问。

### 编辑器 Tab

| Tab | 功能 |
|-----|------|
| 场景编辑器 | 地图绘制：形状/图集/装饰物/逻辑对象，多图层，全选/复制/粘贴 |
| UI 编辑器 | PC/移动端 UI 布局调整，面板真实预览 |
| 面板编辑器 | 属性/装备/背包等面板内部部件的可视化编辑 |
| 事件编辑器 | 触发器配置（条件→动作），支持启用/停用 |
| 对话编辑器 | 对话节点图（分支/条件/动作） |
| 内容库 | 职业/技能/天赋定义 |
| 世界地图 | 大地图网格分配场景，缩略图预览 |

### 面板编辑器（新）

可视化编辑游戏 UI 面板的内部组成部件：

- 每个面板是一个 **Tab**（可新增/修改/删除）
- 面板内每个部件（标题/装备槽/属性行/物品格子/按钮/滚动条等）都可以：
  - 拖拽调整位置
  - 缩放手柄调整大小
  - 右侧属性面板修改名称、颜色、字体等
- 面板边缘可拖拽调整面板整体大小
- 保存到 `config/PanelLayout.json`，游戏运行时自动读取

支持的部件类型：文本、分隔线、按钮、装备槽、物品格子、属性行、滚动条、图标、进度条、图片。

### 事件编辑器（触发器）

数据驱动的游戏流程控制：

- **触发器结构**：`when`（事件类型）→ `if`（条件）→ `do`（动作序列）
- **事件类型**：sceneEnter / kill / dialogueEnd / itemPickup / equipItem / classSelected / waveCleared / timer / sceneComplete 等
- **动作类型**：setVar / showTip / startDialogue / giveReward / heal / promptSwitch / spawnGroup / toggleDebug 等
- **启用/停用**：每个触发器可单独启用或停用，方便调试测试不同效果
- 所有幕切换都通过触发器 `promptSwitch` 动作实现（按 N 键确认切幕）

### 场景编辑器增强

- **全选/复制/粘贴**：工具栏按钮（避免浏览器热键冲突）
- **全局图集共享**：所有场景自动可用全部图集资源
- **通用场景渲染**：任何幕（Act1-6）在编辑器中创建场景后，游戏自动加载渲染

## 🌍 大地图流式系统

支持无缝大地图（九宫格流式加载）：

- **WorldStreamingManager**：玩家周围 3×3 格加载，远离 >2 格卸载
- **LoadedChunk**：管理每个地图块的实体/状态，支持持久化（回头怪不复活）
- **WorldTerrainRenderer**：全局地形按视口裁剪渲染，空间网格索引加速
- **世界坐标统一**：相机/实体/碰撞全部使用世界坐标

## 📚 文档

- [快速启动指南](docs/QUICK_START_ECS.md)
- [游戏核心架构](docs/GAME_CORE_ARCHITECTURE.md)
- [ECS 快速入门](docs/QUICK_START_ECS.md)
- [引擎特性](docs/ENGINE_FEATURES.md)
- [性能优化指南](docs/PERFORMANCE_OPTIMIZATION_GUIDE.md)
- [故障排除](docs/TROUBLESHOOTING.md)

## 🔧 开发

### 环境要求

- Node.js 14+
- npm 或 yarn

### 常用命令

```bash
npm install          # 安装依赖
npm run dev          # 启动 Vite 开发服务器
npm run build        # 构建生产版本
npm test             # 运行单元测试（Vitest）
```

### 代码规范

- 使用 ES6+ 语法
- 类名使用 PascalCase
- 方法和变量使用 camelCase
- 常量使用 UPPER_SNAKE_CASE
- 遵循 ECS 架构

## 🚀 性能

### 目标

- FPS: 60（稳定）
- 实体数量: 100+
- 内存使用: < 100MB

### 优化措施

- 视锥剔除：只渲染可见实体
- 对象池：减少 GC 压力
- 批量渲染：提高渲染效率
- 离屏 Canvas：缓存静态内容

## 🤝 贡献

欢迎贡献代码！

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

### 使用的技术

- HTML5 Canvas / three.js - 游戏渲染
- ES6+ JavaScript - 现代 JavaScript
- ECS 架构 - 高性能游戏架构
- Vite - 构建工具
- Vitest - 单元测试框架
- WebSocket - 多人在线通信

---

项目状态: 活跃开发中
当前版本: 0.0.2
