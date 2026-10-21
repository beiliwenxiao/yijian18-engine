---
inclusion: always
---

# 客户定制要求

## 项目定制规范

### 代码风格
- 使用 ES6+ 语法
- 类名使用 PascalCase
- 方法和变量使用 camelCase
- 常量使用 UPPER_SNAKE_CASE
- 文件名使用 PascalCase（类文件）或 camelCase（工具文件）

### 架构要求
- 采用 ECS（Entity-Component-System）架构
- 保持模块化和可扩展性
- 核心系统与游戏逻辑分离
- 使用依赖注入模式

### 性能要求
- 目标帧率：60 FPS
- 支持至少 100 个同时在线玩家
- 资源加载使用懒加载策略
- 优化渲染性能，减少重绘

#### Canvas 2D 离屏缓存禁忌（长帧根因约定）
- **禁止「视口级离屏缓存 + 每帧整屏 blit」**：把一整张视口大小（视口 + 外扩余量）
  的离屏 Canvas 每帧 source-over 到主画布，等于每帧多刷一遍全屏像素
  （2x DPR 背板下 1280×720 视口 ≈ 3.7M 像素），直接把帧时间顶过 33ms。
  根因是这类画布绝大多数像素全透明，但 source-over 仍逐像素混合。
- 离屏缓存只用于「内容与画布尺寸固定」的场景层（地面/背景/图集切片），
  且缓存尺寸要贴合实际内容包围盒，不要按视口开。
- 视口相关、需要随相机移动的静态层（树影等），改为**按对象逐个绘制**
  （一次小 drawImage），成本与可见对象数线性相关，不产生整屏 overdraw，
  也没有「相机移动半屏就重烘焙一次」的周期性抖动。
- Canvas 2D 是延迟光栅：主画布的绘制命令先录制成 display list，
  光栅化在 flush 点才发生。**帧内耗时的归属会随 flush 点漂移**
  （同一段成本可能这帧记在 build 段、下帧记在 draw 段），
  所以定位长帧要看「这一帧多画了什么」，不能只看热点落在哪个函数。
- 逐帧新建渐变、逐帧 `ctx.shadowBlur`、`globalCompositeOperation='multiply'`
  与 `willReadFrequently` 一律视为性能杀手（见 美术资源 / 阴影实现约定）。

### 测试要求
- 核心功能必须有单元测试
- 测试覆盖率目标：80%+
- 使用 Vitest 作为测试框架
- 提供独立的测试页面用于功能验证
- 所有测试用的 .html 文件统一放在 test 文件夹中管理
- 项目根目录只保留 index.html 主入口文件

### 文档要求
- 每个模块必须有 README.md
- 复杂函数需要 JSDoc 注释
- 保持实现总结文档更新
- API 变更需要记录
- 所有 .md 文档统一放在 docs 文件夹中管理
- 项目根目录只保留 README.md 文件

### 网络通信
- 使用 WebSocket 进行实时通信
- 支持断线重连机制
- 消息格式使用 JSON
- 实现心跳检测

### 游戏特性
- 支持多场景切换
- 角色创建和选择系统
- 实时战斗系统
- 背包和装备系统
- 社交和组队功能

## 骨骼动画变换语义

- **`bone.length` 是纯视觉属性**：只决定编辑器骨条画多长，**不进任何变换矩阵**，
  不影响挂图尺寸、不影响子骨位置（与 Spine 一致）。编辑器里拖「骨骼自身方向末端黄点」
  才是改长度；沿骨条拖 8 手柄改的是 `scaleX/scaleY`（骨架比例），不是长度。
- **挂图默认不跟随骨骼缩放**：`slot.follow` 缺省 `noScale`——渲染时挂图只取骨骼的
  位置与旋转，不乘骨骼世界缩放（等价 Unity「骨骼缩放=顶点变形、贴图尺寸独立」）。
  需要 squash & stretch 的挂件显式设 `follow='bone'`。
- **骨骼继承模式** `bone.inherit`（Spine Transform Mode 等价，决定本骨骼如何继承父级）：
  `normal`（全继承，缺省）/ `noScale`（继承位移+旋转，不继承父级缩放）/
  `noRotation`（继承位移+缩放，不继承父级旋转）/ `translationOnly`（只继承父级位移）。
