/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://github.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * WarLogisticsSnapshot - 军需体系存档落点（checkpoint.warState.logistics）。
 *
 * 设计依据：.trae/documents/军需接线与UI批次-实施计划.md 批次 2 与 D3。
 * 存档位置：黑板 `warState.logistics`，随 `checkpoint.warState` 一起落盘；
 * 不改 `CHECKPOINT_SCHEMA`（`warState` 仍是 OBJECT），旧档缺该子键按空态恢复。
 */

export const WAR_LOGISTICS_SCHEMA_VERSION = 1;

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/** 采集四本账的当前状态；任一服务缺失记 null。 */
export function createWarLogisticsSnapshot({
  foodLedger = null,
  cityAdmin = null,
  battleSettlement = null,
  reputation = null
} = {}) {
  return {
    schemaVersion: WAR_LOGISTICS_SCHEMA_VERSION,
    foodLedger: foodLedger?.serialize?.() ?? null,
    cityAdmin: cityAdmin?.serialize?.() ?? null,
    battleSettlement: battleSettlement?.serialize?.() ?? null,
    reputation: reputation?.serialize?.() ?? null
  };
}

/**
 * 回灌四本账。缺段/脏段一律跳过，绝不抛错（旧档兼容优先）。
 * @returns {{ok:boolean, applied:string[], skipped:string[]}}
 */
export function applyWarLogisticsSnapshot(snapshot, services = {}) {
  const data = snapshot && typeof snapshot === 'object' ? snapshot : null;
  if (!data) return { ok: true, applied: [], skipped: ['all'], skippedAll: true };
  const pairs = [
    ['foodLedger', services.foodLedger],
    ['cityAdmin', services.cityAdmin],
    ['battleSettlement', services.battleSettlement],
    ['reputation', services.reputation]
  ];
  const applied = [];
  const skipped = [];
  for (const [key, service] of pairs) {
    const segment = data[key];
    if (segment == null || typeof service?.restore !== 'function') {
      skipped.push(key);
      continue;
    }
    try {
      const result = service.restore(clone(segment));
      if (result?.ok === false) skipped.push(key);
      else applied.push(key);
    } catch (_error) {
      skipped.push(key);
    }
  }
  return { ok: true, applied, skipped };
}

/** 从黑板读 `warState.logistics`（缺省 null）。 */
export function readWarLogistics(blackboard) {
  const warState = blackboard?.get?.('warState') || null;
  return clone(warState?.logistics) || null;
}

/** 把快照写入黑板 `warState.logistics`，保留 battles/casualties 等既有键。 */
export function writeWarLogistics(blackboard, snapshot) {
  if (!blackboard?.get || typeof blackboard.set !== 'function') return false;
  if (snapshot == null) return false;
  const warState = blackboard.get('warState') || {};
  blackboard.set('warState', { ...warState, logistics: clone(snapshot) });
  return true;
}
