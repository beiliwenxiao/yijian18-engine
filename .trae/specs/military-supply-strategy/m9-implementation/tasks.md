# M9 执行清单（粮草与后勤经济）

> 依据：[09-food-logistics-economy.md](../09-food-logistics-economy.md) §3 数值 / §5.2 配置 / §5.3 命令事件 / §5.8 分级交付
> 上游 master：[tasks.md](../tasks.md) · 前序：[m7-implementation/tasks.md](../m7-implementation/tasks.md)
> 施工约束：M1~M7 文件只做增量；不碰 `vitest.config.js`；每批自带测试；旧档兼容。
> 交付裁定（授权范围内自裁）：**纯算术服务 + 注入适配器**，日结是唯一入口；不新增第二套粮草库存。

## A. 日耗与四档状态机（§3.1 / §3.3，9A）

- [x] `personDayFactor`：步 0.8 / 弓 0.8 / 骑 2.4（M1-P16/P17 双开的 ×0.8 生效值）；`army.baseUpkeep` 默认 0
- [x] `computeDailyUpkeep(roster, config)`：对象/数组两种 roster 形态；100 人步兵团 = 80/日
- [x] `resolveUnitCategory`：配置 `unitTypeCategory` 优先 → 命名启发（cavalry/骑/马 → 骑兵，archer/弓 → 弓兵，其余步兵）
- [x] `settleDay({ armyId, day })`：①可选自动补粮 ②仓储损耗 `storageSpoilPerDay` ③日耗 ④四档判定
      ⑤士气增减 ⑥逃散与散兵池 ⑦事件
- [x] 四档：`normal` / `tight`（-3 士气，发 `army.supplyLow`）/ `empty`（-8）/ `collapse`（-15、战力 ×0.7）
- [x] `supply.days` = 剩余粮 ÷ 日耗（UI「还剩 N 日」直接用）
- [x] `supply.starved` 锁：`canIssueStrategicOrder` 在 empty/collapse 返回 `armyStarved`
      （与 `VehicleLogisticsSystem.starved` 同语义，模块 3 `attack`/`move` 侧消费）
- [x] `settledDay` 幂等：同日重复结算返回 `alreadySettled`，不改数据（读档重放不双扣）
- [x] `catchUp({ fromDay, toDay })`：补算上限 `maxCatchUpDays = 7`（护栏⑤）
- [x] 自动输送：构造注入 `autoResupply(armyId, upkeep)`，返回粮量当日到账并清 `emptyDays`（支柱②「每日驻地自动补粮」的服务侧半环）

## B. 逃散、散兵池与收编（P15）

- [x] 逃散地板 `floorRatio` 0.30：`lost = min(manpower - floor, floor(manpower × rate))`，建制不散
- [x] 散兵池 `scatteredPool`：`{ armyId, count, day, expiresDay: day + regroupWindowDays(30) }`
- [x] `listScattered({ armyId, day })` 过滤过期条目
- [x] `regroup({ armyId, day })` 招回窗口内全部散兵、清池、发 `army.regrouped`
- [x] `noDesertion` 白名单（剧情关键军团）：不减员、不写散兵池（士气照常扣）

## C. 军营存取粮（§5.2 / §5.3，9B）

- [x] `registerCamp({ campId, level, stock })`：容量 `500 + (level-1) × 250`，上限 2000
- [x] `deposit({ armyId, campId, entries, operationId })`：先全量校验（军团粮 / 营地容量）后原子扣减
- [x] `withdraw({ armyId, campId, entries, operationId })`：受 `supply.cap` 与营地存量双向约束
- [x] `operationId` 幂等表：重复提交返回 `idempotent: true`，不二次搬运
- [x] 军营库存 = `camp.stock.food`（由 `SceneContainerInventoryRegistry` 挂同 id 容器即可，服务不做容器复制）

## D. 烧毁与抢掠（§3.4 / §3.5 / P14，9C）

- [x] `raze({ target, night, defended, defenderWins, hasFireSource, operationId })`：
      比例 `defenderWins` 0 / `defended` 0.3 / `night` 0.9 / 常规 0.6；`razeRecoverRatio` 0.2 抢回