- 编辑器预览、命中、拖拽与运行时 `SkeletonRenderer` 必须同一口径：挂图绘制尺寸与挂点
  偏移的度量单位都按 follow 取缩放系数（`editor/SkeletonEditorGeometry.js` 是共用内核）。
- 现有骨骼资产的 `scaleX/scaleY` 全为 1 或缺省，因此上述语义切换对存量内容零影响。

### 方向形态（正面/侧面/背面/斜前/斜后）

- 角色外观按 **7 个形态**组织（左右两侧靠整体 flipX 镜像复用同一套图）：
  `down` 正面基准 / `side` 侧面 / `up` 背面 / `SE` 斜前右 / `SW` 斜前左 / `NE` 斜后右 / `NW` 斜后左。
- **共享定义在 `src/animation/SkeletonDirection.js`**：形态键集合、显示名、朝向→形态映射
  （`resolveDirectionKey`）、斜向头部显隐表（`SKELETON_HEAD_SLOT_PLAN`）、斜向剪辑回退表。
  运行时状态映射器与编辑器预览共用同一份，不要各自维护副本。
- **每形态可配两类数据**（存 `attachment.directionOffsets[形态键]`）：
  偏移 `x/y/rot` + **形态图** `assetId/width/height`（不同形态用不同部件图）。
  未配置该形态 → 逐字段回退顶层，即「沿用正面基准图」，运行时与编辑器预览同口径。
- 编辑器：工具条 7 个方向按钮；槽位检查器「形态图」区（部件图下拉 + 绘制宽高 + 置空回基准）。
- 斜向专属动画剪辑命名 `walk_SE` / `idle_SW` 等；缺失时回退正/背剪辑
  （`SKELETON_DIAGONAL_FALLBACK`，与附件形态回退是两套语义，不要混用）。

### 骨骼局部坐标系（单一来源约定）

- **剪辑关键帧的 x/y 是绝对局部值**（`SkeletonPose.sampleClip` 采样时整列替换 rest，
  缺该字段才回退 rest）。因此 `bones` 的 rest 坐标必须与所有剪辑键值**同源**，
  否则「该剪辑缺某骨轨道」的骨骼会落到另一套坐标系 → 实机人物变形。
- 资产上以 `meta.coordinateSpace: 'canonical-v1'` 标记归一化后的坐标系版本；
  迁移脚本 `scripts/normalize-player-skeleton-space.mjs` 幂等（已是该版本则跳过）。
- 历史教训：同一资产曾并存三套局部坐标（旧 rest 系 / gen 原设计系 / 现行系），
  且「骨骼左右语义交换」只翻了部分轨道的 x 符号。**改 bones 布局后必须重新标定
  依赖旧布局的形态偏移**，否则侧/背形态腿会悬空（实测 12~26px）。
- **判定坐标系归属要看动画实际表现，不能只看单帧数值**：用
  `scripts/audit-player-skeleton-clips.mjs`（逐剪辑首帧世界坐标对比）与
  `scripts/diff-skeleton-render.mjs`（逐帧像素差）交叉验证。

### 形态偏移模板（美术摆位依据）

- 模板生成 `scripts/apply-form-template.mjs`，输出
  `assets/skeletons/presets/player.form-template.json`（含逐槽位逐形态的偏移与真人比例参照）。
- 推导模型：部位在形态 F 下的目标内容中心
  `x = 体轴 + 横向偏移·cos(θF) + 前后深度·sin(θF)`，`y` 取正面形态的解剖高度。
  θF：down 0° / side 90° / up 180° / SE·SW 45° / NE·NW 135°。
  横向偏移由**正面形态渲染实测**反推（不是魔数）；前后深度是解剖表（头 +2、背挂点 −4）。
- 派生效果：side 四肢横向投影收拢到体轴（双腿重叠）；up 横向整体镜像（背面左右互换）；
  斜向介于两者之间。头/发三态槽位（headSide/headBack/hairSide/hairBack）共用同一 landmark，只换图。
- **左向朝向由实体级 `sprite.flipX` 整体镜像**（`PlayerSkeletonStateMapper.isMirroredFacing`），
  故 SW 与 SE、NW 与 NE 的偏移数值相同，数据里不要再翻一次 x。
