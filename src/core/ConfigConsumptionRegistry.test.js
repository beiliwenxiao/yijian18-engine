import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CanonicalSnapshot } from './CanonicalSnapshot.js';
import {
  ConfigConsumptionRegistry,
  createStandardConfigConsumptionRegistry
} from './ConfigConsumptionRegistry.js';
import { GameLoader } from './GameLoader.js';
import { SceneCampfireService } from './scene/SceneCampfireService.js';

function loadJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(relativePath), 'utf8'));
}

function loadResolvedDemoProject() {
  const root = path.resolve('example/sanguo_zhangjiao');
  const resolveRefs = value => {
    if (Array.isArray(value)) return value.map(resolveRefs);
    if (!value || typeof value !== 'object') return value;
    if (typeof value.$ref === 'string') {
      return resolveRefs(loadJson(path.join(root, value.$ref)));
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveRefs(child)]));
  };
  const mainProject = loadJson(path.join(root, 'game.project.json'));
  // shards 分片：主文件声明的分片字段并回完整 project（$ref 解析前）
  const projectSource = { ...mainProject };
  for (const [shardField, shardPath] of Object.entries(mainProject.shards || {})) {
    projectSource[shardField] = loadJson(path.join(root, shardPath));
  }
  return resolveRefs(projectSource);
}

function minimalProject(extra = {}) {
  return {
    schemaVersion: 1,
    meta: { id: 'test', name: 'Test', version: 1, schema: 1, campaignId: 'test' },
    assetManifest: {}, presentation: {}, variables: { storyState: { month: 3 } },
    system: { weather: { default: 'clear', transitionSpeed: 0.5, particles: {} } },
    worldMap: { regions: [] }, scenes: [], dialogues: [], quests: [], triggers: [], tutorials: [],
    library: {}, integration: { battle: { resultSource: 'localMock', localMock: {} } },
    ...extra
  };
}

