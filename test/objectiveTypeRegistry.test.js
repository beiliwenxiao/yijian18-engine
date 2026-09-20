import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getObjectiveTypes,
  getObjectiveTypeDescriptor,
  objectiveTypeOptions,
  buildEventMatcher,
  matchObjectiveType,
  progressFieldFor,
  normalizeObjectiveTypeDefinition,
  validateObjectiveTypeDefinition
} from '../src/systems/quest/ObjectiveTypeRegistry.js';
import { getTriggerEventDescriptor } from '../src/systems/TriggerCatalog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const project = readJson('example/sanguo_zhangjiao/game.project.json');

describe('ObjectiveTypeRegistry 目标类型注册目录', () => {
  it('内置目录首批登记四类：gather.item / kill.enemy / commit.fact / custom.event', () => {
    const types = getObjectiveTypes();
    expect(types.map(item => item.type)).toEqual(['gather.item', 'kill.enemy', 'commit.fact', 'custom.event']);
    expect(getObjectiveTypeDescriptor('gather.item').progressBy).toBe('accepted');
    expect(getObjectiveTypeDescriptor('kill.enemy').progressBy).toBeNull();
    expect(getObjectiveTypeDescriptor('kill.enemy').factHint).toBeInstanceOf(RegExp);
  });

  it('buildEventMatcher：身份字段写入 payload，空值剔除，extraPayload 合并', () => {
    const descriptor = getObjectiveTypeDescriptor('gather.item');
    expect(buildEventMatcher(descriptor, { itemId: 'resource.wood' }, { resourceType: 'wood' })).toEqual({
      type: 'gathering.completed',
      payload: { resourceType: 'wood', itemId: 'resource.wood' }
    });
    expect(buildEventMatcher(descriptor, { itemId: '' }, { resourceType: 'wood' })).toEqual({
      type: 'gathering.completed',
      payload: { resourceType: 'wood' }
    });
    expect(buildEventMatcher(descriptor, {}, {})).toEqual({ type: 'gathering.completed', payload: {} });
  });

  it('matchObjectiveType：真实 S01 gatherWood 数据反推为 gather.item 并保留 resourceType 附加限定', () => {
    const node = project.taskGraphs
      .find(entry => entry.id === 'task.s01.survival')
      .nodes.find(entry => entry.id === 'gatherWood');
    const resolved = matchObjectiveType(node.eventMatcher, project);
    expect(resolved.type).toBe('gather.item');
    expect(resolved.identityValues.itemId).toBe('resource.wood');
    expect(resolved.extraPayload).toEqual({ resourceType: 'wood' });
  });

  it('matchObjectiveType：击杀事实（definitionId 含 kill）反推为 kill.enemy，其余 state.transaction 反推为 commit.fact', () => {
    const killed = matchObjectiveType({ type: 'state.transaction', payload: { definitionId: 'story.s01.firstWolfKilled' } }, project);
    expect(killed.type).toBe('kill.enemy');
    expect(killed.identityValues.definitionId).toBe('story.s01.firstWolfKilled');

    const fact = matchObjectiveType({ type: 'state.transaction', payload: { definitionId: 'story.s01.refuelCampfire' } }, project);
    expect(fact.type).toBe('commit.fact');
  });

  it('matchObjectiveType：目录未登记的事件回退 custom.event 且 payload 全量保留', () => {
    const resolved = matchObjectiveType({ type: 'sceneEnter', payload: { sceneId: 'S01' } }, project);
    expect(resolved.type).toBe('custom.event');
    expect(resolved.extraPayload).toEqual({ sceneId: 'S01' });
    expect(resolved.identityValues).toEqual({});
  });

  it('项目扩展 questCatalog.objectiveTypes 可覆盖内置条目并新增类型', () => {
    const extended = {
      questCatalog: {
        objectiveTypes: [
          { type: 'gather.item', label: '采集资源' },
          { type: 'escort.npc', label: '护送NPC', matcherType: 'escort.arrived', identityFields: [{ name: 'npcId', label: 'NPC', source: 'free' }], progressBy: null }
        ]
      }
    };
    expect(getObjectiveTypeDescriptor('gather.item', extended).label).toBe('采集资源');
    expect(getObjectiveTypeDescriptor('gather.item', extended).matcherType).toBe('gathering.completed');
    expect(objectiveTypeOptions(extended).some(option => option.value === 'escort.npc')).toBe(true);

    const resolved = matchObjectiveType({ type: 'escort.arrived', payload: { npcId: 'npc-1' } }, extended);
    expect(resolved.type).toBe('escort.npc');
  });

  it('progressFieldFor：节点显式 progressBy 优先于目录默认', () => {
    const descriptor = getObjectiveTypeDescriptor('gather.item');
    expect(progressFieldFor({ progressBy: 'amount' }, descriptor)).toBe('amount');
    expect(progressFieldFor({}, descriptor)).toBe('accepted');
    expect(progressFieldFor({}, getObjectiveTypeDescriptor('commit.fact'))).toBeNull();
  });

  it('validateObjectiveTypeDefinition：缺失关键字段报错，custom.event 允许空 matcherType', () => {
    expect(validateObjectiveTypeDefinition({ label: '无类型' }).length).toBeGreaterThan(0);
    expect(validateObjectiveTypeDefinition({ type: 'a.b', label: '' }).length).toBeGreaterThan(0);
    expect(validateObjectiveTypeDefinition({ type: 'a.b', label: 'x' }).length).toBeGreaterThan(0);
    expect(validateObjectiveTypeDefinition({ type: 'custom.event', label: '自定义事件', matcherType: '' })).toEqual([]);
    expect(validateObjectiveTypeDefinition({
      type: 'a.b', label: '合法', matcherType: 'some.event',
      identityFields: [{ name: 'id', label: 'ID' }], progressBy: null, defaultCount: 1
    })).toEqual([]);
  });

  it('normalizeObjectiveTypeDefinition：补齐缺省字段并过滤非法身份字段', () => {
    const normalized = normalizeObjectiveTypeDefinition({ type: 'a.b', label: '测试', matcherType: 'x.y', identityFields: [{ name: '', label: '' }, { name: 'id', label: 'ID' }] });
    expect(normalized.identityFields).toEqual([{ name: 'id', label: 'ID' }]);
    expect(normalized.progressBy).toBeNull();
    expect(normalizeObjectiveTypeDefinition({})).toBeNull();
  });

  it('事件目录契约：gathering.completed / state.transaction / enemy.killed 已入引擎级事件目录（P3 修复）', () => {
    for (const type of ['gathering.completed', 'state.transaction', 'enemy.killed']) {
      const descriptor = getTriggerEventDescriptor(type, null);
      expect(descriptor, `${type} 应无需项目级登记即可见`).not.toBeNull();
      expect(descriptor.paramsSchema).toBeTruthy();
      expect(Array.isArray(descriptor.identityFields)).toBe(true);
    }
    expect(getTriggerEventDescriptor('state.transaction').source).toBe('CanonicalStateTransactionService');
  });

  it('真实项目冒烟：task.s01.survival 全部 objective 节点均可由目录解析（无未登记事件）', () => {
    const graph = project.taskGraphs.find(entry => entry.id === 'task.s01.survival');
    const objectives = graph.nodes.filter(node => node.type === 'objective');
    expect(objectives.length).toBeGreaterThan(0);
    for (const node of objectives) {
      const resolved = matchObjectiveType(node.eventMatcher, project);
      expect(resolved.descriptor, `${node.id} 应命中目录`).not.toBeNull();
    }
    const killWolf = objectives.find(node => node.id === 'killWolf');
    expect(matchObjectiveType(killWolf.eventMatcher, project).type).toBe('kill.enemy');
  });
});
