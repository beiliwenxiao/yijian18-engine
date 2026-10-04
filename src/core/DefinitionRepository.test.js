import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CanonicalSnapshot } from './CanonicalSnapshot.js';
import {
  DefinitionRepository,
  DefinitionRepositoryValidationError
} from './DefinitionRepository.js';
import { GameLoader } from './GameLoader.js';
import { Registry, createStandardRegistries } from './Registry.js';

function snapshot(project, revision = 1) {
  return CanonicalSnapshot.fromProject({ schemaVersion: 1, ...project }, { revision });
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

describe('CanonicalSnapshot 与 DefinitionRepository', () => {
  it('深冻结项目、参数和只读 kind/ID 索引', () => {
    const canonical = snapshot({
      capabilityCatalog: [{ id: 'consumable', parametersSchema: { fields: { amount: { type: 'number', required: true, min: 1 } } } }],
      strategyCatalog: [{ id: 'heal' }],
      library: {
        items: [{ id: 'potion', capabilities: [{ id: 'consumable', strategyId: 'heal', parameters: { amount: 10 } }] }]
      }
    }, 7);
    const repository = DefinitionRepository.fromSnapshot(canonical);
    const definition = repository.get('items', 'potion');

    expect(canonical.runtimeConfig.definitionRevision).toBe(7);
    expect(Object.isFrozen(canonical.project)).toBe(true);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.capabilities[0].parameters)).toBe(true);
    expect(repository.ids('items')).toEqual(['potion']);
    expect(repository.all('items')).toEqual([definition]);
    expect(() => { definition.capabilities[0].parameters.amount = 99; }).toThrow();
  });

  it('一次拒绝缺 ID、同 kind 重复、声明全局唯一的跨 kind 冲突、未知契约、非法参数和悬空引用', () => {
    const canonical = snapshot({
      definitionPolicy: { globalUniqueKinds: ['items'] },
      capabilityCatalog: [{ id: 'known', parametersSchema: { fields: { amount: { type: 'number', required: true, min: 1 } } } }],
      strategyCatalog: [{ id: 'known.strategy' }],
      library: {
        items: [
          { id: 'shared', capabilities: [{ id: 'missing', strategyId: 'missing.strategy', parameters: 1 }] },
          { id: 'shared' },
          { name: 'missing id' },
          { id: 'bad-params', capabilities: [{ id: 'known', parameters: { amount: 0 } }] }
        ],
        equipment: [{ id: 'shared' }],
        resourceNodes: [{ id: 'node', itemId: 'missing-item' }]
      }
    });

    let error;
    try { DefinitionRepository.fromSnapshot(canonical); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(DefinitionRepositoryValidationError);
    expect(error.errors.map(entry => entry.code)).toEqual(expect.arrayContaining([
      'missingField', 'duplicateId', 'invalidReference', 'typeMismatch', 'outOfRange'
    ]));
    expect(error.errors.some(entry => entry.message.includes('跨 kind 冲突'))).toBe(true);
    expect(error.errors.some(entry => entry.path.endsWith('itemId'))).toBe(true);
  });

  it('revision lock 保持命令开始时的 repository，新命令才看到新 revision', () => {
    const first = DefinitionRepository.fromSnapshot(snapshot({ library: { items: [{ id: 'old' }] } }, 1));
    const lock = first.lockRevision();
    const second = DefinitionRepository.fromSnapshot(snapshot({ library: { items: [{ id: 'new' }] } }, 2));

    expect(lock.definitionRevision).toBe(1);
    expect(lock.get('items', 'old')?.id).toBe('old');
    expect(lock.get('items', 'new')).toBeNull();
    expect(second.lockRevision().get('items', 'new')?.id).toBe('new');
  });

  it('兼容 Registry 只读委托 repository，序列化不复制完整定义', () => {
    const repository = DefinitionRepository.fromSnapshot(snapshot({ library: { items: [{ id: 'wood', value: 1 }] } }, 3));
    const registries = createStandardRegistries(repository);

    expect(registries.items.get('wood')).toEqual({ id: 'wood', value: 1 });
    expect(registries.items.has('wood')).toBe(true);
    expect(registries.items.serialize()).toEqual({ kind: 'items', definitionRevision: 3, ids: ['wood'] });
    expect(registries.items.serialize()).not.toHaveProperty('definitions');
    expect(() => registries.items.register({ id: 'other' })).toThrow(/read-only/);
    expect(() => new Registry('items').clear()).toThrow(/read-only/);
  });
});