describe('ConfigConsumptionRegistry', () => {
  it('按 schema path 建立 descriptor、事件与状态投影', () => {
    const snapshot = CanonicalSnapshot.fromProject(minimalProject(), { revision: 4 });
    const consumed = createStandardConfigConsumptionRegistry().build(snapshot);
    const weather = consumed.getConsumer('runtime.weather');

    expect(weather.get('system.weather')).toEqual({ default: 'clear', transitionSpeed: 0.5, particles: {} });
    expect(weather.revision).toBe(4);
    expect(consumed.events.some(event => event.eventType === 'runtimeConfigConsumed'
      && event.projectionType === 'weatherState')).toBe(true);
    expect(consumed.status.every(entry => entry.consumed === true)).toBe(true);
  });

  it('拒绝未登记或无法证明消费的配置', () => {
    const snapshot = CanonicalSnapshot.fromProject(minimalProject({
      extensions: { unsupported: { value: 1 } },
      consumptionRequirements: { paths: ['extensions.unsupported.value'] }
    }));
    expect(() => createStandardConfigConsumptionRegistry().build(snapshot)).toThrow(/coverage error/);

    const unproven = new ConfigConsumptionRegistry().registerPath({
      id: 'bad', pathPattern: 'extensions.unsupported.*', consume: () => false
    });
    expect(() => unproven.build(snapshot)).toThrow(/coverage error/);
  });

  it('consumer view 只能读取已登记叶子及其祖先投影', () => {
    const snapshot = CanonicalSnapshot.fromProject(minimalProject());
    const registry = new ConfigConsumptionRegistry().registerPath({
      id: 'weather.default', pathPattern: 'system.weather.default', consume: value => ({ consumed: true, value })
    });
    const view = registry.build(snapshot).getConsumer('weather.default');

    expect(view.get('system.weather')).toEqual({ default: 'clear' });
    expect(view.get('system.weather.default')).toBe('clear');
    expect(view.get('system.weather.transitionSpeed', 'not-registered')).toBe('not-registered');
  });

  it('按 definitionKind+capabilityId+strategyId 解析通用 capability consumer', () => {
    const snapshot = CanonicalSnapshot.fromProject(minimalProject({
      capabilityCatalog: [{ id: 'consumable' }],
      strategyCatalog: [{ id: 'heal' }],
      library: {
        items: [{ id: 'potion', capabilities: [{ id: 'consumable', strategyId: 'heal', parameters: { amount: 5 } }] }]
      }
    }));
    const registry = new ConfigConsumptionRegistry().registerDefinition({
      id: 'item.capability', definitionKind: 'items', capabilityId: 'consumable', strategyId: 'heal',
      descriptor: { projectionType: 'itemCapability' },
      consume: value => ({ consumed: true, value: value.parameters.amount })
    });
    const consumed = registry.build(snapshot);
    expect(consumed.getConsumer('item.capability').entries()[0].projection).toBe(5);
  });

  it('definition consumer 仅拒绝相同 id 的精确重复 selector', () => {
    const consume = value => ({ consumed: true, value });
    const registry = new ConfigConsumptionRegistry()
      .registerDefinition({ id: 'capability', definitionKind: '*', capabilityId: '*', strategyId: '*', consume });

    expect(() => registry.registerDefinition({
      id: 'capability', definitionKind: 'items', capabilityId: 'consumable', strategyId: 'heal', consume
    })).not.toThrow();
    expect(() => registry.registerDefinition({
      id: 'capability', definitionKind: 'items', capabilityId: 'consumable', strategyId: 'heal', consume
    })).toThrow(/duplicateDefinitionConsumer/);
  });

  it('证明 Schema-aware 编辑覆盖的全部配置域都有 runtime consumer', () => {
    const project = {
      extensions: { endings: { rules: [{ id: 'dust' }] } },
      progression: { skills: { definitions: [{ id: 'skill.one' }] }, graphs: [{ id: 'classSkill' }] },
      battles: [{ battleId: 'battle.one' }], rescues: [{ id: 'rescue.one' }],
      presentation: { id: 'profile.one' }, construction: { maxOperations: 8 },
      library: {
        items: [{ id: 'item.one' }], equipment: [{ id: 'equipment.one' }],
        resourceNodes: [{ id: 'node.one' }], vehicles: [{ id: 'vehicle.one' }],
        skills: [{ id: 'skill.library' }]
      },
      tutorials: [{ id: 'tutorial.one' }], scenarios: [{ id: 'scenario.one' }],
      triggers: [{ id: 'trigger.one' }], dialogues: [{ id: 'dialogue.one' }]
    };
    const requirements = { paths: [
      'extensions.endings.**', 'progression.**', 'battles[*].**', 'rescues[*].**',
      'presentation.**', 'construction.**', 'library.items[*].**', 'library.equipment[*].**',
      'library.resourceNodes[*].**', 'library.vehicles[*].**', 'tutorials[*].**',
      'scenarios[*].**', 'triggers[*].**', 'dialogues[*].**'
    ] };
    const consumed = createStandardConfigConsumptionRegistry().buildSources({ project }, { requirements });
    const ids = new Set(consumed.listConsumers().map(consumer => consumer.id));
    expect([...ids]).toEqual(expect.arrayContaining([
      'runtime.endings', 'runtime.skills', 'runtime.progression', 'runtime.battle', 'runtime.rescue',
      'runtime.presentation', 'runtime.construction', 'runtime.items', 'runtime.equipment',
      'runtime.resourceNodes', 'runtime.vehicles', 'runtime.tutorial', 'runtime.scenario',
      'runtime.trigger', 'runtime.dialogue'
    ]));
    expect(consumed.status.every(entry => entry.consumed)).toBe(true);
  });

  it.each([
    ['clear', 0.5, 3],
    ['heavyRain', 0.25, 6],
    ['lightFog', 1, 11]
  ])('任意合法天气/月配置都原样进入只读 view (%s)', (weather, speed, month) => {
    const snapshot = CanonicalSnapshot.fromProject(minimalProject({
      variables: { storyState: { month } },
      system: { weather: { default: weather, transitionSpeed: speed, particles: {} } }
    }));
    const consumed = createStandardConfigConsumptionRegistry().build(snapshot);
    expect(consumed.getConsumer('runtime.weather').get('system.weather.default')).toBe(weather);
    expect(consumed.getConsumer('runtime.weather').get('system.weather.transitionSpeed')).toBe(speed);
    expect(consumed.getConsumer('runtime.month').get('variables.storyState.month')).toBe(month);
  });
});