- [x] 火种要求 `razeRequiresFireSource` 默认 true（`prop.torch`/火攻技能联动），无火种返回 `fireSourceRequired`
- [x] 只作用于"有存量容器"的目标（军营/粮车），玩家背包不可烧
- [x] `forage({ armyId, operationId })`（P14）：仅 `empty` / `collapse` 可用；得 `日耗 × 0.6` 直接入军营库存；
      返回 `moraleCost` 6 / `renownCost` 3 / `alerted`（`alertChance` 0.25）由调用方经 `state.transaction` 落账
- [x] 事件：`army.supplyLow` / `army.supplyEmpty` / `army.desertion` / `army.foraged` / `army.regrouped` / `army.supplyRazed`

## E. 存档（旧档兼容）

- [x] `serialize()` → `{ armies, camps, scatteredPool, operations }`
- [x] `restore(snapshot)`：缺 `camps` / `scatteredPool` / `operations` 的旧档按空集合恢复；`null` 返回 `invalidSnapshot`
- [x] 落点建议 `checkpoint.warState.logistics`（OBJECT，旧档缺字段天然为空，不改 CHECKPOINT_SCHEMA 必填项）

## F. 偏差与推导记录

1. **推导（断粮前 3 日不减员）**：§3.3 表内「断粮档 逃散 2%/日 逐日 +1.5%」与护栏②（「断粮 3 天内只掉士气不减员」）
   及参数 `desertion.startDay = 3` 冲突。**取护栏②为准**（三处表述 + §1.1 风险表一致）：`emptyDays ≤ 3` 逃散率 0；
   `emptyDays > 3` 进 `collapse`，逃散率 `baseRate + rateStep × (emptyDays - startDay)` = 3.5% / 5% / 6.5% / 8%（封顶）。
   这样 `baseRate` / `rateStep` / `maxRate` 三个参数都仍生效，且「断粮 → 饥溃」的梯度不丢。
2. **偏差（未接项目配置）**：`game.project.json` 未新增 `logistics` 块；服务默认 `DEFAULT_LOGISTICS_CONFIG`。
   接线时按 §5.2 注入 `project.logistics` 即可，零回归。
3. **偏差（4 日结算顺序不跨模块）**：模块 7 日结 ④「军团补给扣粮」保持原状；M9 的 `settleDay` 由流水线在 ④ 之后
   调用（`settledDay` 各记各的），避免城池侧与军团侧双扣同一批粮。
4. **偏差（军营容器）**：未直接调 `SceneContainerInventoryRegistry`，只维护 `camp.stock`；注册同 id 容器作为
   后续接线项（`CargoTransferView` 装载 UI 走容器注册表，不需要新 UI）。
5. **偏差（UI 未做）**：「还剩 N 日」粮草条与低粮变红留 UI 批次；本轮提供 `queryDays` 与 `army.supplyLow` 事件。
6. **推导（退档恢复）**：补给到位当日只保证不再逃散；士气按 `moraleRecoverPerDay` 5/日回到 `moraleBase`，
   战力系数当帧恢复 1（不设额外 1 日缓冲——`collapse` 惩罚已由士气下限延长其影响）。
7. **偏差（AI 军团同规则）**：服务与 AI 无关，任何 `registerArmy` 的军团同规则；`aiSupplyEfficiency` 系数留给
   AI 侧在 `autoResupply` 适配器里乘，不在服务内分叉。

## G. 测试

- `FoodLedgerSystem.test.js` **27 例**：日耗公式 5 / 日结四档 9 / 散兵池 2 / 烧毁抢掠 5 / 军营存取 3 / 存档 3
- 回归：`src/systems` 1040/1043；3 例失败均为存量问题——`ItemRuntimeFactory`（`DefinitionRepository` 依赖缺失，
  非本轮引入）+ `FlightSystem.elevation` 2 例（单文件独跑 5/5 全绿，并行跑时序抖动，非本轮引入）

## 进度锚点（2026-11-11 · M9 完成）

- 交付：日耗/四档状态机/逃散地板与散兵池/断粮锁/补算上限/军营存取/烧毁/抢掠/事件/存档
- 测试：新增 27 例全绿
- 下一步：M6/M7/M9 回报；M8 按 P11 冻结；遗留项见 F.2 / F.4 / F.5
