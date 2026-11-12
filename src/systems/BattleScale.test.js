/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @date      2026-01-14
 ************************************************************/

import { describe, expect, it } from 'vitest';
import { DEFAULT_BATTLE_SCALE, normalizeBattleScale, resolveBattleScale } from './BattleScale.js';

describe('B5 · 战场规模 scale 归一', () => {
  it('默认 1000 池 / 同屏 100，缺省与非法值都回落默认', () => {
    expect(normalizeBattleScale()).toEqual(DEFAULT_BATTLE_SCALE);
    expect(normalizeBattleScale({})).toEqual(DEFAULT_BATTLE_SCALE);
    expect(normalizeBattleScale({ pool: 0, screen: -1 })).toEqual(DEFAULT_BATTLE_SCALE);
    expect(normalizeBattleScale({ pool: '600', screen: '100' })).toEqual({ pool: 600, screen: 100 });
  });

  it('兼容旧字段名 total / screenCap，且同屏不得超过总池', () => {
    expect(normalizeBattleScale({ total: 1000, screenCap: 100 })).toEqual({ pool: 1000, screen: 100 });
    expect(normalizeBattleScale({ pool: 600, screen: 900 })).toEqual({ pool: 600, screen: 600 });
  });

  it('从战斗定义解析：顶层 scale 优先，其次 createParams.scale', () => {
    expect(resolveBattleScale({ scale: { pool: 600, screen: 100 } })).toEqual({ pool: 600, screen: 100 });
    expect(resolveBattleScale({ createParams: { scale: { pool: 400, screen: 50 } } })).toEqual({ pool: 400, screen: 50 });
    expect(resolveBattleScale({ scale: { pool: 600 }, createParams: { scale: { pool: 400, screen: 50 } } }))
      .toEqual({ pool: 600, screen: 100 });
    expect(resolveBattleScale(null)).toEqual(DEFAULT_BATTLE_SCALE);
  });
});