- 形态图在运行时只有两档：**精确匹配该形态 → 回顶层基准图**（`resolveAttachmentOffset`
  无中间级回退）。需要基准形态图的形态（NE/NW 斜后视用背面图）由模板生成时
  **显式继承写入** `directionOffsets.assetId`（`apply-form-template.mjs`）——
  推导用图与运行时渲染图必须同源，否则偏移按 A 图解、画面画 B 图。
  头部三态槽位例外：斜向换图靠 `SKELETON_HEAD_SLOT_PLAN` 显隐切换，不走 assetId。
- 换图后只需微调偏移：求解式已把图 pivot 差自动吸收
  （`挂点偏移 = R⁻¹(目标内容中心 − 骨世界位姿 − R·内容中心偏移)`）。

### 真人比例（7.5 头身）参照

- 模板文件 `humanProportionReference` 段给出 landmark 表（占身高比例，脚底=0、头顶=1）：
  眼 93% / 颏 87% / 肩 82% / 胸 72% / 脐 60% / 髋 48% / 膝 28.5% / 踝 4% /
  肘 63% / 腕 48.5%；肩宽约 2 头宽，腿长占 47%。
- 当前 player.json 部件图是 **Q 版（约 4.5~5 头身、头偏高、腿偏短）**，
  与真人比例的差距由美术重绘部件图消除，脚本不改部件图本身。
  实测差距用 `scripts/audit-form-template.mjs` 复核。

### transform 约束（挂件跟随挂件）

- 数据在 `doc.constraints`：
  `{ type:'transform', slot, target, mix, offsetX, offsetY, offsetRot, followRotation }`。
- 求解内核 `src/animation/SkeletonConstraint.js`（运行时渲染器与编辑器预览共用同一份）。
- 渲染/预览都是**两遍**：先算所有槽位锚点 → 应用约束 → 绘制（跟随者要先拿到目标锚点）。
- 校验器要求约束引用的槽位存在；Spine 侧无「附件跟随附件」等价物，导出时记有损。

### 曲线烘焙（运行时查表）

- `src/animation/SkeletonBake.js`：按固定步长（默认 20ms）预采样成 Float32Array 表，运行时查表 + 线性插值。
- 烘焙取值**必须复用引擎自己的 `sampleClip`**（别另写一份插值，语义会漂移）。
- 字段名坑：局部姿势对象是 `sx/sy`，烘焙表列名是 `scaleX/scaleY`（写错会静默失效）。

### 骨骼导出（Spine 格式）

- 导出器 `src/dev/SkeletonSpineExporter.js`（纯函数）+ `scripts/export-skeleton-spine.mjs`
  （离线脚本：sharp 合成图集 + 落盘 + 报告）。
- 输出 **Spine 3.8 格式**（兼容性最广：spine-canvas / Spine Unity / cocos-spine）。
- 映射要点：Spine transform ↔ 本引擎 `inherit`；**Spine 时间轴是相对 setup 的增量/比例**
  （导出必须转差值/比值）；缺省帧在本引擎是「取下一有效值」的阶跃，导出要补阶跃关键帧；
  命名缓动映射为贝塞尔控制点（easeInOut → [0.42,0,0.58,1]，属近似）。
- **方向形态 → 一形态一个 skin**（skin 名 = 形态键），目标端按方向 `setSkin` 切换。
- 有损项必须写进 `export-report.json`（`report.lossy`）：`inherit=noRotation`、`slot.follow=noScale`
  （Spine 附件天然跟随骨骼缩放）、sequence 附件、循环回绕插值、transform 约束。

### IK 约束

- **IK 求解器在 `src/animation/SkeletonIk.js`（纯函数）**：两类——`aim` 链式朝向 IK
  （根骨对齐目标方向、链内相对偏角保持，等价 Spine IK constraint）与 `twoBone` 位置 IK
  （CCD 迭代，链末端原点命中目标，等价 Unity TwoBoneIK；对任意局部偏移都收敛）。
