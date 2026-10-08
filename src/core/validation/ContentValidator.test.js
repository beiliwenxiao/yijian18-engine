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

import { describe, it, expect, beforeEach } from 'vitest';
import { ContentValidator, FieldType } from './ContentValidator.js';
import { createContentValidator } from './ContentSchemas.js';
import { ValidationCode, formatErrors } from './ValidationError.js';

describe('ContentValidator JSON 解析', () => {
  let validator;

  beforeEach(() => {
    validator = createContentValidator();
  });

  it('合法 JSON 解析成功', () => {
    const result = validator.parseJson('{"id":"a"}');
    expect(result.ok).toBe(true);
    expect(result.value.id).toBe('a');
  });

  it('语法错误报告行列位置', () => {
    const text = '{\n  "id": "a",\n  "bad": \n}';
    const result = validator.parseJson(text);

    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe(ValidationCode.INVALID_JSON);
    expect(result.errors[0].line).toBeGreaterThan(0);
  });

  it('非字符串输入被拒绝', () => {
    expect(validator.parseJson(42).ok).toBe(false);
  });
});

describe('ContentValidator 字段校验', () => {
  let validator;

  beforeEach(() => {
    validator = new ContentValidator();
    validator.registerSchema({
      id: 'demo',
      fields: {
        id: { type: FieldType.STRING, required: true, minLength: 1 },
        count: { type: FieldType.INTEGER, min: 0, max: 10 },
        ratio: { type: FieldType.NUMBER, min: 0, max: 1 },
        flag: { type: FieldType.BOOLEAN },
        tags: { type: FieldType.ARRAY, itemType: FieldType.STRING, minItems: 1 },
        mode: { type: FieldType.STRING, enum: ['a', 'b'] },
        params: { type: FieldType.OBJECT, valueType: FieldType.NUMBER }
      }
    });
  });

  it('缺少必填字段报告路径', () => {
    const result = validator.validate({}, 'demo');
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe(ValidationCode.MISSING_FIELD);
    expect(result.errors[0].path).toBe('id');
  });

  it('类型不符报告期望与实际', () => {
    const result = validator.validate({ id: 'x', count: 'not a number' }, 'demo');
    const error = result.errors.find(e => e.path === 'count');
    expect(error.code).toBe(ValidationCode.TYPE_MISMATCH);
    expect(error.expected).toBe('integer');
    expect(error.actual).toBe('string');
  });

  it('数值越界报告约束', () => {
    const result = validator.validate({ id: 'x', count: 99 }, 'demo');
    const error = result.errors.find(e => e.path === 'count');
    expect(error.code).toBe(ValidationCode.OUT_OF_RANGE);
    expect(error.actual).toBe(99);
  });

  it('非整数被拒绝', () => {
    const result = validator.validate({ id: 'x', count: 1.5 }, 'demo');
    expect(result.errors.some(e => e.path === 'count')).toBe(true);
  });

  it('枚举值受限', () => {
    const result = validator.validate({ id: 'x', mode: 'c' }, 'demo');
    const error = result.errors.find(e => e.path === 'mode');
    expect(error.code).toBe(ValidationCode.OUT_OF_RANGE);
  });

  it('数组元素类型逐项定位', () => {
    const result = validator.validate({ id: 'x', tags: ['ok', 5] }, 'demo');
    expect(result.errors.some(e => e.path === 'tags[1]')).toBe(true);
  });

  it('对象值类型校验', () => {
    const result = validator.validate({ id: 'x', params: { a: 1, b: 'bad' } }, 'demo');
    expect(result.errors.some(e => e.path === 'params.b')).toBe(true);
  });

  it('未注册 Schema 报错', () => {
    expect(validator.validate({}, 'nope').errors[0].code).toBe(ValidationCode.INVALID_REFERENCE);
  });

  it('allowUnknown 为 false 时报告未知字段', () => {
    validator.registerSchema({
      id: 'strict',
      allowUnknown: false,
      fields: { id: { type: FieldType.STRING, required: true } }
    });

    const result = validator.validate({ id: 'x', extra: 1 }, 'strict');
    expect(result.errors[0].code).toBe(ValidationCode.UNKNOWN_FIELD);
  });

  it('列表校验发现重复 id', () => {
    const result = validator.validateList([{ id: 'a' }, { id: 'a' }], 'demo');
    expect(result.errors.some(e => e.code === ValidationCode.DUPLICATE_ID)).toBe(true);
  });

  it('版本高于支持范围时拒绝并说明范围', () => {
    const v = new ContentValidator({ supportedVersion: 2 });
    const result = v.validateVersion({ version: 5 });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe(ValidationCode.VERSION_UNSUPPORTED);
    expect(result.errors[0].message).toContain('1 至 2');
  });
});

