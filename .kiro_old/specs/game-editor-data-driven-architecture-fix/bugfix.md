# Bugfix Requirements Document

## Introduction

本规格修复《三国张角传》及其编辑工具中“配置存在但运行时不完全消费、编辑器缓存可形成第二事实源、通用能力存在重复所有者、内容扩展仍需修改复杂程序、超大文件混合多项职责”的架构缺陷。修复成功以配置变更可被验证地驱动运行结果、编辑器磁盘往返一致、共享能力单一所有权、策划可在既有数据模型内完成内容编辑，以及既有游戏行为不回归为准；采用何种设计模式不是验收目标。本规格中的性能指标是尚待实测的验收目标，不表示仓库当前已经通过浏览器实玩、音画、内存或双后端一致性验收。

## Bug Analysis

### Current Behavior (Defect)

以下条件描述当前可复现的缺陷；每一条与同编号尾数的 Expected Behavior 条款一一对应。

1.1 WHEN canonical 游戏场景完成一次装配并运行或释放，且调用方提供可替换的共享系统或服务依赖 THEN the system 仍可能让同类有状态能力存在多个正式所有者，使消费者引用不同于注入实例，单个逻辑帧发生零次或多次更新、更新顺序偏离登记顺序，或释放未严格逆序、遗漏、重复调用
1.2 WHEN 策划提交对火堆表现、生成数量、生成间隔、战役月份、天气、救援波次、阶段时限、撤离半径、跟随距离或提示文案的配置修改，或者提交缺失、null、类型错误、越界字段 THEN the system 仍可能未经 schema、引用和领域校验便重载，继续采用程序常量，或把非法值静默替换为默认值并覆盖旧有效配置
1.3 WHEN 一个内部一致的项目配置改变 rows、cols、grid、chunkWidth、chunkHeight、唯一非 reserved 入口或世界偏移参数，使其不同于当前 20×20、S01 位置或 1280×720 THEN the system 仍可能使用当前 Demo 固定值派生边界、入口或 offset，修改场景局部坐标，或重复应用偏移
1.4 WHEN 磁盘 canonical 场景列表或同 ID 场景文件在读取之间发生更新、删除或重命名且本地仍有旧缓存 THEN the system 仍可能从旧缓存确定 ID 集合或内容，保留已删除 ID、把重命名误作同一旧 ID，或在磁盘仍可提供有效 canonical 内容时使用缓存且不标注 fallback
1.5 WHEN 用户通过场景编辑器执行创建、更新、重命名、删除、导入或保存 THEN the system 可能跳过完整候选校验或 canonicalize、只更新 localStorage、以错误顺序修改磁盘/正式内存/缓存，或在提交失败后留下部分状态并错误通知成功；重命名和删除还可能保留旧磁盘文件、旧正式内存项或旧缓存项
1.6 WHEN localStorage 含有未被项目元数据、磁盘场景列表和同 ID canonical JSON 登记的场景 ID，且世界网格包含该 ID THEN the system 仍可能把该 ID 作为候选，或把含该 ID 的可加载或 reserved 网格整体保存到磁盘并造成磁盘、正式内存或缓存的部分修改
1.7 WHEN 策划修改结局、技能、四类成长图、战役、救援、表现规格或场景 gameplay 的顶层、嵌套或数组字段 THEN the system 缺少覆盖全部字段的 schema-aware 编辑、字段路径错误、完整候选校验和原位写回，可能丢失未知合法字段或稳定 ID、写往第二来源，且运行时重载后仍需修改 JavaScript 才能消费
1.8 WHEN canonical 配置、预设或列表缺失、不可读、解析失败或 schema 校验失败 THEN the system 仍可能丢弃最后成功状态、返回无法识别的错误来源或类别，或回退并持久化旧 Prologue/Act、旧 s0、旧 campaign、旧 Demo 或其他项目专属生成内容
1.9 WHEN canonical 场景经过编辑器加载、预览、导入、导出和再次保存且用户未作语义修改 THEN the system 仍可能在同一 schema 的 canonicalize 前后产生结构差异，改变稳定 ID、引用、未知合法字段或 assetId=imageId，注入路径、旧内容、程序生成对象或第二版本事实
1.10 WHEN 编辑器提交的完整候选在任一顶层、嵌套、跨配置引用或领域约束上无效 THEN the system 可能在完整校验前修改磁盘、正式内存或缓存，返回缺少根路径、错误类别或原因的错误，或把候选校验失败与磁盘 canonical 提交后缓存同步失败混为同一回滚边界
1.11 WHEN 对版本控制中由运行时、编辑器或开发/发布工具直接执行的 JavaScript 物理行进行审计 THEN the system 仍可能漏计空行和注释、错误纳入纯数据配置/测试/fixture/第三方/生成物/构建产物，或保留超过 1000 行、混合装配/领域/表现/编辑交互职责的文件；装配文件还可能承担业务实现，例外也可能缺少可核验证据并在增行后继续生效
1.12 WHEN 策划仅在既有 schema 可完整表达且能通过校验的范围内新增或调整 S01–S14 场景流程、对象、战役、救援、成长、结局或表现内容 THEN the system 仍可能要求 JavaScript 可执行源产生 diff，新增按 scene、content 或 field 的条件分支，或在编辑器和游戏完全重启后使磁盘 canonical 数据与同 snapshot、seed、commands 的运行结果不一致

