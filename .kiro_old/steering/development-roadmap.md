---
inclusion: manual
---

# 《三国张角传》开发路线索引

本文件只提供阶段导航，不复制每日进度。阶段状态、范围裁决和完成门槛唯一以 `yijian18-game-demo-development-plan.md` 为准；需求事实以 `specs/yijian18-game-demo/requirements.md` 为准。

## 当前交付边界

- 当前唯一 Demo 为 `example/sanguo_zhangjiao/`，作品名《三国张角传》。不创建第二个游戏目录。
- 运行时 canonical 场景仅为 `S01`–`S14`，大型战场附属 chunk 使用 `SXX-CNN`。
- 唯一运行时组合根为 `DataDrivenPrologueScene`；默认入口和微信入口不注册第二套 Scene。
- 场景磁盘 JSON 与 `game.project.json` 是内容事实源；正式运行磁盘读取失败直接拒绝。
- 第三职业为 `strategist/军师`；旧职业、旧场景和旧 schema 存档直接拒绝，不迁移。
- Canvas 2D 是发布主表现，three.js 使用相同稳定 ID、坐标与业务状态。
- 根 `capacitor.config.json` 与根 `android/` 是 Android 发布权威。

## P0–P6 导航

| 阶段 | 正式名称 | 当前状态 | 主要未完成证据 |
|---|---|---|---|
| P0 | 交付地基与美术预制 | inProgress | 浏览器启动、错误 UI、旧存档拒绝与完整入口验证 |
| P1 | S01–S02 生存教学闭环 | inProgress | 浏览器通玩、原子边界、两轮存读档与音画验收 |
| P2 | S09 职业与资源剧情 Vertical Slice | inProgress | 三职业三输入、分支跨日恢复、城市摘要与音画验收 |
| P3 | S03–S08 豫州主战役 Alpha | inProgress | 实际战斗、观战/介入、救援、双路线和战中存读档 |
| P4 | S10–S12 冀州末战与战争生存 | inProgress | 百人战、营建维修、载具乘降/摧毁/物流与资源失败边界 |
| P5 | S13–S14 与六结局 Content Complete | inProgress | 原子结算、六结局优先级、四类位移和完整演出验收 |
| P6 | 全图、性能、Polish 与发布候选 | inProgress | 全图流式、60 FPS、内存、2D/3D diff、音频、Android 发布 |

`playable`、代码接线或 diagnostics 通过不等于阶段 `done`。没有浏览器 playthrough、音画验收和发布证据时，不得把 P0–P6 或 Release Candidate 标为完成。

## 当前优先顺序

1. **P6.1 世界流式与恢复**：连续跨界、远距传送、失败保留旧区、动态对象卸载恢复、SXX-CNN 与两轮存读档。
2. **P6.2 性能和稳定性**：S11 至少 100 个活动 ECS 实体、平均 60 FPS、1% low、长任务、draw calls 和同 Region 内存 `<100MB`。
3. **P6.3 全量美术与发布整理**：Manifest/文件/稳定 ID/2D–3D 映射、正式音频、遮挡碰撞、小地图与移动端 Polish。
4. **P6.4 Release Candidate 门槛**：完整组合通关、Blocker/Critical 清零、Android release signing 与真机构建安装。

任何静态修复都必须保持 `P6: inProgress`，直到对应运行证据成立。

## 架构索引

| Steering | 当前职责 |
|---|---|
| `project-info.md` | 项目、目录、架构、存档、渲染、输入和发布事实索引 |
| `yijian18-game-demo-development-plan.md` | P0–P6 范围、状态与完成门槛 |
| `progression-implementation.md` | 成长、输入、快照与场景基础设施约定 |
| `optimization-plan-b-plus.md` | 流式、性能与内存优化约定 |
| `map-editor.md` | 地图/场景编辑器与 canonical 保存约定 |
| `editor-architecture.md` | 编辑器文档模型、事务、运行时加载与热同步边界 |
| `effect-zones.md` | effectZone 编辑与运行时投影 |
| `data-driven-act-migration.md` | 当前单组合根、canonical 场景和 Trigger 接线约定 |
| `android-build.md` | 根 Android 工程与签名发布约定 |
| `ui-editor.md` | UI 编辑器和布局接线约定 |

## 执行纪律

- 使用开发计划中的正式阶段和小节名称描述工作，不使用临时任务编号替代阶段名。
- 通用机制进入 `src/`，历史人物、S01–S14 内容与数值留在 Demo。
- 状态修改遵循 `validate → prepare draft → commit → emit → checkpoint`；失败零修改，持久事务使用稳定 operationId。
- 正式世界输入只经过 `SceneInputFlow/InputActionRouter`；提示只使用 `InputHints`。
- 场景对象只从只读 local 数据投影一次 worldOffset；资源与渲染对象不成为业务事实源。
- 日常修改执行 diagnostics；Vitest、build、dev server、cap sync 和测试页面只在用户明确要求时执行。
- 不修改 `desktop/` 和 Demo 内 legacy mobile 工程。