- **IK 数据不进资产 JSON**：编辑器侧是工具态（`SkeletonEditor._ikTool`），拖目标点实时求解
  并**直接写回 FK**（动画模式打 rot 关键帧 / 装配模式写静止姿态）——即「用 IK 摆姿势并烘焙
  成 FK」，导出与运行时不残留 IK。运行时侧是实体本地约束
  （`SkeletonComponent.setIkConstraints/setIkTarget`），目标点用骨骼资产坐标系。
- **骨链必须是连续父子链**（`resolveIkChain` 校验），非法链整条约束被安全忽略。
- IK 求解改写的是**局部 rot**，因此任何导出格式都只需处理 FK 关键帧。

## 开发流程
1. 功能开发前先更新 spec 文档
2. 实现功能并编写测试
3. 创建独立测试页面验证
4. 更新相关文档
5. 提交代码前运行所有测试

## 注意事项
- 避免使用全局变量
- 及时清理事件监听器
- 注意内存泄漏问题
- 保持代码简洁可读

## 修复失败测试的判定顺序
改测试前必须先判定失败根因，按序核查三种可能，禁止直接改断言凑绿：
1. **功能本身不存在或已被删除**——先查被测数据/接口是否还在（如引用的事务定义、任务步骤 id 是否被内容迭代删掉）；不存在则测试应改为自持数据或删除该用例，而不是硬凑。
2. **功能已被修改演进**——先跑探针/实际调用拿当前真实行为，确认是合法演进（如数据修齐、格式升级）后，按新语义更新断言与 golden 快照；若是被测代码的 bug（如漏登记 schema、行为与设计不符），修被测代码而非测试。
3. **测试自身错误**——漏 import（vi 等）、环境声明缺失（浏览器侧模块需 `// @vitest-environment jsdom`）、断言引用了错误的字段/元素（如 Component 用 `type` 不是 `name`）、超时余量不足。
判定依据必须来自实际验证（打印实际值、查数据源、读实现），不凭猜测改期望值。

## 调试模式
- BaseGameScene 有 `this.debugMode` 属性（默认 false）
- 开启方式：控制台执行 `sceneManager.getCurrentScene().debugMode = true`
- 右键移动的绿色落点光圈是正式功能，始终显示，不受 debugMode 影响
- 新增调试功能时，遵循同样模式：正式功能始终显示，调试信息用 `if (this.debugMode)` 包裹

## Kiro新版本函数有变化，使用以下方法
- fsWrite: parameters required: ["path", "text"]
- fsAppend: parameters required: ["path", "text"]

## 美术资源

- 缺图时默认自动生成并接入，不要询问、不要留代码色块或兜底圆点、不要以"美术待补"跳过。
- 先复用：已在 `assets/manifests/assets.json` 或 `assets/images/` 中的资源直接引用其稳定 ID，同一内容不重复建 ID、不重复生成。
- 生成格式优先手写 SVG，放 `assets/images/<场景或分类>/`，文件名 kebab-case；不放大低分辨率图冒充高清。
- 世界物件 pivot 用脚底中心 `{x:0.5,y:1}`，UI 图标用居中；尺寸和配色对齐同类已有资源与 `config/presentation.json` 的 `palette`。
- 必须在 Manifest 登记：`assetId` 与 `imageId` 同值，命名 `<场景或域>.<类别>.<名称>`，生成图 `status: ai-generated`。
- 内容定义（items / resourceNodes / enemies / npcs 等）写稳定 `imageId` 加 sprite 尺寸；场景 JSON 只引用 ID，禁止硬编码图片路径。
- 若某类对象的渲染路径还不消费稳定 ID，先把"稳定 imageId 优先 → 已有手绘或代码样式 → 通用兜底"补进框架渲染器并让放置点预载图片，再接内容；不在 Demo 另写图片解析。
- 稳定 ID 必须贯穿整条链路：拾取、奖励、装备和存档在复制物品字段时都要带上 `imageId/assetId`，否则同一物品在地面有图、进背包却退回手绘或首字占位。
- 生成图是可替换的临时资产：换正式美术时保留原 ID 和场景引用，只替换文件；图片只属表现层，不作业务事实源。
- 完整流程见 `yijian18-game-demo-development-plan.md` 第 15.1 节。

