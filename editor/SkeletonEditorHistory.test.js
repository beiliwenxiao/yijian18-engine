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
import { SkeletonEditorHistory } from './SkeletonEditorHistory.js';

const makeDoc = (value) => ({ skeletonId: 'skeleton.test', value });

describe('SkeletonEditorHistory 延迟提交撤销栈', () => {
  it('空操作（文档未变）不占用撤销步', () => {
    const history = new SkeletonEditorHistory();
    const doc = makeDoc(1);
    // 模拟「点进输入框 focusin 压快照 → 什么也没改 → 再点下一个输入框」
    history.push(doc);
    history.push(doc);
    expect(history.undoDepth).toBe(0);
  });

  it('真实改动会占用一步撤销，且可撤销回改动前', () => {
    const history = new SkeletonEditorHistory();
    const doc = makeDoc(1);
    history.push(doc);            // 操作开始（快照=值 1）
    doc.value = 2;                // 操作生效
    const snapshot = history.undo(doc);
    expect(snapshot).not.toBeNull();
    expect(JSON.parse(snapshot).value).toBe(1);
  });

  it('最后一次操作无需再触发 push 也能撤销（flush 结算）', () => {
    const history = new SkeletonEditorHistory();
    const doc = makeDoc(1);
    history.push(doc);
    doc.value = 2;
    // 未再 push，直接撤销 → flush 应把待提交快照结算进栈
    const snapshot = history.undo(doc);
    expect(JSON.parse(snapshot).value).toBe(1);
  });

  it('连续两次真实改动：撤销两次回到最初', () => {
    const history = new SkeletonEditorHistory();
    const doc = makeDoc(1);
    history.push(doc); doc.value = 2;
    history.push(doc); doc.value = 3;
    // 第一次撤销 → 回到第一次改动前（value=2）
    const first = history.undo(makeDoc(3));
    expect(JSON.parse(first).value).toBe(2);
    // 第二次撤销 → 回到最初（value=1）
    const second = history.undo(makeDoc(2));
    expect(JSON.parse(second).value).toBe(1);
    expect(history.undo(makeDoc(1))).toBeNull();
  });

  it('空操作不破坏已有重做栈', () => {
    const history = new SkeletonEditorHistory();
    const doc = makeDoc(1);
    history.push(doc); doc.value = 2;
    history.undo(doc);                       // 产生重做项
    expect(history.redoDepth).toBe(1);
    history.push(doc);                       // 空操作（值仍为 2）
    history.push(doc);
    expect(history.redoDepth).toBe(1);        // 重做栈未被空操作冲掉
  });

  it('无可撤销时 undo 返回 null', () => {
    const history = new SkeletonEditorHistory();
    expect(history.undo(makeDoc(1))).toBeNull();
  });

  it('redo 恢复被撤销的文档', () => {
    const history = new SkeletonEditorHistory();
    const doc = makeDoc(1);
    history.push(doc); doc.value = 2;
    history.undo(doc);
    const snapshot = history.redo(makeDoc(1));
    expect(JSON.parse(snapshot).value).toBe(2);
  });

  it('reset 清空全部历史（换资产防跨文档撤销）', () => {
    const history = new SkeletonEditorHistory();
    const doc = makeDoc(1);
    history.push(doc); doc.value = 2;
    history.undo(doc);
    history.reset();
    expect(history.undoDepth).toBe(0);
    expect(history.redoDepth).toBe(0);
    expect(history.hasPending).toBe(false);
    expect(history.undo(makeDoc(1))).toBeNull();
  });

  it('撤销栈深度超上限时丢弃最旧快照', () => {
    const history = new SkeletonEditorHistory({ maxDepth: 2 });
    const doc = makeDoc(0);
    for (let i = 1; i <= 4; i += 1) {
      history.push(doc);
      doc.value = i;
    }
    history.flush(doc);
    expect(history.undoDepth).toBe(2);
  });
});
