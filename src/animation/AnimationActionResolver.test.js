/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-05
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

import { describe, it, expect } from 'vitest';
import { parseSkeletonAsset } from './SkeletonAsset.js';
import {
  hasClip,
  stripFormSuffix,
  resolveActionClip,
  resolveDiscreteClip
} from './AnimationActionResolver.js';

/** 部件骨骼资产：walk 三正交形态 + 裸 attack + attack_side + death 单方向。 */
function buildSkeletalAsset() {
  return parseSkeletonAsset({
    schemaVersion: 1,
    skeletonId: 'skeleton.resolver-test',
    meta: { width: 64, height: 64 },
    defaultClip: 'idle_down',
    bones: [{ id: 'root', parent: null, x: 0, y: 0 }],
    slots: [],
    clips: [
      { name: 'idle_down', durationMs: 1000, loop: true, tracks: [] },
      { name: 'walk_down', durationMs: 1000, loop: true, tracks: [] },
      { name: 'walk_side', durationMs: 1000, loop: true, tracks: [] },
      { name: 'walk_up', durationMs: 1000, loop: true, tracks: [] },
      { name: 'attack', durationMs: 400, loop: false, tracks: [] },
      { name: 'attack_side', durationMs: 400, loop: false, tracks: [] },
      { name: 'death', durationMs: 800, loop: false, tracks: [] },
      { name: 'logging', durationMs: 1000, loop: true, tracks: [] }
    ]
  });
}

/** 整帧（LPC）资产：clips Map 为空，真实帧表在 meta.clipFrames。 */
function buildFrameModeAsset() {
  return parseSkeletonAsset({
    schemaVersion: 1,
    skeletonId: 'skeleton.frame-test',
    meta: {
      width: 64,
      height: 64,
      frameMode: true,
      clipFrames: {
        idle_down: { fps: 6, dirs: { down: [0] } },
        walk_down: { fps: 8, dirs: { down: [0, 1, 2] } },
        jump: { fps: 8, dirs: { down: [0, 1] } }
      }
    },
    bones: [{ id: 'root', parent: null, x: 0, y: 0 }],
    slots: [],
    clips: []
  });
}

describe('hasClip（骨骼/整帧双实现探测）', () => {
  it('部件骨骼资产：clips Map 命中', () => {
    const asset = buildSkeletalAsset();
    expect(hasClip(asset, 'walk_down')).toBe(true);
    expect(hasClip(asset, 'walk_SE')).toBe(false);
  });

  it('整帧资产：clips Map 为空不误判，真实帧表在 meta.clipFrames', () => {
    const asset = buildFrameModeAsset();
    expect(hasClip(asset, 'walk_down')).toBe(true);
    expect(hasClip(asset, 'jump')).toBe(true);
    expect(hasClip(asset, 'walk_side')).toBe(false);
  });

  it('空资产/空名安全返回 false', () => {
    expect(hasClip(null, 'walk')).toBe(false);
    expect(hasClip(buildSkeletalAsset(), '')).toBe(false);
  });
});

describe('stripFormSuffix（已知形态后缀剥离）', () => {
  it('剥离方向形态后缀还原动作主键', () => {
    expect(stripFormSuffix('walk_SE')).toBe('walk');
    expect(stripFormSuffix('attack_side')).toBe('attack');
    expect(stripFormSuffix('idle_down')).toBe('idle');
  });

  it('非方向后缀不误伤（sit_down 是完整动作名时由调用方先精确命中）', () => {
    expect(stripFormSuffix('logging')).toBe('logging');
    expect(stripFormSuffix('climb_back')).toBe('climb_back');
  });
});

