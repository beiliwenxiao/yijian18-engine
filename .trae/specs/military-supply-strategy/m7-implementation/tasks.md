# M7 执行清单（城镇与内政）

> 依据：[07-town-administration.md](../07-town-administration.md) §3~§8 · 上游 master [tasks.md](../tasks.md)
> 施工约束：M1~M6 文件只做增量；不碰 `vitest.config.js`；每批自带测试；旧档兼容。

## A. 城池状态扩展（§3.1）

- [x] `CITY_SCHEMA` 增加**可选**字段：`population` / `production` / `settledDay` / `status`
      （旧城池数据零改动；`resources` 仍为 INTEGER map，`coin` 直接作为资源键）
- [x] `population` 缺省按 `buildingLevel × defaultBasePerLevel` 推导；`recruitable` 缺省 0
- [x] `status` 三态 `NORMAL` / `UNDER_SIEGE` / `OCCUPIED`（易主后 `OCCUPIED` 立即回 `NORMAL`，
      与 §8.1「易主即归属新主」一致）

## B. 产出公式（§3.2，唯一实现处）

- [x] `computeCityProduction(city, { constructionDefinitions })`：
      `Σ(建筑 baseProduction × (1 - buildingDamage[建筑])) × 民心乘数 × 等级乘数`
- [x] 民心乘数 `clamp(0.5 + morale/100, 0.5, 1.5)`；等级乘数 `1 + (level-1) × 0.2`
- [x] 铜钱产出 `population.total × 0.02 × 民心乘数`
- [x] 建筑来源：城池 `buildings` 白名单（有）或全部 `construction.definitions`（无）

## C. 民心五源（§3.3，含 P13）

- [x] 战败 `-12` / 守城胜 `+8` → `applyMoraleChange` 显式来源
- [x] 被围每日 `-3`（`status === UNDER_SIEGE` 或 `damagePausedUntilDay > day`）
- [x] **P13 粮仓饥荒**：`food < population.total × famine.thresholdDays(3)` 按缺口线性
      `-1 ~ -4/日`，并入日结 ② 并发 `city.famine`
- [x] 赈济 `+5`（扣 `reliefFoodCost` 20 food，每日限 1 次，`lastReliefDay` 幂等）

## D. 日推进流水线（§4）

- [x] `settleDay({ day, garrisonSupplies })`：①产出 ②民心 ③兵源 ④军团补给扣粮（可选）
- [x] 幂等：`city.settledDay` 标记，同日重复调用返回 `alreadySettled` 且不改数据
- [x] 只对有城池的势力结算；无城池/中立城池由调用方过滤
- [x] 事件：`city.productionSettled` / `city.moraleChanged` / `city.recruitPoolUpdated` / `city.famine`
- [x] ⑤ 建造/押运进度推进**委托**既有 ConstructionSystem / ConvoyService（不在本服务重复实现）

## E. 招募三路径（§6）

- [x] `recruit({ cityId | fromCampId | null, unitType, count, partySpace })`
- [x] 三路径：城内（扣 `population.recruitable` + 城池资源）/ 营地（寨仓资源与名额）/ 流浪（玩家背包，
      受队伍空位限制，不扣名额）
- [x] 成本表 `recruitCost.perSoldier` + `byUnitType` 覆盖；`batchMax` 20；`requiresFormedArmy` false
- [x] 先全量校验、后一次性扣减（原子，失败不改任何数据）；事件 `city.recruited`
- [x] 营地注册 `registerCamp/removeCamp`（`fromCampId` 权威来源；未知营地拒绝，不静默降级）
- [x] 只产出兵员数（`ArmyState.roster`），不刷实体（实体入场才展开）

## F. 攻击 / 输送 / 易主（§7/§8）

- [x] `orderAttack`：有军团 → `army.order{order:'attack'}` 计划；无军团 → `army.form` + `requiresConfirm`
- [x] `orderTransport`：校验库存 → 扣城池侧 → `convoy.assemble` 计划；**围城禁输送出城**
- [x] `transfer`：城池间直接调拨（剧情用，原子）
- [x] `beginSiege` / `liftSiege`（守城胜 +8 民心）/ `captureCity`（换势力、-12 民心、
      `damageRatio +0.15`、按 `transferRatio` 0.5 转移资源到胜方城池）
- [x] 事件：`city.siegeStarted` / `city.siegeLifted` / `city.captured` / `city.transportDispatched`

## G. 偏差与推导记录

1. **偏差（UI 未做）**：城池卡 `CityPanel`（攻击/输送两个按钮）未接入 `WorldMapPanel`；
   本轮提供 `orderAttack` / `orderTransport` 计划层与事件，UI 接线留 UI 批次。
2. **偏差（④ 军团补给）**：日结只负责「从城内 food 扣减并返回 `supplyFood`」，
   军团士气 `-10` 由军团侧（模块 3/4）承担，避免双写。
3. **推导（名额上限）**：文档未给 `population.recruitable` 上限，取
   `max(floor(total/100 × 1.5), recoverPerDay)`——既能复现文档例（4200 → 63），
   又保证小城每日恢复不被压成 0。
4. **推导（易主资源转移）**：文档只说「资源按战果转移」，实现取 `transferRatio` 默认 0.5 并落配置。
5. **推导（营地名额恢复）**：`campRecruitableBase` 20 / `campRecruitablePerDay` 10 只登记在配置，
   每日恢复由调用方在日结时调用（S02 本轮不做任务改造，无营地日结需求）。
6. **编辑器**：`CITY_SCHEMA` 新字段均可选，编辑器暂无城池专用表单（专属 JSON 域可编辑）。

## H. 测试

- `CityAdministrationService.test.js` 19 例：产出公式 4 / 日结 4 / 招募 4 / 输送围城易主 5 / 存档 2
- 回归：`src/systems + src/data` 1019/1020 绿，1 例存量失败（`DefinitionRepository` 依赖缺失，非本轮引入）

## 进度锚点（2026-11-11 · M7 完成）

- 交付：产出公式 / 民心五源（含 P13 饥荒）/ 日结幂等 / 招募三路径 / 攻击输送 / 围城易主 / 事件
- 测试：新增 19 例全绿
- 下一步：M9（粮草与后勤经济）；M8 按 P11 冻结
