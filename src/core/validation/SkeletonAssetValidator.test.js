import { describe, it, expect } from 'vitest';
import { validateSkeletonAsset } from './SkeletonAssetValidator.js';

const VALID_DOC = {
  schemaVersion: 1,
  skeletonId: 'skeleton.demo',
  meta: { width: 100, height: 160 },
  bones: [
    { id: 'root', parent: null },
    { id: 'child', parent: 'root' }
  ],
  slots: [
    {
      id: 'body',
      bone: 'child',
      z: 0,
      attachment: { type: 'image', assetId: 'img.x', width: 64, height: 88 }
    }
  ],
  clips: [
    {
      name: 'walk',
      durationMs: 800,
      loop: true,
      tracks: [
        {
          bone: 'child',
          keys: [
            { t: 0, rot: 0, ease: 'linear' },
            { t: 800, rot: 30, ease: 'easeInOut' }
          ]
        }
      ]
    }
  ]
};

describe('validateSkeletonAsset', () => {
  it('合法文档通过并原样返回', () => {
    const result = validateSkeletonAsset(VALID_DOC);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(VALID_DOC);
  });

  it('拒绝：非对象 / schemaVersion 错误 / 空 bones', () => {
    expect(validateSkeletonAsset(null).ok).toBe(false);
    expect(validateSkeletonAsset({ ...VALID_DOC, schemaVersion: 2 }).ok).toBe(false);
    expect(validateSkeletonAsset({ ...VALID_DOC, bones: [] }).ok).toBe(false);
  });

  it('拒绝：重复骨骼 ID 与未知父引用', () => {
    const doc = {
      ...VALID_DOC,
      bones: [
        { id: 'root', parent: null },
        { id: 'root', parent: null },
        { id: 'child', parent: 'ghost' }
      ]
    };
    const result = validateSkeletonAsset(doc);
    expect(result.ok).toBe(false);
    expect(result.errors.some(error => /重复的骨骼 ID/.test(error.message ?? ''))).toBe(true);
    expect(result.errors.some(error => /父骨骼不存在/.test(error.message ?? ''))).toBe(true);
  });

  it('拒绝：骨骼父链成环', () => {
    const doc = {
      ...VALID_DOC,
      bones: [
        { id: 'a', parent: 'b' },
        { id: 'b', parent: 'a' }
      ]
    };
    const result = validateSkeletonAsset(doc);
    expect(result.ok).toBe(false);
    expect(result.errors.some(error => /环/.test(error.message ?? ''))).toBe(true);
  });

  it('拒绝：槽位引用不存在的骨骼 / 附件缺 assetId', () => {
    const result = validateSkeletonAsset({
      ...VALID_DOC,
      slots: [
        { id: 's', bone: 'ghost', attachment: { type: 'image' } }
      ]
    });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('拒绝：sequence 附件缺帧表或 fps', () => {
    const result = validateSkeletonAsset({
      ...VALID_DOC,
      slots: [
        { id: 's', bone: 'child', attachment: { type: 'sequence', assetId: 'img.x', frames: [], fps: 8 } },
        { id: 's2', bone: 'child', attachment: { type: 'sequence', assetId: 'img.x', frames: [{ sx: 0, sy: 0, sw: 32, sh: 32 }] } }
      ]
    });
    expect(result.ok).toBe(false);
  });

  it('拒绝：关键帧越界 / 时间倒退 / 轨道骨骼不存在', () => {
    const result = validateSkeletonAsset({
      ...VALID_DOC,
      clips: [
        {
          name: 'bad',
          durationMs: 100,
          tracks: [
            { bone: 'child', keys: [{ t: 200 }] },
            { bone: 'ghost', keys: [{ t: 0 }, { t: 50 }] },
            { bone: 'child', keys: [{ t: 50 }, { t: 10 }] }
          ]
        }
      ]
    });
    expect(result.ok).toBe(false);
    const messages = result.errors.map(error => error.message ?? '');
    expect(messages.some(message => /超出剪辑时长/.test(message))).toBe(true);
    expect(messages.some(message => /轨道引用的骨骼不存在/.test(message))).toBe(true);
    expect(messages.some(message => /单调不减/.test(message))).toBe(true);
  });

  it('拒绝：重复剪辑名', () => {
    const result = validateSkeletonAsset({
      ...VALID_DOC,
      clips: [VALID_DOC.clips[0], { ...VALID_DOC.clips[0] }]
    });
    expect(result.ok).toBe(false);
  });
});
