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

import { describe, it, expect } from 'vitest';
import { createPlayerLpcFrameMapper } from './PlayerLpcFrameMapper.js';

/** 构造整帧模式资产（meta.clipFrames）与实体桩。 */
function makeFixture() {
  const framesFor = (row) => Array.from({ length: 6 }, (_, i) => ({ sx: i * 64, sy: row * 64, sw: 64, sh: 64 }));
  const dirsFor = (row) => ({
    down: framesFor(row), left: framesFor(row + 1), up: framesFor(row - 1), right: framesFor(row + 3)
  });
  const asset = {
    meta: {
      frameMode: true,
      clipFrames: {
        idle_down: { fps: 6, action: 'idle', dirs: dirsFor(2) },
        idle_side: { fps: 6, action: 'idle', dirs: dirsFor(2) },
        idle_up: { fps: 6, action: 'idle', dirs: dirsFor(2) },
        idle_SE: { fps: 6, action: 'idle', dirs: dirsFor(2) },
        idle_SW: { fps: 6, action: 'idle', dirs: dirsFor(2) },
        idle_NE: { fps: 6, action: 'idle', dirs: dirsFor(2) },
        idle_NW: { fps: 6, action: 'idle', dirs: dirsFor(2) },
        walk_down: { fps: 12, action: 'walk', dirs: dirsFor(6) },
        walk_side: { fps: 12, action: 'walk', dirs: dirsFor(6) },
        walk_up: { fps: 12, action: 'walk', dirs: dirsFor(6) },
        walk_SE: { fps: 12, action: 'walk', dirs: dirsFor(6) },
        walk_SW: { fps: 12, action: 'walk', dirs: dirsFor(6) },
        walk_NE: { fps: 12, action: 'walk', dirs: dirsFor(6) },
        walk_NW: { fps: 12, action: 'walk', dirs: dirsFor(6) },
        attack: { fps: 12, action: 'slash', dirs: dirsFor(18) }
      }
    }
  };
  const sprite = { direction: 'down', isWalking: false, isStopping: false, flipX: false };
  const entity = { getComponent: (id) => (id === 'sprite' ? sprite : null) };
  const overrides = [];
  const played = [];
  const skeletonComponent = {
    skeletonAsset: asset,
    currentClip: 'idle_down',
    setSlotOverride: (slotId, patch) => overrides.push({ slotId, patch }),
    playClip: (name) => { played.push(name); skeletonComponent.currentClip = name; return true; }
  };
  return { entity, sprite, skeletonComponent, overrides, played };
}

describe('PlayerLpcFrameMapper（整帧角色模式）', () => {
  it('待机：写 idle_down 的正面帧表与帧率', () => {
    const f = makeFixture();
    const hook = createPlayerLpcFrameMapper(f.entity);
    hook(f.skeletonComponent);
    expect(f.overrides).toHaveLength(1);
    expect(f.overrides[0].slotId).toBe('frame');
    expect(f.overrides[0].patch.fps).toBe(6);
    expect(f.overrides[0].patch.frames[0].sy).toBe(2 * 64);
  });

  it('行走：切到 walk_down 剪辑并写行走帧表', () => {
    const f = makeFixture();
    f.sprite.isWalking = true;
    const hook = createPlayerLpcFrameMapper(f.entity);
    hook(f.skeletonComponent);
    expect(f.played).toContain('walk_down');
    expect(f.overrides[0].patch.fps).toBe(12);
    expect(f.overrides[0].patch.frames[0].sy).toBe(6 * 64);
  });

  it('背向：切 idle_up 并用 up 帧', () => {
    const f = makeFixture();
    f.sprite.direction = 'up';
    const hook = createPlayerLpcFrameMapper(f.entity);
    hook(f.skeletonComponent);
    expect(f.played).toContain('idle_up');
    expect(f.overrides[0].patch.frames[0].sy).toBe(1 * 64);   // up 方向行 1
  });

  it('左右向用 LPC 独立的 left/right 帧，且不启用镜像', () => {
    const left = makeFixture();
    left.sprite.direction = 'left';
    createPlayerLpcFrameMapper(left.entity)(left.skeletonComponent);
    expect(left.overrides[0].patch.frames[0].sy).toBe(3 * 64);  // left 方向行 3
    expect(left.sprite.flipX).toBe(false);

    const right = makeFixture();
    right.sprite.direction = 'right';
    createPlayerLpcFrameMapper(right.entity)(right.skeletonComponent);
    expect(right.overrides[0].patch.frames[0].sy).toBe(5 * 64);  // right 方向行 5
  });

  it('斜向回退：斜前→down 帧、斜后→up 帧', () => {
    const se = makeFixture();
    se.sprite.direction = 'down-right';
    createPlayerLpcFrameMapper(se.entity)(se.skeletonComponent);
    expect(se.overrides[0].patch.frames[0].sy).toBe(2 * 64);

    const ne = makeFixture();
    ne.sprite.direction = 'up-right';
    createPlayerLpcFrameMapper(ne.entity)(ne.skeletonComponent);
    expect(ne.overrides[0].patch.frames[0].sy).toBe(1 * 64);
  });

  it('离散剪辑优先：attack 用 attack 剪辑的帧表', () => {
    const f = makeFixture();
    f.skeletonComponent.currentClip = 'attack';
    const hook = createPlayerLpcFrameMapper(f.entity);
    hook(f.skeletonComponent);
    expect(f.played).not.toContain('idle_down');
    expect(f.overrides[0].patch.frames[0].sy).toBe(18 * 64);
  });

  it('状态不变时不重复写覆盖层', () => {
    const f = makeFixture();
    const hook = createPlayerLpcFrameMapper(f.entity);
    hook(f.skeletonComponent);
    hook(f.skeletonComponent);
    hook(f.skeletonComponent);
    expect(f.overrides).toHaveLength(1);
  });

  it('资产缺帧表时安全跳过', () => {
    const f = makeFixture();
    f.skeletonComponent.skeletonAsset = { meta: {} };
    const hook = createPlayerLpcFrameMapper(f.entity);
    expect(() => hook(f.skeletonComponent)).not.toThrow();
    expect(f.overrides).toHaveLength(0);
  });
});
