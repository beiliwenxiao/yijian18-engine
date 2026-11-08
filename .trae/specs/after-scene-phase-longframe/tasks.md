# Tasks：`updateUiCleanupAfterScenePhase` 归因与优化

> 关联 spec：[spec.md](./spec.md)

## T1 · 插桩：`AFTER_SCENE` 分钩子计时
- [x] `GameSceneRuntime.onFramePhase(phase, hook, name)` 支持 name，内部存 `{ name, hook }`
- [x] `runFramePhase` 去掉 `[...hooks]` 拷贝，改按长度快照索引遍历（零分配）
- [x] `AFTER_SCENE` 采样时写 `frameProfile.afterSceneHooks = [{name, ms}]`（仅 debugMode + 采样中）
- [x] 5 处注册补 name：`worldStreaming` / `corpseRuntime` / `playerDeathCountdown` / `playerSoulRespawn` / `armyCommand`
- [x] `index.html` 长帧日志增补 `AFTER_SCENE 分解` 段（>1ms 才列）
- 验收：`GameSceneRuntime.test.js` 全绿；长帧日志出现分解段

## T2 · 归因实测
- [x] `node scripts/probe-longframe-console.mjs` 抓 ≥12 条 S01 长帧，记录每个 name 的 ms
- [x] 同一 ID 连跑两次一致性检查（区分稳定热点 vs GC 偶发）
- 验收：给出主导钩子名与占比；若合计 <2ms 则判定为 GC/光栅记账漂移并回报

**实测结论**：60s 采到 31 条长帧，`AFTER_SCENE 分解` 仅 1 条非空（`armyCommand=2.00ms`），
其余 30 条 5 个钩子合计 <1ms → 该区间的 17.8ms 不是算法热点，是**记账漂移**（GC/光栅 flush 停顿
落到整个 JS 区间上）。同批日志中同一实体绘制成本在 1.6ms↔30.4ms 之间漂移（7 个可见实体），
`updateUiCleanupMinimap` 也出现过 19.7/22.8ms 单帧，属同一现象。

## T3 · 修复（按 T2 命中分支执行，只做命中项）
- [ ] B1 `worldStreaming`：未命中，不改
- [x] B2 `armyCommand`（唯一 >1ms 的钩子）：`navigator.getGamepads()` 无手柄时降频至 1/8 帧；
      按钮状态由每帧 `new Set()` 改为位掩码（`_prevPadMask`）；有手柄在线仍保持每帧采样，不漏按下沿
- [x] B3 `corpseRuntime`：去 `[...entityStore.all]` 每帧拷贝（索引遍历 + 到期列表懒分配）；
      `corpseDecay` 创建一次原地递减，取消每帧 `Object.freeze({...})`；
      `runFramePhase` 的 `[...hooks]` 拷贝已去（见 T1）
- 验收：单条改动可独立回退；未命中项不改

## T4 · 量化复测
- [x] `scripts/probe-frame-profile.mjs` 62 帧前后对比：`updateBaseFrame` / `updateUiCleanupAfterScenePhase`
      的 avg、max、over33ms 占比
- 验收：命中钩子 max 下降 ≥50%，over33ms 占比不退化

**复测数据**（同机 60s S01，有头 Chrome）

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| 长帧条数（>33.3ms） | 31 | 5 |
| `AFTER_SCENE 分解` 非空条数 | 1/31（armyCommand=2.00ms） | 0/5 |
| `getGamepads` + Set 每帧开销（2 万次微基准） | 0.0121ms | 0.00117ms（−90%） |
| `corpseRuntime` 每帧堆分配 | 1 个数组 + N 个冻结对象 | 0 |

## T5 · 回归与提交
- [x] `npx vitest run src/core/scene`（12 文件 / 113 例全绿）
- [x] S01 实机冒烟：长帧日志中该区间 <5ms
- [x] 仅提交本次改动文件，不连带骨骼编辑器/背包/大地图/战斗手感等在途改动
