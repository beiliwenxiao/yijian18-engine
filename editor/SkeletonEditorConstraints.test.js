/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-10-26
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

import { describe, expect, it } from 'vitest';
import {
  listConstraints,
  findFollowerConstraint,
  listConstraintsTargeting,
  addFollowerConstraint,
  updateFollowerConstraint,
  removeFollowerConstraint,
  renameSlotConstraintRefs,
  pruneSlotConstraints
} from './SkeletonEditorConstraints.js';

function makeDoc() {
  return {
    bones: [{ id: 'root' }],
    slots: [
      { id: 'body', attachment: { type: 'image', assetId: 'a' } },
      { id: 'hand', attachment: { type: 'image', assetId: 'b' } },
      { id: 'empty1', attachment: { type: 'empty', x: 0, y: 0, rot: 0 } }
    ]
  };
}

describe('SkeletonEditorConstraints（transform 约束编辑助手）', () => {
  it('listConstraints：未配置返回空数组且不创建字段', () => {
    const doc = makeDoc();
    expect(listConstraints(doc)).toEqual([]);
    expect('constraints' in doc).toBe(false);
  });

  it('addFollowerConstraint：缺省目标挑首个有附件的非自身槽位，缺省字段与运行时规范化对齐', () => {
    const doc = makeDoc();
    const created = addFollowerConstraint(doc, 'hand');
    expect(created).toMatchObject({
      type: 'transform', slot: 'hand', target: 'body',
      mix: 1, offsetX: 0, offsetY: 0, offsetRot: 0, followRotation: true
    });
    expect(findFollowerConstraint(doc, 'hand')).toBe(created);
  });

  it('addFollowerConstraint：每槽限一条；空附件槽不会成为缺省目标；无候选返回 null', () => {
    const doc = makeDoc();
    expect(addFollowerConstraint(doc, 'hand')).toBeTruthy();
    expect(addFollowerConstraint(doc, 'hand')).toBeNull();
    // 全部槽位都无有效附件 → 无候选
    const bare = { slots: [{ id: 'a', attachment: { type: 'empty' } }, { id: 'b', attachment: { type: 'empty' } }] };
    expect(addFollowerConstraint(bare, 'a')).toBeNull();
  });

  it('addFollowerConstraint：可显式指定目标；自指被拒绝', () => {
    const doc = makeDoc();
    expect(addFollowerConstraint(doc, 'hand', 'empty1')?.target).toBe('empty1');
    const doc2 = makeDoc();
    expect(addFollowerConstraint(doc2, 'hand', 'hand')).toBeNull();
    expect('constraints' in doc2).toBe(false);
  });

  it('updateFollowerConstraint：命中跟随者补丁写字段；未命中返回 false', () => {
    const doc = makeDoc();
    addFollowerConstraint(doc, 'hand');
    expect(updateFollowerConstraint(doc, 'hand', { mix: 0.5, offsetX: 12 })).toBe(true);
    expect(findFollowerConstraint(doc, 'hand')).toMatchObject({ mix: 0.5, offsetX: 12 });
    expect(updateFollowerConstraint(doc, 'body', { mix: 1 })).toBe(false);
  });

  it('removeFollowerConstraint：删除后数组空则连 constraints 字段一起清', () => {
    const doc = makeDoc();
    addFollowerConstraint(doc, 'hand');
    expect(removeFollowerConstraint(doc, 'hand')).toBe(true);
    expect('constraints' in doc).toBe(false);
    expect(removeFollowerConstraint(doc, 'hand')).toBe(false);
  });

  it('listConstraintsTargeting：反向列出以该槽位为目标的约束', () => {
    const doc = makeDoc();
    addFollowerConstraint(doc, 'hand', 'body');
    addFollowerConstraint(doc, 'empty1', 'body');
    const followers = listConstraintsTargeting(doc, 'body');
    expect(followers.map(entry => entry.slot).sort()).toEqual(['empty1', 'hand']);
    expect(listConstraintsTargeting(doc, 'hand')).toEqual([]);
  });

  it('renameSlotConstraintRefs：slot/target 引用同步改名', () => {
    const doc = makeDoc();
    addFollowerConstraint(doc, 'hand', 'body');
    renameSlotConstraintRefs(doc, 'hand', 'palm');
    renameSlotConstraintRefs(doc, 'body', 'torso');
    expect(findFollowerConstraint(doc, 'palm')).toMatchObject({ slot: 'palm', target: 'torso' });
  });

  it('pruneSlotConstraints：删槽位清理其全部约束（跟随者与目标两个方向），空数组清字段', () => {
    const doc = makeDoc();
    addFollowerConstraint(doc, 'hand', 'body');
    addFollowerConstraint(doc, 'empty1', 'body');
    expect(pruneSlotConstraints(doc, 'body')).toBe(2);
    expect('constraints' in doc).toBe(false);
    // 再造一条：删跟随者
    addFollowerConstraint(doc, 'hand', 'empty1');
    expect(pruneSlotConstraints(doc, 'hand')).toBe(1);
    expect(findFollowerConstraint(doc, 'hand')).toBeNull();
  });
});
