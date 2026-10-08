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

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SANGUO_ZHANGJIAO_CONTENT_POLICY } from '../../../example/sanguo_zhangjiao/config/SanguoZhangjiaoContentPolicy.js';
import { ContentValidator, FieldType } from './ContentValidator.js';
import { createContentValidator } from './ContentSchemas.js';
import { CandidateRuleValidator } from './CandidateRuleValidator.js';
import { CanonicalCandidatePipeline } from './CanonicalCandidatePipeline.js';
import { ContentErrorCategory, ContentPhase } from './ContentOperationResult.js';

function createTestValidator() {
  const validator = new ContentValidator({ supportedVersion: 2 });
  validator.registerSchema({
    id: 'pipelineChild',
    fields: {
      id: { type: FieldType.STRING, required: true },
      enabled: { type: FieldType.BOOLEAN, default: false }
    }
  });
  validator.registerSchema({
    id: 'pipelineRoot',
    fields: {
      schemaVersion: { type: FieldType.INTEGER, required: true, min: 1, max: 2 },
      count: { type: FieldType.INTEGER, default: 3, min: 0 },
      optionalText: { type: FieldType.STRING },
      nullableText: { type: FieldType.STRING, nullable: true },
      entries: { type: FieldType.ARRAY, required: true, itemSchema: 'pipelineChild' }
    }
  });
  return validator;
}

function createPipeline({ businessRuleValidators = [] } = {}) {
  const contentValidator = createTestValidator();
  return new CanonicalCandidatePipeline({
    contentValidator,
    ruleValidator: new CandidateRuleValidator({ contentValidator, businessRuleValidators })
  });
}

function loadResolvedDemoProject() {
  const root = path.resolve('example/sanguo_zhangjiao');
  const resolveRefs = value => {
    if (Array.isArray(value)) return value.map(resolveRefs);
    if (!value || typeof value !== 'object') return value;
    if (typeof value.$ref === 'string') {
      return resolveRefs(JSON.parse(fs.readFileSync(path.join(root, value.$ref), 'utf8')));
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveRefs(child)]));
  };
  const mainProject = JSON.parse(fs.readFileSync(path.join(root, 'game.project.json'), 'utf8'));
  // shards 分片：主文件声明的分片字段并回完整 project（$ref 解析前）
  const projectSource = { ...mainProject };
  for (const [shardField, shardPath] of Object.entries(mainProject.shards || {})) {
    projectSource[shardField] = JSON.parse(fs.readFileSync(path.join(root, shardPath), 'utf8'));
  }
  return resolveRefs(projectSource);
}