### Expected Behavior (Correct)

以下条款与 1.1–1.12 一一对应，并定义修复成功条件。

2.1 WHEN canonical 游戏场景完成一次装配并运行或释放，且调用方提供可替换的共享系统或服务依赖 THEN the system SHALL （a）为每类有状态通用能力指定唯一正式所有者；（b）使所有消费者引用与注入实例严格相同的对象；（c）使每个已登记实例在每个逻辑帧按登记顺序恰好更新一次；（d）在释放时按登记顺序的严格逆序对每个实例恰好调用一次释放；（e）使重复释放成为幂等操作，不得再次调用任何实例的释放逻辑
2.2 WHEN 策划提交对火堆表现、生成数量、生成间隔、战役月份、天气、救援波次、阶段时限、撤离半径、跟随距离或提示文案的配置修改 THEN the system SHALL （a）在重载前通过 schema、引用和领域校验；（b）重载后分别以可观察表现、数量、间隔、月份、天气、波次、时限、距离边界和文案验证新值已被运行时消费且无需修改 JavaScript；（c）仅对缺失的可选字段应用 schema 声明的默认值；（d）对 null、类型错误或越界值返回错误、保留旧有效配置且不得静默默认
2.3 WHEN 一个内部一致的项目配置改变 rows、cols、grid、chunkWidth、chunkHeight 或唯一非 reserved 入口，使其不同于当前 20×20、S01 位置或 1280×720 THEN the system SHALL （a）只从该项目字段派生世界边界、入口和 worldOffset；（b）允许这些值与当前 Demo 不同；（c）保持场景 JSON 的局部坐标只读；（d）在投影到世界坐标时恰好应用一次 offset
2.4 WHEN 读取磁盘 canonical 场景列表及场景文件且磁盘内容发生更新、删除或重命名 THEN the system SHALL （a）每次以当次可读的磁盘列表确定 ID 集合；（b）以磁盘同 ID 文件刷新缓存；（c）删除磁盘已移除 ID 的旧缓存；（d）把重命名处理为删除旧 ID 并新增新 ID；（e）仅当磁盘 canonical 内容因列表或文件不可读而不可获得时，才使用最近一次成功磁盘刷新、同 ID 且通过当前校验的缓存，并在结果中显式标注 fallback；同 ID 文件解析失败时的受限 fallback 遵循 3.6，磁盘存在有效内容时不得回退缓存
2.5 WHEN 用户通过场景编辑器执行创建、更新、重命名、删除、导入或保存 THEN the system SHALL （a）按“完整候选校验并 canonicalize → 原子磁盘提交 → 正式内存更新 → 缓存更新 → 成功通知”的顺序处理；（b）把原子替换、创建、重命名或删除对应磁盘 canonical 文件成功的时刻定义为提交点；（c）在提交点前任一步失败时撤销暂存磁盘变化并保持正式内存和缓存不变；（d）在磁盘提交成功后若缓存更新失败，不得回滚磁盘，必须使该缓存退出 fallback 资格、报告缓存同步失败，并以磁盘 canonical 版本作为已提交结果；（e）重命名必须原子地移除旧 ID 并提交新 ID，删除必须移除该 ID 的磁盘文件、正式内存项和缓存项，不得留下可加载旧版本
2.6 WHEN localStorage 含有未被项目元数据、磁盘场景列表和同 ID canonical JSON 登记的场景 ID THEN the system SHALL （a）不得把该 ID 纳入场景或世界地图候选；（b）当待保存世界网格的任一可加载或 reserved 单元包含该 ID 时拒绝整个保存；（c）在拒绝后保持磁盘、正式内存和缓存与操作前完全一致
2.7 WHEN 策划修改结局、技能、四类成长图、战役、救援、表现规格或场景 gameplay 定义 THEN the system SHALL （a）对各域提供 schema-aware 的全字段编辑；（b）以字段路径返回编辑或校验错误；（c）在保存前校验完整候选；（d）保留未编辑的未知合法字段、稳定 ID、引用和数组语义；（e）原位写回加载时的同一磁盘 canonical 来源；（f）使有效数据在重载后被运行时消费且无需修改 JavaScript
2.8 WHEN canonical 配置、预设或列表缺失、不可读、解析失败或 schema 校验失败 THEN the system SHALL （a）保留最后一次成功加载状态；（b）返回可识别的来源与“缺失、不可读、解析失败、schema 失败”类别；（c）只能返回失败，或返回显式标记为 non-canonical、符合当前 schema、不含任何项目专属内容且未经用户保存不得持久化的空白模板；（d）严禁暴露、生成或保存旧 Prologue/Act、旧 s0、旧 campaign 或旧 Demo 内容
2.9 WHEN canonical 场景经过编辑器加载、预览、导入、导出和再次保存且用户未作语义修改 THEN the system SHALL （a）对往返前后数据使用同一 schema canonicalize 后得到结构相等结果；（b）只允许 schema 明确声明的无语义规范化；（c）保留稳定 ID、引用、数组语义、未知合法字段和 assetId=imageId；（d）不得引入硬编码路径、旧内容、程序生成对象或第二个版本/事实源
2.10 WHEN 编辑器提交完整候选 THEN the system SHALL （a）在 2.5 的磁盘提交点前校验所有顶层字段、嵌套字段、跨配置引用和领域约束；（b）对每个错误返回从候选根开始的字段路径、错误类别和原因；（c）任一候选校验失败时不得进入磁盘提交点，并使磁盘、正式内存和缓存恢复或保持提交前状态；（d）以单个 canonical 磁盘操作的原子提交作为持久化边界，并以 2.5 的提交顺序和提交后政策为准；（e）磁盘提交后的缓存失败不得被误报为候选校验失败，也不得回滚已提交磁盘版本，而应按 2.5 退出缓存 fallback 并报告降级状态
2.11 WHEN 对版本控制中由运行时、编辑器或开发/发布工具直接执行的 JavaScript 进行行数与职责审计 THEN the system SHALL （a）仅纳入该范围并排除纯数据配置、测试/fixture、第三方代码、生成物和构建产物；（b）按物理行计数，包含空行与注释；（c）使所有无例外文件处于 1–1000 行且只承担装配、领域、表现、编辑交互四类职责之一；（d）使装配文件只执行组装、转发和生命周期协调，不实现领域或表现规则；（e）仅允许受外部单文件契约约束的文件超过 1000 行，且记录文件、外部契约证据、精确行数、单一职责、负责人和日期；（f）使例外在文件增加任何物理行后立即失效并重新审批，且例外不得豁免单一职责
2.12 WHEN 策划仅在既有 schema 可完整表达且完整校验通过的范围内新增或调整 S01–S14 内容 THEN the system SHALL （a）使 JavaScript 可执行源 diff 为零；（b）不得新增按 scene、content 或 field 的条件分支；（c）仅通过编辑器把 canonical 数据保存到原磁盘来源；（d）在编辑器和游戏完全重启后，重新读取的磁盘 canonical 数据与保存结果一致；（e）使用同一初始 snapshot、seed 和 commands 时产生一致的业务结果