describe('ContentValidator 候选加载与规范化', () => {
  let validator;

  beforeEach(() => {
    validator = createContentValidator();
  });

  it('校验通过时提交新值', () => {
    const current = { id: 'old', mode: 'classSkill' };
    const result = validator.loadCandidate(
      { id: 'new', mode: 'classSkill', nodes: [{ id: 'n' }] },
      'progressionGraph',
      current
    );

    expect(result.committed).toBe(true);
    expect(result.value.id).toBe('new');
  });

  it('校验失败时保留当前值', () => {
    const current = { id: 'old' };
    const result = validator.loadCandidate({ mode: 'classSkill', nodes: [] }, 'progressionGraph', current);

    expect(result.committed).toBe(false);
    expect(result.value).toBe(current);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('JSON 语法错误时保留当前值', () => {
    const current = { id: 'old' };
    const result = validator.loadCandidate('{ bad json', 'progressionGraph', current);

    expect(result.committed).toBe(false);
    expect(result.value).toBe(current);
    expect(result.errors[0].code).toBe(ValidationCode.INVALID_JSON);
  });

  it('规范化输出稳定，可往返', () => {
    const graph = {
      nodes: [{ id: 'n', maxRank: 1 }],
      mode: 'classSkill',
      id: 'g'
    };

    const first = validator.stringify(graph, 'progressionGraph');
    const parsed = JSON.parse(first);
    const second = validator.stringify(parsed, 'progressionGraph');

    expect(second).toBe(first);
    // Schema 字段顺序优先，id 排在 mode 之前
    expect(first.indexOf('"id"')).toBeLessThan(first.indexOf('"mode"'));
  });

  it('错误可格式化为可读文本', () => {
    const result = validator.validate({}, 'progressionGraph');
    const text = formatErrors(result.errors);
    expect(text).toContain('missingField');
    expect(text).toContain('id');
  });
});

describe('内置 Schema 跨字段规则', () => {
  let validator;

  beforeEach(() => {
    validator = createContentValidator();
  });

  it('技能定义校验通过', () => {
    const result = validator.validate({
      id: 'cleave',
      category: 'attack',
      targeting: 'direction',
      params: { damage: 30 },
      costs: { stamina: 10 }
    }, 'skill');
    expect(result.errors).toEqual([]);
  });

  it('技能非法 targeting 被拒绝', () => {
    const result = validator.validate({ id: 'x', targeting: 'weird' }, 'skill');
    expect(result.errors.some(e => e.path === 'targeting')).toBe(true);
  });

  it('图缺少 nodes 时报告', () => {
    const result = validator.validate({ id: 'g', mode: 'classSkill' }, 'progressionGraph');
    expect(result.errors.some(e => e.path === 'nodes')).toBe(true);
  });

  it('前置引用不存在时报告节点路径', () => {
    const result = validator.validate({
      id: 'g',
      mode: 'classSkill',
      nodes: [{ id: 'a', prerequisites: ['missing'] }]
    }, 'progressionGraph');

    const error = result.errors.find(e => e.code === ValidationCode.INVALID_REFERENCE);
    expect(error.path).toContain('nodes[0].prerequisites');
  });

  it('连线引用不存在的节点时报告', () => {
    const result = validator.validate({
      id: 'g',
      mode: 'passiveBoard',
      startNodes: ['a'],
      nodes: [{ id: 'a', kind: 'start' }],
      edges: [['a', 'ghost']]
    }, 'progressionGraph');

    expect(result.errors.some(e => e.path === 'edges[0]')).toBe(true);
  });

  it('天赋盘缺少起点时报告', () => {
    const result = validator.validate({
      id: 'g',
      mode: 'passiveBoard',
      nodes: [{ id: 'a', kind: 'minor' }]
    }, 'progressionGraph');

    expect(result.errors.some(e => e.path === 'startNodes')).toBe(true);
  });

  it('节点 id 重复时报告', () => {
    const result = validator.validate({
      id: 'g',
      mode: 'classSkill',
      nodes: [{ id: 'a' }, { id: 'a' }]
    }, 'progressionGraph');

    expect(result.errors.some(e => e.code === ValidationCode.DUPLICATE_ID)).toBe(true);
  });

  it('maxRank 小于 1 被拒绝', () => {
    const result = validator.validate({
      id: 'g',
      mode: 'classSkill',
      nodes: [{ id: 'a', maxRank: 0 }]
    }, 'progressionGraph');

    expect(result.errors.some(e => e.path.includes('maxRank'))).toBe(true);
  });

  it('primary 未在 enabled 中时报告', () => {
    const result = validator.validate({
      primary: 'passiveBoard',
      enabled: ['skillTree']
    }, 'progressionConfig');

    expect(result.errors[0].path).toBe('primary');
  });

  it('合法 progression 配置通过', () => {
    const result = validator.validate({
      profile: 'arpg',
      primary: 'talentTree',
      enabled: ['skillTree', 'talentTree', 'passiveBoard'],
      pointPools: { skill: 'independent' },
      unlock: { passiveBoard: 'milestone' },
      graphs: []
    }, 'progressionConfig');

    expect(result.errors).toEqual([]);
  });
});
