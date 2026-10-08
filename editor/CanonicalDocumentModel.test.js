/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

import { describe, expect, it } from 'vitest';
import { CanonicalDocumentModel } from './CanonicalDocumentModel.js';
import { CanonicalDocumentService } from './CanonicalDocumentService.js';
import { EditorDataManager } from './EditorDataManager.js';

function aggregate() {
  return {
    project: { scenes: [{ id: 'S01' }], meta: { name: 'game' } },
    sceneOrder: { order: ['S01'], scenes: { S01: { name: 'one' } } },
    scenes: { S01: { id: 'S01', layers: [] } }
  };
}

describe('CanonicalDocumentModel', () => {
  it('统一 path patch、dirtyPaths、undo/redo 与 committed snapshot', () => {
    const original = aggregate();
    const model = new CanonicalDocumentModel({
      sourceUri: 'example/game/game.project.json',
      schemaId: 'canonicalProjectClosure',
      canonical: original,
      snapshotRevision: 4
    });

    model.patch('project.meta.name', 'changed');
    model.patch('/scenes/S01/layers', [{ id: 'objects' }]);
    expect(model.workingCopy.project.meta.name).toBe('changed');
    expect(model.workingCopy.scenes.S01.layers).toEqual([{ id: 'objects' }]);
    expect([...model.dirtyPaths]).toEqual(['project.meta.name', 'scenes.S01.layers']);
    expect(original.project.meta.name).toBe('game');

    expect(model.undo()).toBe(true);
    expect(model.workingCopy.scenes.S01.layers).toEqual([]);
    expect(model.redo()).toBe(true);
    expect(model.workingCopy.scenes.S01.layers).toEqual([{ id: 'objects' }]);

    const committed = model.getCandidate();
    model.commitSnapshot(committed, { snapshotRevision: 5 });
    expect(model.snapshotRevision).toBe(5);
    expect(model.isDirty).toBe(false);
    expect(model.canUndo).toBe(false);
    expect(model.originalCanonical).toEqual(committed);
    expect(() => { model.originalCanonical.project.meta.name = 'illegal'; }).toThrow();
  });

  it('支持数组删除并拒绝 prototype pollution path', () => {
    const model = new CanonicalDocumentModel({ sourceUri: 'p/game.project.json', schemaId: 'x', canonical: { values: ['a', 'b'] } });
    model.patch('values[0]', undefined, { op: 'delete' });
    expect(model.workingCopy.values).toEqual(['b']);
    expect(() => model.patch('__proto__.polluted', true)).toThrow(/不安全/);
  });
});

describe('CanonicalDocumentService', () => {
  it('同一打开项目只创建一个 model，关闭后才可重新创建', () => {
    const service = new CanonicalDocumentService();
    const first = service.openProject({ sourceUri: './example/game/game.project.json', canonical: aggregate() });
    const second = service.openProject({ sourceUri: 'example/game/game.project.json', canonical: { ignored: true } });
    expect(second).toBe(first);
    expect(service.openProjectCount).toBe(1);
    expect(service.closeProject('example/game/game.project.json')).toBe(true);
    expect(service.openProjectCount).toBe(0);
  });
});

describe('EditorDataManager canonical draft', () => {
  it('createSceneDraft 只生成候选，不在磁盘提交前写 localStorage scene cache', () => {
    const manager = new EditorDataManager();
    const key = `${manager.storageKey}_scenes_draft-test`;
    localStorage.removeItem(key);
    const draft = manager.createSceneDraft({ id: 'S99', name: 'draft', width: 800, height: 450 });
    expect(draft).toMatchObject({ id: 'S99', name: 'draft', width: 800, height: 450 });
    expect(localStorage.getItem(key)).toBeNull();
  });
});