describe('CanonicalCandidatePipeline', () => {
  it('严格按阶段执行，只为真正缺失字段克隆并应用 default', () => {
    const pipeline = createPipeline();
    const input = {
      schemaVersion: 1,
      entries: [{ id: 'first' }],
      unknownLegal: { keep: true },
      ordered: ['b', 'a']
    };
    const before = structuredClone(input);
    const trace = [];

    const result = pipeline.process(input, {
      schemaId: 'pipelineRoot',
      source: 'memory://candidate.json',
      trace: event => trace.push(event)
    });

    expect(result.ok).toBe(true);
    expect(result.value.count).toBe(3);
    expect(result.value.entries[0].enabled).toBe(false);
    expect(result.value.unknownLegal).toEqual({ keep: true });
    expect(result.value.ordered).toEqual(['b', 'a']);
    expect(input).toEqual(before);
    expect(trace.filter(event => event.status === 'start').map(event => event.phase)).toEqual([
      ContentPhase.READ,
      ContentPhase.PARSE,
      ContentPhase.DEFAULTS,
      ContentPhase.SCHEMA,
      ContentPhase.REFERENCE,
      ContentPhase.BUSINESS_RULE,
      ContentPhase.CANONICALIZE
    ]);
  });

  it('显式 null 和 undefined 不当作缺失，也不被 default 覆盖', () => {
    const pipeline = createPipeline();
    const lastGood = { schemaVersion: 1, count: 7, entries: [] };

    for (const value of [null, undefined]) {
      const candidate = { schemaVersion: 1, count: value, entries: [] };
      const result = pipeline.process(candidate, {
        schemaId: 'pipelineRoot',
        source: 'memory://null-or-undefined.json',
        lastSuccessfulValue: lastGood
      });
      expect(result.ok).toBe(false);
      expect(result.value).toBe(lastGood);
      expect(result.errors.some(error => error.path === 'count' && error.code === 'typeMismatch')).toBe(true);
      expect(candidate).toHaveProperty('count', value);
    }

    const nullable = pipeline.process({
      schemaVersion: 1,
      entries: [],
      nullableText: null
    }, { schemaId: 'pipelineRoot' });
    expect(nullable.ok).toBe(true);
    expect(nullable.value).toHaveProperty('nullableText', null);
  });

  it('一次收集 schema、reference 和 businessRule 的独立根路径错误', () => {
    const contentValidator = createTestValidator();
    const pipeline = new CanonicalCandidatePipeline({
      contentValidator,
      ruleValidator: {
        validateSchema: () => [{ code: 'typeMismatch', path: 'entries[0].id', message: 'schema' }],
        validateReferences: () => [{ code: 'invalidReference', path: 'entries[1].ref', message: 'reference' }],
        validateBusinessRules: () => [{ code: 'invalidRule', path: 'entries[2].limit', message: 'business' }]
      }
    });

    const result = pipeline.process({ entries: [] }, {
      schemaId: 'pipelineRoot',
      source: 'memory://all-errors.json',
      lastSuccessfulValue: { stable: true }
    });

    expect(result.ok).toBe(false);
    expect(result.errors.map(error => [error.phase, error.path])).toEqual([
      [ContentPhase.SCHEMA, 'entries[0].id'],
      [ContentPhase.REFERENCE, 'entries[1].ref'],
      [ContentPhase.BUSINESS_RULE, 'entries[2].limit']
    ]);
    expect(result.errors.every(error => error.source === 'memory://all-errors.json')).toBe(true);
    expect(result.errors.every(error => error.fallback === false)).toBe(true);
  });

  it('解析失败统一返回 phase/source/category/path/line/column/fallback 并保留旧状态', () => {
    const pipeline = createPipeline();
    const lastGood = { stable: true };
    const result = pipeline.process('{\n  "schemaVersion": 1,\n  "entries": [\n}', {
      schemaId: 'pipelineRoot',
      source: 'disk://game.project.json',
      lastSuccessfulValue: lastGood
    });

    expect(result).toMatchObject({
      ok: false,
      value: lastGood,
      phase: ContentPhase.PARSE,
      source: 'disk://game.project.json',
      category: ContentErrorCategory.PARSE_FAILED,
      path: '',
      fallback: false,
      canonical: false,
      saveable: false
    });
    expect(result.line).toBeGreaterThan(0);
    expect(result.errors[0]).toMatchObject({
      phase: ContentPhase.PARSE,
      source: 'disk://game.project.json',
      category: ContentErrorCategory.PARSE_FAILED,
      path: '',
      fallback: false
    });
  });

  it('区分缺失与不可读来源，且空白模板不可保存、无项目内容', () => {
    const pipeline = createPipeline();
    const missing = pipeline.process(null, { schemaId: 'pipelineRoot', source: 'disk://missing.json' });
    const unreadable = pipeline.process('ignored', {
      schemaId: 'pipelineRoot',
      source: 'disk://denied.json',
      reader: () => { throw new Error('permission denied'); }
    });

    expect(missing.category).toBe(ContentErrorCategory.MISSING);
    expect(unreadable.category).toBe(ContentErrorCategory.UNREADABLE);
    expect(pipeline.createBlankTemplate('pipelineRoot')).toMatchObject({
      schemaId: 'pipelineRoot',
      canonical: false,
      saveable: false,
      hasProjectContent: false,
      value: null
    });
  });

  it('canonicalize 是纯函数、幂等并保留数组顺序、字段存在性和未知合法字段', () => {
    const pipeline = createPipeline();
    const input = {
      unknownZ: 1,
      schemaVersion: 1,
      entries: [{ extra: { z: 1, a: 2 }, id: 'x', enabled: false }],
      unknownA: { present: false },
      nullableText: null
    };
    const before = structuredClone(input);
    const first = pipeline.process(input, { schemaId: 'pipelineRoot' });
    const second = pipeline.process(first.value, { schemaId: 'pipelineRoot' });

    expect(first.ok).toBe(true);
    expect(second.value).toEqual(first.value);
    expect(input).toEqual(before);
    expect(first.value.entries.map(entry => entry.id)).toEqual(['x']);
    expect(first.value).toHaveProperty('nullableText', null);
    expect(first.value).toHaveProperty('unknownA.present', false);
    expect(first.value).toHaveProperty('unknownZ', 1);
  });

  it('继续执行注入的旧内容策略并把拒绝归入 businessRule', () => {
    const pipeline = createPipeline({
      businessRuleValidators: [candidate => candidate.campaign === 'canonical'
        ? { ok: true, errors: [] }
        : { ok: false, errors: [{ code: 'legacyContent', path: 'campaign', message: '旧 campaign 已拒绝' }] }]
    });
    const valid = pipeline.process({ schemaVersion: 1, entries: [], campaign: 'canonical' }, { schemaId: 'pipelineRoot' });
    const legacy = pipeline.process({ schemaVersion: 1, entries: [], campaign: 'legacy-six-act' }, { schemaId: 'pipelineRoot' });

    expect(valid.ok).toBe(true);
    expect(valid.value.campaign).toBe('canonical');
    expect(legacy.ok).toBe(false);
    expect(legacy.errors).toContainEqual(expect.objectContaining({
      code: 'legacyContent',
      path: 'campaign',
      phase: ContentPhase.BUSINESS_RULE,
      category: ContentErrorCategory.BUSINESS_RULE_FAILED
    }));
  });
});

