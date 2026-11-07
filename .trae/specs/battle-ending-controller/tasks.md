# 战斗/结局控制器解耦 — 实施任务

> 依据：[spec.md](./spec.md)
> 约束：存档键名不变、operation 名不变、`endingResolved` 不变、不做 P2/P3/远端。

## P0 战斗门面

- [x] 新增 `src/core/scene/BattleSessionFacade.js`
  - 承接 `openByScene/selectMode/update/closeUi/leaveBattleScene`
  - 承接查询与投影：`getSessionState/getDefinition/isBattlefieldActive/canUseRescue/freezeResult/applyBattleResult`
  - 承接持久化：`capture/validateSnapshot/restore`
  - 承接输入/渲染层：`isInputLayerVisible/handleInputLayer/renderLayer`
- [x] `S03S14BattleCoordinator` 内部改持门面，对外方法签名不变

## P1 结算命令化

- [x] `SceneBattleRuntime.update` 不再直接 `settleResult`
  - 战果已冻结（`evaluateOutcome` 内冻结）→ 挂起 `pendingSettlement`
  - 调用 `hooks.settlementRequired`
- [x] 新增 `SceneBattleRuntime.settleFrozenResult({ resultId })`
  - 并发合并（同一时刻只跑一次）
  - 已应用战果直接返回 `idempotent`
  - 域结算 operationId 固定 `settle:${resultId}`
- [x] `SanguoDomainCommandFacade` 增加路由 `battle.command` → `battle.settle`
- [x] `S03S14BattleCoordinator` 增加 `settle(payload)` 与结算命令派发
  - 失败提示 + 下一帧重试（不阻塞游戏）
  - 存档恢复后若战果未应用，自动补发 `battle.settle`

## E0 结局切片

- [x] 新增 `example/sanguo_zhangjiao/systems/EndingFlowCoordinator.js`
  - 迁移：`executeEndingCommand/commitEndingById/_readEndingRuntimeState/_writeEndingRuntimeState/openS14FinalDoctrine/_handleS14FinalDoctrineCommand/resolveEnding/_handleEndingPresentationCommand/_createEndingInputContext`
  - 宿主保留同名 delegate，调用点零改动
- [x] `S11S14SceneCoordinator` 构造时挂载 `scene.endingFlowCoordinator`

## E1 纯输入投影

- [x] 新增 `example/sanguo_zhangjiao/systems/EndingInputProjector.js`
  - `projectEndingInput({ state, normalized })` 纯函数
  - `validateEndingInput/requireEndingInput` + `REQUIRED_ENDING_INPUT_PATHS`
- [x] 宿主 `_projectEndingInput` 改为委托；缺失路径抛 `endingInputMissingPaths`（由 EndingSystem 的 `inputProjectionFailed` 兜底）

## 验证

- [x] 对照存档键：`capture()` 字段、`s11s14*`/`endingSystemState` 等键名未改
- [x] 对照 operation：`battle.open.sXX`、`ending.command` 的操作名未改
- [x] 对照事件：`endingResolved` 未改
- [x] 回归：`npx vitest run` 相关 9 个测试文件 73 例中 72 例通过；唯一失败
  `gameEditorDataDrivenArchitecturePreservation.property.test.js` 的 golden 快照为既有问题
  （golden 最后更新 2026-10-21，而 s_5_8~s_5_11 场景与 S02 触发器改名均为其后提交），与本次改动无关
- [ ] 实机冒烟（待执行）：开战→模式选择→实时战场→结算命令提交；S14 终局→结局演出→读档返回
