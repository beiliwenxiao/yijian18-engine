<!--

Copyright (c) 2026 Liu Xiao (beiliwenxiao)

@project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
@author    刘枭 (beiliwenxiao)
@email     beiliwenxiao@qq.com
@date      2026-01-14
@blog      https://blog.csdn.net/beiliwenxiao
@repo      https://github.com/beiliwenxiao/yijian18-engine
           https://gitee.com/coderaaa/yijian18-engine

-->

# 《三国张角传》场景运行时

本目录承载 canonical `S01`–`S14` 大地图运行时。旧 Act1–6 独立场景已退出，不提供旧场景 ID 或旧存档兼容。

## 当前文件职责

- `DataDrivenPrologueScene.js`：正式 Web/小游戏入口使用的 Demo 组合根；负责把剧情 coordinator、领域系统、UI 和配置接到统一大地图运行时。
- `BaseGameScene.js`：通用可玩场景父类；装配 ECS、输入、UI、存档、帧管线和场景通用能力。
- `Scene1Terrain.js`：名称沿用历史，但当前只消费流式 prepare 注入的 canonical `sceneData.layers`，承载多 chunk 地形、碰撞、`worldOffset` 与 Y-sort 表现。

## 入口与数据源

正式入口由 `../index.html` 唯一注册 `DataDrivenPrologueScene`。各幕不是独立 Scene 类，而是通过 `game.project.json`、`assets/scenes/SXX.json`、战役/救援配置和 `teleportToChunk()` 推进。

场景磁盘 JSON 是唯一真实源。运行时只读取 `layers[].objects[]`，坐标由只读局部对象投影得到，`worldOffset` 只能应用一次；普通场景使用同名 SXX chunk，大战场附属 chunk 使用 `SXX-CNN`。

## 配置化边界

- 文案、提示、数值、空间 trigger binding、战役/救援定义和静态内容放配置。
- `SceneTriggerBindingSystem` 只解释空间事件和目标选择器，再调用 TriggerSystem action。
- 原子事务、回滚、幂等和 checkpoint 放通用 system 或 Demo coordinator，不把可执行事务直接塞进 JSON。
- 顶层 `update()` 仅保留有顺序约束的帧编排；可独立更新的领域流程应逐步下沉到 coordinator/system。

## 当前状态

S01–S14 均已登记为 canonical 可加载单元；代码接线不等于浏览器完整通玩、音画验收或发布候选完成。正式运行时不存在第二套预览 Scene 或缓存回退入口。