describe('CandidateRuleValidator 完整候选约束', () => {
  it('同时报告数组重复、跨文档引用及 capability/action/command/scenario/quest 约束', () => {
    const validator = new CandidateRuleValidator({ contentValidator: createTestValidator() });
    const candidate = {
      scenes: [{ id: 'S01' }, { id: 'S01' }],
      dialogues: [{ id: 'dialogue.valid' }],
      quests: [{
        id: 'quest.one',
        objectives: [{ id: 'objective.same' }, { id: 'objective.same' }],
        prerequisites: ['quest.missing'],
        triggerRefs: ['trigger.missing'],
        dialogueRefs: ['dialogue.missing'],
        stateRevision: 1
      }],
      triggers: [{
        id: 'trigger.one',
        when: { type: 'timer', params: { seconds: 0 } },
        do: [{ action: 'action.missing', commandType: 'command.missing', params: null }]
      }],
      tutorials: [{
        id: 'tutorial.one', title: '教学', category: 'test', order: 0,
        steps: [{ text: '提示' }], completionPolicy: 'manual'
      }],
      triggerCatalog: { actions: [{ value: 'action.known' }] },
      commands: [{ id: 'command.known', modulePath: './unsafe.js' }],
      scenarios: [{ id: 'scenario.one', triggerRefs: ['trigger.missing'], commandRefs: ['command.missing'], actions: [] }],
      capabilityCatalog: ['known'],
      strategyCatalog: ['strategy.known'],
      library: {
        items: [{
          id: 'item.one',
          type: 'tool',
          toolType: 'axe',
          capabilities: [
            { id: 'unknown', strategyId: 'strategy.missing', requires: ['missing'], parameters: 1 },
            { id: 'unknown' }
          ]
        }],
        resourceNodes: [{ id: 'node.one', itemId: 'item.missing', requiredToolType: 'pickaxe' }]
      }
    };

    const referencePaths = validator.validateReferences(candidate).map(error => error.path);
    const businessPaths = validator.validateBusinessRules(candidate).map(error => error.path);

    expect(referencePaths).toEqual(expect.arrayContaining([
      'scenes[1].id',
      'quests[0].prerequisites[0]',
      'quests[0].triggerRefs[0]',
      'quests[0].dialogueRefs[0]',
      'scenarios[0].commandRefs[0]',
      'triggers[0].do[0].action',
      'triggers[0].do[0].commandType',
      'library.resourceNodes[0].itemId',
      'library.resourceNodes[0].requiredToolType',
      'library.items[0].capabilities[0].id',
      'library.items[0].capabilities[0].strategyId'
    ]));
    expect(businessPaths).toEqual(expect.arrayContaining([
      'triggers[0].when.params.seconds',
      'triggers[0].do[0].params',
      'quests[0].objectives[1].id',
      'quests[0].stateRevision',
      'scenarios[0]',
      'commands[0].modulePath',
      'library.items[0].capabilities[0].requires[0]',
      'library.items[0].capabilities[0].parameters',
      'library.items[0].capabilities[1]'
    ]));
    expect(referencePaths.some(path => path.startsWith('tutorials[0].do'))).toBe(false);
    expect(businessPaths.some(path => path.startsWith('tutorials[0].when'))).toBe(false);
  });
});

describe('CanonicalCandidatePipeline Demo preservation', () => {
  it('接受当前 schemaVersion/meta/campaign，并继续拒绝旧 campaign、场景和职业', () => {
    const contentValidator = createContentValidator();
    const pipeline = new CanonicalCandidatePipeline({
      contentValidator,
      ruleValidator: new CandidateRuleValidator({
        contentValidator,
        businessRuleValidators: [SANGUO_ZHANGJIAO_CONTENT_POLICY.validateProject]
      })
    });
    const project = loadResolvedDemoProject();
    const valid = pipeline.process(project, {
      schemaId: 'gameProject',
      source: 'example/sanguo_zhangjiao/game.project.json'
    });

    expect(valid.ok, valid.errors.map(error => `${error.phase}:${error.path}:${error.message}`).join('\n')).toBe(true);
    expect(valid.value.schemaVersion).toBe(1);
    expect(valid.value.meta).toMatchObject({
      version: 3,
      schema: 3,
      campaignId: 'sanguo-zhangjiao-s01-s14'
    });

    const legacy = structuredClone(project);
    legacy.meta.campaignId = 'legacy-six-act';
    legacy.variables.storyState.currentSceneId = 'scene_Prologue';
    legacy.variables.classId = 'mage';
    const rejected = pipeline.process(legacy, { schemaId: 'gameProject', lastSuccessfulValue: valid.value });
    expect(rejected.ok).toBe(false);
    expect(rejected.value).toBe(valid.value);
    expect(rejected.errors.filter(error => error.code === 'legacyContent').length).toBeGreaterThanOrEqual(2);
    expect(rejected.errors.some(error => error.code === 'invalidCampaign')).toBe(true);
  });
});
