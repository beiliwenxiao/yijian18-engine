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
import { ContentValidator, FieldType } from '../src/core/validation/ContentValidator.js';
import { CanonicalDocumentModel } from './CanonicalDocumentModel.js';
import { SchemaFieldEditor } from './SchemaFieldEditor.js';

function fixture() {
  return {
    project: {
      title: '', count: 0, enabled: false, nullableValue: null,
      mode: 'a', targetId: 'S01',
      capabilities: [{ id: 'consumable', strategyId: 'heal' }],
      action: 'checkpoint.request', order: ['first', 'second'],
      asset: { assetId: 'asset.one', imageId: 'asset.one', unknownAllowed: { exact: 1.23456789 } },
      unknownAllowed: { nested: ['keep', null, false, 0, ''] }
    }
  };
}

function setup() {
  const registry = new ContentValidator();
  registry.registerSchema({
    id: 'editorFixture',
    fields: {
      title: { type: FieldType.STRING, required: true },
      count: { type: FieldType.NUMBER, required: true },
      enabled: { type: FieldType.BOOLEAN, required: true },
      nullableValue: { nullable: true },
      optionalMissing: { type: FieldType.STRING },
      mode: { type: FieldType.STRING, enum: ['a', 'b'] },
      targetId: { type: FieldType.STRING }, capabilities: { type: FieldType.ARRAY },
      action: { type: FieldType.STRING }, order: { type: FieldType.ARRAY, itemType: FieldType.STRING },
      asset: { type: FieldType.OBJECT }
    }
  });
  const model = new CanonicalDocumentModel({ sourceUri: 'example/game/game.project.json', schemaId: 'closure', canonical: fixture() });
  return { model, editor: new SchemaFieldEditor({ registry, documentModel: model, schemaId: 'editorFixture', rootPath: 'project' }) };
}

describe('SchemaFieldEditor', () => {
  it('从同一 runtime schema registry 生成全部控件语义并区分字段存在性和值', () => {
    const { editor } = setup();
    const root = editor.describe();
    const fields = Object.fromEntries(root.children.map(field => [field.name, field]));

    expect(root.control).toBe('object');
    expect(fields.order.control).toBe('array');
    expect(fields.mode.control).toBe('enum');
    expect(fields.targetId.control).toBe('ref');
    expect(fields.capabilities.control).toBe('capability');
    expect(fields.action.control).toBe('action');
    expect(fields.nullableValue.controls).toContain('nullable');
    expect(fields.optionalMissing.controls).toContain('optional');
    expect(fields.optionalMissing.present).toBe(false);
    expect(fields.title.value).toBe('');
    expect(fields.count.value).toBe(0);
    expect(fields.enabled.value).toBe(false);
    expect(fields.nullableValue.value).toBeNull();
  });

  it('path patch/undo 保留 unknown、精度、数组顺序与稳定资源身份', () => {
    const { model, editor } = setup();
    const beforeUnknown = model.getCandidate().project.unknownAllowed;
    editor.patch('count', 7.125);
    editor.move('order', 1, 0);
    editor.setStableAssetId('asset', 'asset.two');

    const candidate = model.getCandidate().project;
    expect(candidate.order).toEqual(['second', 'first']);
    expect(candidate.asset).toEqual({
      assetId: 'asset.two', imageId: 'asset.two', unknownAllowed: { exact: 1.23456789 }
    });
    expect(candidate.unknownAllowed).toEqual(beforeUnknown);
    expect(() => editor.patch('asset.assetId', 'broken')).toThrow(/assetId\/imageId/);
    expect(model.undo()).toBe(true);
    expect(model.getCandidate().project.asset.assetId).toBe('asset.one');
  });

  it('对多组 presence-sensitive JSON 值执行无编辑 round-trip 恒等检查', () => {
    const samples = [null, '', 0, false, [], {}, [0, false, '', null], { a: 0, b: false, c: '' }];
    for (const sample of samples) {
      const { model, editor } = setup();
      const original = model.getCandidate();
      const described = editor.describe();
      expect(described).toBeTruthy();
      expect(model.getCandidate()).toEqual(original);
      model.patch('project.unknownAllowed.sample', sample);
      model.undo();
      expect(model.getCandidate()).toEqual(original);
    }
  });
});
