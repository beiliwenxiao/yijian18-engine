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

/**
 * B4 战争物资账：S12 救援 / S13 物资换战果的投入统一走 FoodLedgerSystem。
 *
 * 单一事实源：营地仓 camp.stock + 军团随身粮 army.supply.food。
 * 不再从玩家背包直接扣战争投入，也不写 battle resources / 城池字段。
 */

export const PLAYER_CAMP_IDS = Object.freeze(['camp.s02.field', 'camp.s10.creek']);
export const PLAYER_ARMY_ID = 'army.player.escort';

/** 解析当前可用的玩家粮账来源：营地仓优先，军团粮兜底（只对 food 生效）。 */
export function resolvePlayerWarSupply(ledger = null) {
  const campId = PLAYER_CAMP_IDS.find(campId => Boolean(ledger?.getCamp?.(campId))) || null;
  const armyId = ledger?.getArmy?.(PLAYER_ARMY_ID) ? PLAYER_ARMY_ID : null;
  return { campId, armyId };
}

/** 预演投入（不写状态）。costs 支持 `resource.food` 或 `food` 两种键。 */
export function previewWarMaterials(ledger = null, costs = {}) {
  if (!ledger?.previewConsume) return { ok: false, code: 'ledgerUnavailable' };
  const { campId, armyId } = resolvePlayerWarSupply(ledger);
  if (!campId && !armyId) return { ok: false, code: 'noPlayerSupply' };
  return ledger.previewConsume({ campId, armyId, entries: costs });
}

/** 核销投入（幂等 operationId）。失败时返回 insufficientWarMaterials + missing 明细。 */
export function spendWarMaterials(ledger = null, { costs = {}, operationId = null } = {}) {
  if (!ledger?.consume) return { ok: false, code: 'ledgerUnavailable' };
  const { campId, armyId } = resolvePlayerWarSupply(ledger);
  if (!campId && !armyId) return { ok: false, code: 'noPlayerSupply' };
  const result = ledger.consume({ campId, armyId, entries: costs, operationId });
  return result.ok ? result : { ...result, code: 'insufficientWarMaterials' };
}

/** 账本快照 / 回滚（S12/S13 事务失败时恢复）。 */
export function snapshotWarLedger(ledger = null) {
  if (!ledger?.serialize) return null;
  try {
    return ledger.serialize();
  } catch (error) {
    return null;
  }
}

export function restoreWarLedger(ledger = null, snapshot = null) {
  if (!snapshot || !ledger?.restore) return false;
  try {
    ledger.restore(snapshot);
    return true;
  } catch (error) {
    return false;
  }
}
