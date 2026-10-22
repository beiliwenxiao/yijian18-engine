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

import { describe, expect, it } from 'vitest';
import {
  SKELETON_DIRECTION_KEYS,
  SKELETON_DIRECTION_LABELS,
  SKELETON_HEAD_SLOT_PLAN,
  SKELETON_DIAGONAL_FALLBACK,
  resolveDirectionKey,
  isMirroredFacing
} from './SkeletonDirection.js';

describe('方向形态键集合', () => {
  it('7 形态：正面/侧面/背面 + 四个斜向', () => {
    expect(SKELETON_DIRECTION_KEYS).toEqual(['down', 'side', 'up', 'SE', 'SW', 'NE', 'NW']);
  });

  it('每个形态键都有显示名', () => {
    for (const key of SKELETON_DIRECTION_KEYS) {
      expect(SKELETON_DIRECTION_LABELS[key]).toBeTruthy();
    }
  });
});

describe('SKELETON_HEAD_SLOT_PLAN 头部形态可见性', () => {
  it('每个形态键都有头/发三态显隐表', () => {
    for (const key of SKELETON_DIRECTION_KEYS) {
      const plan = SKELETON_HEAD_SLOT_PLAN[key];
      expect(plan).toBeTruthy();
      expect(plan.headFront).toBeTypeOf('boolean');
      expect(plan.hairFront).toBeTypeOf('boolean');
    }
  });

  it('正面=正脸头，侧面=侧脸头，背面=后脑头', () => {
    expect(SKELETON_HEAD_SLOT_PLAN.down.headFront).toBe(true);
    expect(SKELETON_HEAD_SLOT_PLAN.side.headSide).toBe(true);
    expect(SKELETON_HEAD_SLOT_PLAN.up.headBack).toBe(true);
  });

  it('斜前用正脸、斜后用后脑（与运行时一致）', () => {
    expect(SKELETON_HEAD_SLOT_PLAN.SE.headFront).toBe(true);
    expect(SKELETON_HEAD_SLOT_PLAN.SW.headFront).toBe(true);
    expect(SKELETON_HEAD_SLOT_PLAN.NE.headBack).toBe(true);
    expect(SKELETON_HEAD_SLOT_PLAN.NW.headBack).toBe(true);
  });

  it('同一形态里头与发型显隐同步', () => {
    for (const key of SKELETON_DIRECTION_KEYS) {
      const plan = SKELETON_HEAD_SLOT_PLAN[key];
      expect(plan.headFront).toBe(plan.hairFront);
      expect(plan.headSide).toBe(plan.hairSide);
      expect(plan.headBack).toBe(plan.hairBack);
    }
  });
});

describe('SKELETON_DIAGONAL_FALLBACK 斜向回退', () => {
  it('斜前回退正面、斜后回退背面', () => {
    expect(SKELETON_DIAGONAL_FALLBACK.SE).toBe('down');
    expect(SKELETON_DIAGONAL_FALLBACK.SW).toBe('down');
    expect(SKELETON_DIAGONAL_FALLBACK.NE).toBe('up');
    expect(SKELETON_DIAGONAL_FALLBACK.NW).toBe('up');
  });

  it('基本方向没有回退项', () => {
    expect(SKELETON_DIAGONAL_FALLBACK.down).toBeUndefined();
    expect(SKELETON_DIAGONAL_FALLBACK.side).toBeUndefined();
  });
});

describe('resolveDirectionKey 朝向 → 形态键', () => {
  it('基本朝向', () => {
    expect(resolveDirectionKey('down')).toBe('down');
    expect(resolveDirectionKey('up')).toBe('up');
    expect(resolveDirectionKey('left')).toBe('side');
    expect(resolveDirectionKey('right')).toBe('side');
  });

  it('斜向朝向', () => {
    expect(resolveDirectionKey('down-right')).toBe('SE');
    expect(resolveDirectionKey('down-left')).toBe('SW');
    expect(resolveDirectionKey('up-right')).toBe('NE');
    expect(resolveDirectionKey('up-left')).toBe('NW');
  });

  it('缺省/非法朝向回退正面', () => {
    expect(resolveDirectionKey()).toBe('down');
    expect(resolveDirectionKey('')).toBe('down');
    expect(resolveDirectionKey('weird')).toBe('down');
  });
});

describe('isMirroredFacing 左系朝向镜像', () => {
  it('左/斜左下/斜左上需要镜像，其余不需要', () => {
    expect(isMirroredFacing('left')).toBe(true);
    expect(isMirroredFacing('down-left')).toBe(true);
    expect(isMirroredFacing('up-left')).toBe(true);
    expect(isMirroredFacing('right')).toBe(false);
    expect(isMirroredFacing('down')).toBe(false);
    expect(isMirroredFacing('down-right')).toBe(false);
  });
});
