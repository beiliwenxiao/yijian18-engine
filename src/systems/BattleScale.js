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
 * B5 战场规模唯一口径：战斗定义上的 `scale: { pool, screen }`。
 *
 * - pool  ：总兵力池（本场最多投入多少兵）
 * - screen：同屏上限（同时存活/渲染多少兵）
 *
 * 兼容旧字段名 `total` / `screenCap`（S02 围剿自实现曾用这两个名字），
 * 归一后统一为 pool / screen，避免「总池 / 同屏」在多处各说一套。
 */

export const DEFAULT_BATTLE_SCALE = Object.freeze({ pool: 1000, screen: 100 });

/** 把任意写法的规模归一成 `{ pool, screen }`，非法值回落到默认值。 */
export function normalizeBattleScale(scale = null, fallback = DEFAULT_BATTLE_SCALE) {
  const source = scale && typeof scale === 'object' ? scale : fallback;
  const rawPool = Number(source.pool ?? source.total);
  const rawScreen = Number(source.screen ?? source.screenCap);
  const pool = Number.isFinite(rawPool) && rawPool > 0 ? Math.floor(rawPool) : fallback.pool;
  const screen = Number.isFinite(rawScreen) && rawScreen > 0 ? Math.floor(rawScreen) : fallback.screen;
  return Object.freeze({ pool, screen: Math.min(screen, pool) });
}

/** 从战斗定义（顶层或 createParams）解析规模；缺省走默认 1000 / 100。 */
export function resolveBattleScale(definition = null) {
  return normalizeBattleScale(definition?.scale || definition?.createParams?.scale || null);
}
