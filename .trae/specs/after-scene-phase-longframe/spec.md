# Spec：S01 长帧 — `updateUiCleanupAfterScenePhase` 17.8ms 根因定位与优化

> 状态：待评审 · 2026-11-08
> 输入证据：`[FrameProfile][长帧] S01 33.70ms`；`updateBaseFrame=19.30ms`，`updateUiCleanupAfterScenePhase=17.80ms`，
> `renderWorldObjects=6.50ms`；规模 实体=14 / 队列=22 / 深度粒子=1。

## 1. 这段代码到底是什么（已确认）

`updateUiCleanupAfterScenePhase` 不是"UI 收尾"，它是 [SceneFramePipeline.js](file:///d:/yijian18-engine/src/core/scene/SceneFramePipeline.js)
里一个**两行代码的测量区间**，实际内容 = `AFTER_SCENE` 帧阶段全部钩子 + 输入帧收尾：

```js
runtime?.runFramePhase?.(FramePhase.AFTER_SCENE, deltaTime, { scene, frameToken });
if (inputFlow) inputFlow.flush();
else inputManager?.update?.();
```

全仓 `AFTER_SCENE` 注册点只有 5 个（已 grep 全量确认，无遗漏）：

| # | 注册点 | 每帧实际工作 | S01 下的量级判断 |
|---|--------|--------------|------------------|
| 1 | [GameSceneRuntime.js#L385](file:///d:/yijian18-engine/src/core/GameSceneRuntime.js#L385) | `WorldStreamingManager.update(x,y)`（`async`，未跨 chunk 时同步 `return {unchanged}`） | 常态 ~0；**跨 chunk 切换那一帧会同步做完整段 prepare** |
| 2 | [SceneGameplaySystemAssembler.js#L226](file:///d:/yijian18-engine/src/core/scene/SceneGameplaySystemAssembler.js#L226) | `scene.corpseRuntime.update(dt)` | 每帧 `[...entityStore.all]` 拷一份 + 每具尸体一次 `Object.freeze({...decay})` |
| 3 | [SceneGameplaySystemAssembler.js#L365](file:///d:/yijian18-engine/src/core/scene/SceneGameplaySystemAssembler.js#L365) | `scene.playerDeathCountdown.update(dt)` | 未死亡 → 无工作 |
| 4 | [SceneGameplaySystemAssembler.js#L424](file:///d:/yijian18-engine/src/core/scene/SceneGameplaySystemAssembler.js#L424) | `scene.playerSoulRespawn.update(dt)` | 未魂体 → 无工作 |
| 5 | [SceneArmyCommandFlow.js#L76](file:///d:/yijian18-engine/src/core/scene/SceneArmyCommandFlow.js#L76) | `setEnemies` + 战斗沿检测 + Tab 沿 + `system.update` + `syncUnits`（全表扫）+ `_handlePointer` + `_handleGamepad`（`navigator.getGamepads()`） | S01 无编组 → 计算量近 0，但**含每帧 DOM/Gamepad API 调用** |
| 6 | `SceneInputFlow.flush()` → `runtime.flushInput()` / `inputManager.update()` | 输入帧清屏 | 常态 < 0.1ms（需实测确认 `flushInput` 是否含命令闸门 flush） |

**结论**：这段代码本身没有"全表遍历 14 个实体就该 17.8ms"的算法量级。14 实体/22 队列项不可能靠计算吃满 17.8ms，
所以它必然落在下面三类之一——这也正好解释了"和实体/队列规模无关"：

- **A. 某一钩子内部有一次性重活**：最可能是 #1 `WorldStreamingManager.update` 的跨 chunk 切换（同步 prepare），
  或 `flushInput` 里夹带的命令闸门 flush（可能触碰存档序列化 / placements 快照）。
- **B. 同步布局 / DOM 读取**：`_handleGamepad()` 的 `navigator.getGamepads()`、`_handlePointer()` 的
  `getBoundingClientRect` 类读取会强制 style/layout 重算，一帧几毫秒到十几毫秒，与实体数无关。
- **C. GC / 光栅 flush 停顿**：该区间每帧产生的堆分配（`[...hooks]`、`[...entityStore.all]`、每具尸体一个
  `Object.freeze` 副本）正好把 GC 停顿"记在"这一段账上。上一轮 S01 复测已观测到同类漂移尖刺
  （同一实体 1.6ms↔7.8ms 摆动），属同一现象。

单帧 33.7ms 是偶发长帧，仅凭一次日志无法区分 A/B/C——**因此第一步必须是精准归因，而不是猜着改**。

## 2. 方案

### A. 归因插桩（必做，永久保留，debugMode 门控）

1. `GameSceneRuntime.onFramePhase(phase, hook, name)` 增加可选 `name`；内部存 `{ name, hook }`，
   `runFramePhase` 遍历时不再 `[...hooks]` 拷数组（改为按长度快照索引遍历，零分配）。
2. `runFramePhase` 在该 phase 有 frameProfile 且在采样时，把每个钩子耗时写入
   `frameProfile.afterSceneHooks = [{name, ms}]`（仅在 `scene.debugMode === true` 时启用，
   通过 `phase === AFTER_SCENE` 或新增 `options.profile` 判定；未采样时零开销）。
3. 5 个注册点全部补 name：`worldStreaming` / `corpseRuntime` / `playerDeathCountdown` /
   `playerSoulRespawn` / `armyCommand`。
4. `index.html` 的 `[FrameProfile][长帧]` 行增补 `AFTER_SCENE 分解` 段：按 name 输出 ms，超过 1ms 才列。

### B. 按归因结果修复（预置三个分支，执行时按实测命中哪一个走哪一个）

- **B1（若 `worldStreaming` 命中）**：`WorldStreamingManager.update` 的同步支付段改为
  "跨帧摊销"——当前 `_runTransition` 在 `await` 之前先同步跑 `prepareTransition` 的 `_getNeededChunks`
  + `_chunkKey` 去重；把 `prepareTransition` 的首个 `await` 之前的工作量降到构造参数级别，
  实际 `_prepareChunk` 已是异步。确认点：`prepareTransition` 内是否存在同步 JSON 解析 / 地形重建。
- **B2（若 `armyCommand` 命中）**：`SceneArmyCommandFlow`
  - `_handleGamepad()` 由"每帧 `navigator.getGamepads()`"改为"每 4 帧一次 + 输入事件唤醒"（`gamepadconnected`）；
  - `syncUnits()` 全表扫加脏标记：`entityStore.all.length` 与 `_lastSyncCount` 相同且
    `_knownMemberless === true` 时跳过；`registerUnit` 幂等已保证安全；
  - `_handlePointer()` 的 DOM 读取结果按帧缓存（同帧多次读取复用）。
- **B3（若 `corpseRuntime` 命中或归因为 C/GC）**：
  - 去掉 `[...this.entityStore.all]` 每帧拷贝，改索引遍历 + `pendingRetire` 数组懒分配（仅到期帧分配）；
  - `entity.corpseDecay` 改为**创建一次、原地改写**，取消每帧 `Object.freeze({...decay})`
    （`startDecay` 建对象，`update` 改 `remainingSeconds`，`capture` 只读）；
  - `runFramePhase` 的 `[...hooks]` 拷贝去掉（即 A.1）。

> 三项互不冲突，可同时落地；但**只改实测命中的那项**，避免无证据的改动扩散。

## 3. 影响面

| 文件 | 改动 |
|------|------|
| `src/core/scene/GameSceneRuntime.js` | `onFramePhase` 支持 name；`runFramePhase` 零拷贝遍历 + 可选分钩子计时 |
| `src/core/scene/SceneGameplaySystemAssembler.js` | 3 处注册补 name（无逻辑变化） |
| `src/core/scene/SceneArmyCommandFlow.js` | 注册补 name；按 B2 命中项改 |
| `src/core/scene/SceneCorpseRuntime.js` | 注册补 name；按 B3 命中项改 |
| `example/sanguo_zhangjiao/index.html` | 长帧日志增补 `AFTER_SCENE` 分解段（仅 debugMode） |
| `src/core/WorldStreamingManager.js` | 仅当 B1 命中才改 |

**不做**：不新增 UI、不改帧管线阶段划分、不动骨骼编辑器/背包/大地图/战斗手感相关文件、
不调整长帧阈值与既有 `entityTop3` / `worldQueueDrawByType` 输出。

## 4. 验证

1. **归因**：`node scripts/probe-longframe-console.mjs`（S01，真实 GPU，抓 ≥12 条长帧），
   确认 `AFTER_SCENE 分解` 中哪个 name 占主导；同一 ID 连跑两次结果应一致（排除偶发 GC）。
2. **量化**：对命中的钩子做前后对比——用 `scripts/probe-frame-profile.mjs` 采 62 帧，
   对比 `updateBaseFrame` / `updateUiCleanupAfterScenePhase` 的 avg/max 与 over33ms 占比。
3. **回归**：`npx vitest run src/core/scene`（`GameSceneRuntime.test.js` 含 `runFramePhase` 去重用例）
   + 一次 S01 实机冒烟（长帧日志不再出现该区间 >5ms）。
4. 提交只含本次改动文件（不连带工作区其他进行中改动）。

## 5. 开放风险

- 若插桩显示 5 个钩子合计 <2ms，则 17.8ms 属 C（GC/光栅 flush 停顿），此时唯一有效手段是 B3 的
  分配清零 + 后续单独排查渲染侧 display list 体量；需向用户回报"该区间是记账漂移，非算法热点"。

## 6. 实测结论（2026-11-08）

插桩后按 §4 采样（同机、有头 Chrome、S01、60s × 2 轮）：

- **该区间没有算法热点**。31 条长帧里 `AFTER_SCENE 分解` 只有 1 条非空（`armyCommand=2.00ms`），
  其余 30 条 5 个钩子合计 <1ms。用户看到的 17.8ms 属 §5 预判的 **C（记账漂移）**：GC / 光栅 flush
  停顿落在"两行测量区间"上，与实体/队列规模无关。旁证：同批日志中同一实体（柔弱女子，1 槽）
  绘制成本在 1.6ms↔26.8ms 之间漂移，`updateUiCleanupMinimap` 也出现 19.7/22.8ms 单帧，
  7 个可见实体却出现 140ms 帧——瓶颈在渲染侧光栅，不在该 JS 区间。
- **落地改动**（证据已确认的最小集）：
  1. `GameSceneRuntime`：`onFramePhase` 支持 name；`runFramePhase` 零拷贝遍历 +（仅采样时）分钩子计时
     写入 `frameProfile.afterSceneHooks`；`index.html` 长帧日志渲染 `AFTER_SCENE 分解` 段。
  2. `SceneArmyCommandFlow`：无手柄在线时 `navigator.getGamepads()` 降频到 1/8 帧；按钮沿检测由
     每帧 `new Set()` 改为位掩码（有手柄时仍每帧采样，不漏按下沿）。
  3. `SceneCorpseRuntime`：去掉每帧实体数组拷贝与每帧 `Object.freeze({...decay})`。
- **量化**：`getGamepads`+Set 每帧 0.0121ms → 0.00117ms（−90%）；`corpseRuntime` 每帧堆分配 0；
  优化后复测 5 条长帧中 `AFTER_SCENE 分解` 全部 <1ms。
- **后续**：真正的 17.8ms 量级停顿需从渲染侧查（实体单帧绘制 1.6↔30ms 的抖动、campfire_bottom
  偶发 11ms、`updateUiCleanupMinimap` 偶发 22.8ms），属下一轮独立议题。