describe('resolveActionClip（动作×方向统一回退链）', () => {
  it('① 多方向动作精确形态命中（含斜向形态）', () => {
    const asset = buildSkeletalAsset();
    expect(resolveActionClip(asset, 'walk', 'down')).toEqual({ clip: 'walk_down', dirKey: 'down' });
    expect(resolveActionClip(asset, 'walk', 'left')).toEqual({ clip: 'walk_side', dirKey: 'side' });
  });

  it('② 斜向形态缺失回退正/背（SE→down、NE→up）', () => {
    const asset = buildSkeletalAsset();
    expect(resolveActionClip(asset, 'walk', 'down-right')).toEqual({ clip: 'walk_down', dirKey: 'SE' });
    expect(resolveActionClip(asset, 'walk', 'up-left')).toEqual({ clip: 'walk_up', dirKey: 'NW' });
  });

  it('③ 单方向动作：无方向变体直接用裸剪辑（death 按任意朝向都是 death）', () => {
    const asset = buildSkeletalAsset();
    expect(resolveActionClip(asset, 'death', 'up')).toEqual({ clip: 'death', dirKey: 'up' });
    expect(resolveActionClip(asset, 'death', 'down-left')).toEqual({ clip: 'death', dirKey: 'SW' });
  });

  it('③ 混合动作：attack 裸版 + attack_side 共存，side 朝向优先方向变体', () => {
    const asset = buildSkeletalAsset();
    expect(resolveActionClip(asset, 'attack', 'right')).toEqual({ clip: 'attack_side', dirKey: 'side' });
    expect(resolveActionClip(asset, 'attack', 'down')).toEqual({ clip: 'attack', dirKey: 'down' });
  });

  it('④ 全部缺失返回 null（调用方回退 defaultClip）', () => {
    const asset = buildSkeletalAsset();
    expect(resolveActionClip(asset, 'gather', 'down')).toBeNull();
  });

  it('整帧资产同一查询成立：walk/down 走 clipFrames，斜向回退语义一致', () => {
    const asset = buildFrameModeAsset();
    expect(resolveActionClip(asset, 'walk', 'down')).toEqual({ clip: 'walk_down', dirKey: 'down' });
    expect(resolveActionClip(asset, 'walk', 'down-left')).toEqual({ clip: 'walk_down', dirKey: 'SW' });
    expect(resolveActionClip(asset, 'jump', 'up')).toEqual({ clip: 'jump', dirKey: 'up' });
  });
});

describe('resolveDiscreteClip（离散动作方向变体升级/降级）', () => {
  it('裸动作名 + 资产有方向变体：按朝向升级（attack → attack_side）', () => {
    const asset = buildSkeletalAsset();
    expect(resolveDiscreteClip(asset, 'attack', 'left')).toEqual({ clip: 'attack_side', base: 'attack' });
  });

  it('裸动作名 + 无方向变体命中朝向：保持裸名', () => {
    const asset = buildSkeletalAsset();
    expect(resolveDiscreteClip(asset, 'attack', 'down')).toEqual({ clip: 'attack', base: 'attack' });
  });

  it('带形态后缀名精确命中优先（外部点名 attack_side 就播 attack_side）', () => {
    const asset = buildSkeletalAsset();
    expect(resolveDiscreteClip(asset, 'attack_side', 'up')).toEqual({ clip: 'attack_side', base: 'attack' });
  });

  it('带形态后缀名缺失：降级裸动作（attack_side 缺失但 attack 存在）', () => {
    const asset = buildSkeletalAsset();
    expect(resolveDiscreteClip(asset, 'attack_down', 'down')).toEqual({ clip: 'attack', base: 'attack' });
  });

  it('无方向后缀的完整动作名精确命中，不被后缀剥离误伤', () => {
    const asset = buildSkeletalAsset();
    expect(resolveDiscreteClip(asset, 'logging', 'down')).toEqual({ clip: 'logging', base: 'logging' });
  });

  it('完全缺失返回 null（调用方清保持态回连续映射）', () => {
    const asset = buildSkeletalAsset();
    expect(resolveDiscreteClip(asset, 'spin_attack', 'down')).toBeNull();
  });
});