describe('GameLoader immutable shadow publication', () => {
  it('合法 Demo（含任务中心 quests）一次发布，并保持 Registry 查询', () => {
    const loader = new GameLoader();
    const project = loadResolvedDemoProject();
    const result = loader.assemble(project);

    // 任务中心制：quests[] 为编译出的 taskGraph 定义，与工程 quests 声明顺序一一对应
    //（不硬编码任务清单：demo 工程内容随章节扩展持续增长）
    expect(result.quests.map(quest => quest.id)).toEqual(project.quests.map(quest => quest.id));
    expect(loader.lastSuccessfulSnapshot.project).toBe(loader.project);
    expect(loader.runtimeConfigSnapshot.definitionRevision).toBe(1);
    expect(loader.getRegistry('items').get('resource.wood')?.name).toBe('木材');
    // loader.project 是 FlowGroup 兼容归一化的运行时副本（可变）；不可变事实源在 snapshot：定义集合与运行配置深冻结
    expect(Object.isFrozen(loader.runtimeConfigSnapshot)).toBe(true);
    expect(Object.isFrozen(loader.lastSuccessfulSnapshot.definitions.items)).toBe(true);
  });

  it('失败候选和 consumer publish 故障均保留旧快照完整可运行', () => {
    const loader = new GameLoader();
    const project = loadResolvedDemoProject();
    loader.assemble(project);
    const before = {
      snapshot: loader.lastSuccessfulSnapshot,
      project: loader.project,
      repository: loader.definitionRepository,
      blackboard: loader.blackboard,
      triggerSystem: loader.triggerSystem,
      registries: loader.registries
    };

    const duplicate = structuredClone(project);
    duplicate.library.items.push({ ...duplicate.library.items[0] });
    expect(() => loader.assemble(duplicate)).toThrow(/工程内容校验失败/);
    expect(loader.lastSuccessfulSnapshot).toBe(before.snapshot);
    expect(loader.project).toBe(before.project);
    expect(loader.definitionRepository).toBe(before.repository);
    expect(loader.blackboard).toBe(before.blackboard);
    expect(loader.triggerSystem).toBe(before.triggerSystem);
    expect(loader.registries).toBe(before.registries);
    expect(loader.getRegistry('items').get('resource.wood')?.name).toBe('木材');

    const rollback = vi.fn();
    const world = {
      init() {},
      createCanonicalDraft: () => ({
        commit: () => { throw new Error('publish fault'); },
        rollback
      })
    };
    expect(() => loader.assemble(project, { world })).toThrow(/工程内容校验失败/);
    expect(rollback).toHaveBeenCalledOnce();
    expect(loader.lastSuccessfulSnapshot).toBe(before.snapshot);
    expect(loader.triggerSystem).toBe(before.triggerSystem);
  });

  it('reload 发布新 revision，但旧命令 lock 继续查询旧定义', () => {
    const loader = new GameLoader();
    const project = loadResolvedDemoProject();
    loader.assemble(project);
    const runningCommand = loader.lockDefinitionRevision();

    const changed = structuredClone(project);
    changed.library.items.push({ id: 'test.revision.item', name: 'revision item', type: 'material', maxStack: 1 });
    loader.assemble(changed);

    expect(runningCommand.definitionRevision).toBe(1);
    expect(runningCommand.get('items', 'test.revision.item')).toBeNull();
    expect(loader.lockDefinitionRevision().definitionRevision).toBe(2);
    expect(loader.getRegistry('items').get('test.revision.item')?.name).toBe('revision item');
  });
});