## 用户约束
- 用中文回答
- 当前工作区禁止发起任何子代理请求：不得调用 `context-gatherer`、`introspect`、`general-task-execution`、`semantic_reviewer` 或其他子代理；不得为调查、确认 Kiro 行为、代码分析或实现任务请求子代理审批。必须直接使用已提供的工具完成工作。
- 执行task时，当完成一个小任务后，继续往后执行，拥有所有权限。
- 描述工作项时使用开发计划中的正式阶段和小节名称（例如“P4.5 载具、运输和攻城”），不得使用仅存在于对话摘要中的“TASK 13”等临时编号；需要细分时在正式名称后补充具体功能名。
- 不要主动创建新的文档和总结。
- 所有功能，优先使用和复用已有系统的功能。
- 不要每次都写文档。除非我要求，否则不要写文档。
- 可以创建测试页面。
- 调试完成后，如果要删除调试信息，要先询问我是否同意删除。不要自动删除。
- 如果框架有功能，则优先使用框架功能，如果框架没有功能，则自己实现，并且将功能添加到框架中。
- 在zhangjiao的demo中，装备栏 就是指 PlayerInfoPanel
- 允许（并且应该）根据每次对话中新学到的知识，主动更新 `.trae/rules/` 下已有的规则文档，无需再询问。这是"不要主动写文档"的例外。
  - 适用：修正与代码不一致的描述（如快捷键、API 签名、字段名、文件路径）、补充新踩到的坑与其根因、记录新加入框架的通用能力。
  - 边界：只更新**已存在**的规则文档；新建规则文件仍需先征得同意。不把一次性的调试过程、任务进度、完成总结写进去。
  - 要求：写根因和约定，不写变更日志；改完在回复里说明改了哪个文件的哪一条。
- fsWrite 单次传大文本时会失败，要用分段写入。
- 终端操作优先使用简短、可读且单一用途的命令；避免长串 inline Node/PowerShell 脚本、复杂嵌套引号和多重命令链。需要组合校验时，拆为可以独立观察输出的短命令。
- 任一工具操作或实现步骤卡住超过 60 秒时，立即停止等待并改用另一种更小粒度或不同工具的方式；同一目标连续尝试三次仍卡住时，自动停止该目标并在回复中说明阻断，不继续无限重试。
- 修改功能时，不要管 desktop 内的文件，因为那是打包为 exe 用的。
- 修改完成后，不得自动运行 diagnostics、`node --check`、Vitest 或其他测试、构建命令（`npm run build` / `vite build`），也不得自动启动开发服务或其他服务。只有用户在当前请求中明确要求“验证”“检查”或“测试”时，才执行其指定范围内的命令；未明确范围时先询问，不擅自扩大为全量测试、构建或启动服务。不要添加临时文件做测试；有错误我会自行提交错误问题或错误日志。
- 任何修改，都不要兼容错误，不要隐藏错误，不要兼容多版本。而是从根本上去解决错误。所有逻辑不通，或者解决不了的，一定要把问题抛出来，让我来分析和选择方案解决。
- 当缺少工具时，直接告诉我需要安装什么




## 版权信息

所有新增或修改的源文件、框架文件、主要入口文件和 Demo 业务文件必须包含以下版权头；已有完整版权头不得重复添加，已有简化版权头应在该文件被修改时统一为完整模板：

```text
/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/
```

适用约定：

- JavaScript/TypeScript 等支持块注释的源文件直接使用上述块注释；HTML 使用等价的 `<!-- ... -->` 注释包裹；CSS 使用块注释；Markdown 使用 HTML 注释，不能破坏 YAML front matter。
- JSON、纯数据配置和其他不允许注释的格式不得插入非法注释；保持其合法语法，并由文件所属模块或相邻可注释入口承载版权信息，不得为版权头破坏配置解析。
- 版权头必须位于源文件最前方（带 BOM 的文件保留 BOM 后紧接版权头）；不得删除、缩写或改写版权归属、作者、邮箱、日期、博客和仓库地址。
- 新建文件和每次修改文件时都要检查版权头；本规则适用于引擎 `src/`、编辑器、Demo 入口/场景/系统以及其他项目源代码，`desktop/` 打包产物不参与功能修改，但新增或修改时仍不得产生无版权头源文件。
