/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @date      2026-01-14
 ************************************************************/

/**
 * B6 战场兵力池（总池 / 同屏 / 补员）的唯一算法。
 *
 * 状态形状：`{ total, screen, reserve, defeated }`
 * - total   ：总兵力池
 * - screen  ：同屏上限
 * - reserve ：尚未入场的余量
 * - defeated：累计阵亡
 *
 * S02 围剿与 S13 精山共用这套补员算术，场景层只负责生成/移除实体。
 */

/** 建立兵力池；`reserve` 缺省 = total - 已入场数（S02 称「先头」）。 */
export function createBattlePool({ total = 0, screen = 0, defeated = 0, reserve = null } = {}) {
  const poolTotal = Math.max(0, Math.floor(Number(total) || 0));
  const screenCap = Math.max(0, Math.min(Math.floor(Number(screen) || 0), poolTotal || Infinity));
  return {
    total: poolTotal,
    screen: screenCap,
    reserve: reserve == null ? Math.max(0, poolTotal - screenCap) : Math.max(0, Math.floor(Number(reserve) || 0)),
    defeated: Math.max(0, Math.floor(Number(defeated) || 0))
  };
}

/** 记录阵亡数（调用方负责从存活差计算）。 */
export function recordPoolDeaths(pool, deaths = 0) {
  if (!pool) return 0;
  const value = Math.max(0, Math.floor(Number(deaths) || 0));
  pool.defeated += value;
  return pool.defeated;
}

/** 计算本次应补员数量，并从 reserve 扣除（不改动场景）。 */
export function planRefill(pool, alive = 0) {
  if (!pool || pool.reserve <= 0) return 0;
  const aliveCount = Math.max(0, Math.floor(Number(alive) || 0));
  if (aliveCount >= pool.screen) return 0;
  const spawnCount = Math.min(pool.screen - aliveCount, pool.reserve);
  pool.reserve -= spawnCount;
  return spawnCount;
}

/** 总池是否已耗尽（击破 total 即胜）。 */
export function isPoolExhausted(pool) {
  return Boolean(pool) && pool.total > 0 && pool.defeated >= pool.total;
}