describe('runtime consumption publication', () => {
  it('GameLoader reload 失败时保留旧 consumer 与 snapshot identity', () => {
    const loader = new GameLoader();
    const project = loadResolvedDemoProject();
    loader.assemble(project);
    const beforeSnapshot = loader.lastSuccessfulSnapshot;
    const beforeConsumption = loader.configConsumptionSnapshot;
    const beforeWeather = loader.getConfigConsumer('runtime.weather');

    const invalid = structuredClone(project);
    invalid.extensions.unconsumed = { value: 1 };
    invalid.consumptionRequirements = { paths: ['extensions.unconsumed.value'] };
    expect(() => loader.assemble(invalid)).toThrow(/工程内容校验失败/);
    expect(loader.lastSuccessfulSnapshot).toBe(beforeSnapshot);
    expect(loader.configConsumptionSnapshot).toBe(beforeConsumption);
    expect(loader.getConfigConsumer('runtime.weather')).toBe(beforeWeather);
  });

  it('天气配置 reload 校验失败时保留旧 consumer 与 snapshot identity', () => {
    const loader = new GameLoader();
    const project = loadResolvedDemoProject();
    loader.assemble(project);
    const beforeSnapshot = loader.lastSuccessfulSnapshot;
    const beforeConsumption = loader.configConsumptionSnapshot;
    const beforeWeather = loader.getConfigConsumer('runtime.weather');

    const invalid = structuredClone(project);
    invalid.system.weather.transitionSpeed = null;
    expect(() => loader.assemble(invalid)).toThrow(/工程内容校验失败/);
    expect(loader.lastValidationErrors.some(error => error.path === 'system.weather.transitionSpeed')).toBe(true);
    expect(loader.lastSuccessfulSnapshot).toBe(beforeSnapshot);
    expect(loader.configConsumptionSnapshot).toBe(beforeConsumption);
    expect(loader.getConfigConsumer('runtime.weather')).toBe(beforeWeather);
  });

  it('scene gameplay consumer 驱动火堆表现且不持有可变配置', () => {
    // 火堆表现已收编进 library 定义 story.s01.campfire.campfirePresentation，场景 gameplay 不再内联配置
    const library = loadJson('example/sanguo_zhangjiao/project/library.json');
    const campfireItem = (library.items || []).find(item => item.id === 'story.s01.campfire');
    const scene = { gameplay: { campfire: campfireItem.campfirePresentation } };
    const registry = createStandardConfigConsumptionRegistry();
    const consumption = registry.buildSources({ scene }, {
      revision: 2,
      requirements: { paths: [{ pathPattern: 'scene.gameplay.campfire.**', required: true }] }
    });
    const view = consumption.getConsumer('scene.gameplay');
    const service = new SceneCampfireService({ configView: view });

    expect(service.isConfigured()).toBe(true);
    // frameCount=12 来自火苗贴图帧解析（非策划配置）；lightRadius 从 library 读取而不是
    // 硬编码——这里是验证「配置→消费」链路，策划调优（58a2ab7 把 300→260）不应让测试失效。
    expect(service.campfire.frameCount).toBe(12);
    expect(service.presentation.lightRadius).toBe(campfireItem.campfirePresentation.presentation.lightRadius);
    expect(Object.isFrozen(service.configView)).toBe(true);
    expect(() => { service.configView.sprite.frameCount = 2; }).toThrow();
  });
});