### Unchanged Behavior (Regression Prevention)

以下既有行为和验收边界必须在修复过程中保持。

3.1 WHEN 加载当前唯一 Demo《三国张角传》的有效项目 THEN the system SHALL CONTINUE TO 保持项目身份不变，使用 schemaVersion 1、meta.version/meta.schema 3、campaign `sanguo-zhangjiao-s01-s14`、canonical ID `S01`–`S14`/`SXX-CNN`，并拒绝旧 Act、旧 `s0-*`、旧 campaign、旧职业和旧存档兼容路径
3.2 WHEN 读取当前 A–D Region 世界布局或投影场景对象 THEN the system SHALL CONTINUE TO 以当前 `game.project.json` 的 rows、cols 和 `worldMap.regions[].grid` 为唯一布局事实，保持当前网格内容，并对只读局部坐标恰好应用一次由当前 chunkWidth/chunkHeight 派生的 worldOffset；reserved 单元不得进入加载、传送或恢复
3.3 WHEN 创建和运行游戏对象及领域逻辑 THEN the system SHALL CONTINUE TO 保持 Entity 为稳定 ID、Component 只持有数据、System 持有逻辑，并精确保持框架与 Demo 边界：通用机制位于 `src/`，S01–S14 历史人物、剧情、数值和显式场景编排位于 Demo
3.4 WHEN 执行会修改库存、战果、剧情、营建、载具、救援、结局或检查点的领域操作 THEN the system SHALL CONTINUE TO 遵循 validate→prepare draft→commit→emit→checkpoint 的事务阶段，任一提交前失败保持零修改，提交后失败按既定事务策略回滚；稳定 operationId 的同 ID 同载荷重放保持幂等，同 ID 不同载荷保持冲突拒绝
3.5 WHEN 玩家跨 chunk 或 Region、连续发起流式请求或恢复动态对象 THEN the system SHALL CONTINUE TO 保持唯一流式状态权威、generation/abort latest-wins、Region 九宫格加载、完整预检和一次提交；失败回滚必须把当前失败项包含在内并按已执行项严格逆序进行，physical `SXX-CNN` 继续映射到 `SXX` 业务命名空间
3.6 WHEN读取 canonical 场景数据用于运行、缩略图、审计或发布 THEN the system SHALL CONTINUE TO 在磁盘同 ID JSON 可读且解析/校验成功时优先使用磁盘；仅在同 ID 磁盘内容不可读或解析失败时，才允许使用最近一次由该磁盘 ID 刷新且通过当前 schema 校验的缓存并显式标注 fallback；缓存不得成为审计或发布事实源
3.7 WHEN 保存、检查或恢复游戏快照 THEN the system SHALL CONTINUE TO 保持自动位与手动位隔离、先 migrate/validate 全部 provider 再 capture/restore 的两阶段恢复、将当前失败 provider 纳入逆序回滚、损坏 JSON 原样保留并返回 invalidJson，以及旧 schema、旧 chunk、旧 Act 和旧职业存档明确拒绝且不删除的策略
3.8 WHEN 玩家使用键鼠、触屏或手柄操作世界、模态 UI、面板、技能、拾取、攻击、移动或载具 THEN the system SHALL CONTINUE TO 经过统一 SceneInputFlow/InputActionRouter 路由，保持“模态 UI→面板 UI→瞄准→Ctrl 轻功→Shift 投掷→拾取→技能→攻击→右键移动”的优先级，由首个消费者独占处理，并统一使用 InputHints token 而不建立平台旁路
3.9 WHEN 选择 2D、3D 或自动渲染并使用稳定资源 ID THEN the system SHALL CONTINUE TO 使 requested/actual 后端只影响表现和诊断，保持 2D `x`→3D `x`、2D `y`→3D `z`、elevation→3D `y` 的坐标映射、assetId=imageId 资源链，以及相同初始状态与命令下 2D/3D 业务 diff=0；表现资源不得成为业务事实源
3.10 WHEN 使用当前有效配置回归 S01–S14、四类成长、战役救援、营建载具、存读档和 S14 结局 THEN the system SHALL CONTINUE TO 从同一初始 snapshot、seed 和 commands 对比并保持业务状态、领域事件顺序以及六结局优先级“焦土→旁观者→火种→余烬→流星→尘埃”一致
3.11 WHEN 编辑器读取并保存当前有效的场景、世界地图、系统配置、稳定资源引用或触发器关联 THEN the system SHALL CONTINUE TO 逐字段保留字段存在性、类型、null 与缺失的区别、嵌套结构、数组顺序、未知合法字段、稳定 ID、InputHints token 和全部引用，不得因未编辑或往返而丢失或改写
3.12 WHEN 对架构修复执行性能、双后端和释放验收 THEN the system SHALL CONTINUE TO 将以下尚未验收的目标作为可执行验收条件而不得描述为已通过事实：（a）在 S11 运行至少 100 个活动 ECS 实体并记录实体数与采样区间，测得平均帧率不低于 60 FPS；（b）在同一 Region 连续跨界前后记录内存，峰值目标小于 100MB；（c）从同一 snapshot、seed 和 commands 分别运行 2D/3D，业务状态与领域事件 diff=0；（d）释放场景或运行时后，对比释放前基线，正式所有者、事件监听器、计时器和已持有资源均无新增残留
