import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SnapshotManager } from '../src/core/snapshot/SnapshotManager.js';
import { SaveGameService } from '../src/core/snapshot/SaveGameService.js';
import { LocalStorageAdapter } from '../src/core/snapshot/LocalStorageAdapter.js';
import { SDD_SCHEMA_VERSION, projectSddToSnapshot, sddSemanticEquals } from '../src/core/snapshot/SddProjection.js';
import { createRuntimeDocumentProjector, createSddSnapshotTransformer } from '../src/core/snapshot/SddSaveWiring.js';
import { getPlacementSignature } from '../src/core/scene/ScenePlacementRuntime.js';
import { SceneTriggerBindingSystem } from '../src/core/scene/SceneTriggerBindingSystem.js';
import { SanguoSceneStateFlow } from '../example/sanguo_zhangjiao/systems/SanguoSceneStateFlow.js';
import { QuestTransactionService } from '../src/systems/QuestTransactionService.js';
import { QuestRuntimeState } from '../src/systems/QuestRuntimeState.js';
import { GameLoader } from '../src/core/GameLoader.js';

/**
 * 存档/任务链路回归（2026-10 存档系统缺陷修复的永久钉子）。
 * 四个缺陷与共同病根（读写权分散、跨层语义丢失）：
 * - rollbackUnavailable：回滚快照采集被持久化守卫误伤 → meta 必须逐跳透传
 * - 读档被拒：位置守卫误伤回滚采集 → rollback label 豁免
 * - 再次读档狼复活：派生 id tombstone 在流式存档采集时被丢弃
 * - 诊断失明：rollbackUnavailable 必须携带 capture.errors 明细
 * 任何一条失败说明对应语义又在某一跳被丢了。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`${signature} not found`);
  let depth = 0;
  let end = -1;
  for (let index = start + signature.length - 1; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) { end = index + 1; break; }
  }
  if (end < 0) throw new Error(`${signature} is incomplete`);
  return source.slice(start, end);
}

class MemoryStorage extends LocalStorageAdapter {
  constructor() {
    super({ prefix: 'diag', storage: (() => {
      const map = new Map();
      return {
        getItem: k => map.has(k) ? map.get(k) : null,
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: k => map.delete(k),
        key: i => [...map.keys()][i] ?? null,
        get length() { return map.size; }
      };
    })() });
  }
}

function makeService() {
  return new SaveGameService({ gameId: 'diag', useIndexedDB: false, storage: new MemoryStorage() });
}

/** 直接从 SanguoWorldRuntimeCoordinator 源码提取 resolveChunkPlacement + captureStreamedChunkState。 */
function loadCaptureStreamedChunkState() {
  const source = read('example/sanguo_zhangjiao/systems/SanguoWorldRuntimeCoordinator.js');
  const helper = extractFunction(source, 'function resolveChunkPlacement(placementById, id) {');
  const capture = extractFunction(source, 'function captureStreamedChunkState(chunk) {');
  const factory = new Function('getPlacementSignature', 'cloneData',
    `const resolveChunkPlacement = ${helper};\nreturn { ${capture.replace('function captureStreamedChunkState', 'captureStreamedChunkState')} };`);
  const impl = factory(getPlacementSignature, value => value == null ? value : JSON.parse(JSON.stringify(value)));
  return (fakeThis, chunk) => Reflect.apply(impl.captureStreamedChunkState, fakeThis, [chunk]);
}

function makeStreamedChunkHost({ pendingPlacementStates = [], pendingResourceNodes = [], entities = [] } = {}) {
  return {
    entities,
    pickupItems: [],
    equipmentItems: [],
    playerEntity: null,
    aiSystem: null,
    _isEntityDead: () => false,
    _pendingChunkDomainStates: new Map(),
    _deathDrops: { capture: () => [] },
    s10ConstructionCoordinator: { _captureS10StructureStates: () => [] },
    _captureSceneVehicleStates: () => [],
    context: {
      services: {
        placements: {
          getPendingStateSnapshot: () => ({
            resourceNodes: pendingResourceNodes,
            placementStates: pendingPlacementStates
          })
        },
        corpses: { capture: () => null }
      }
    }
  };
}

function makeStreamedChunk({ placements = [{ id: 'S01-first-wolf', kind: 'enemy', sceneId: 'S01' }] } = {}) {
  return {
    key: 'S01',
    sceneNamespace: 'S01',
    origin: { x: 7680, y: 3600 },
    worldWidth: 1280,
    worldHeight: 720,
    placements
  };
}

describe('存档回归：SDD 双写（双写不双读，阶段 1c）', () => {
  function makeGamePayload() {
    return {
      player: { id: 'player-1', hp: 12 },
      currentSceneId: 'S01',
      authority: {
        snapshotSchemaVersion: 2,
        logicalClock: { logical: 12.5 },
        serviceStates: {
          quests: { schemaVersion: 2, taskGraph: { nodes: {} }, actors: [] },
          campaignContent: { blackboard: { storyState: { currentSceneId: 'S01' } }, triggers: { version: 1, records: [] } }
        }
      },
      scene: { campfireLit: true }
    };
  }

  it('注入 documentProjector：saveAsync 产出的快照携带 snapshot.sdd（schemaVersion=3 + 等价文档）', async () => {
    const service = makeService();
    service.setStateProvider({ capture: () => makeGamePayload(), restore: () => ({ ok: true }) });
    const projectorCalls = [];
    const baseProjector = createRuntimeDocumentProjector(() => null);
    service.manager.documentProjector = snapshot => {
      projectorCalls.push(snapshot);
      return baseProjector(snapshot);
    };
    const saved = await service.saveAsync(1);
    expect(saved.ok).toBe(true);
    expect(projectorCalls.length).toBeGreaterThanOrEqual(1);
    expect(saved.snapshot.sdd.schemaVersion).toBe(SDD_SCHEMA_VERSION);
    expect(saved.snapshot.sdd.document.quests.schemaVersion).toBe(2);
    // 双写等价：SDD 逆投影 ≡ 旧 data.game（语义深相等）
    const roundtrip = projectSddToSnapshot(saved.snapshot.sdd.document);
    expect(sddSemanticEquals(roundtrip, saved.snapshot.data.game)).toBe(true);
    if (!sddSemanticEquals(roundtrip, saved.snapshot.data.game)) {
      console.log('v1:', JSON.stringify(saved.snapshot.data.game));
      console.log('rt:', JSON.stringify(roundtrip));
    }
  });

  it('未注入 documentProjector：快照不带 sdd 字段（引擎默认零侵入）', async () => {
    const service = makeService();
    service.setStateProvider({ capture: () => makeGamePayload(), restore: () => ({ ok: true }) });
    const saved = await service.saveAsync(1);
    expect(saved.ok).toBe(true);
    expect(saved.snapshot.sdd).toBeUndefined();
  });

  it('投影抛错：saveAsync 仍成功、sdd 缺失、只告警（投影失败不阻断产品存档）', async () => {
    const service = makeService();
    service.setStateProvider({ capture: () => makeGamePayload(), restore: () => ({ ok: true }) });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    service.manager.documentProjector = () => { throw new Error('projector boom'); };
    const saved = await service.saveAsync(1);
    expect(saved.ok).toBe(true);
    expect(saved.snapshot.sdd).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('读档链不消费 sdd 字段：带 sdd 的快照 load 行为与不带一致', async () => {
    const service = makeService();
    const restored = [];
    service.setStateProvider({
      capture: () => makeGamePayload(),
      restore: data => { restored.push(data); return { ok: true }; }
    });
    await service.saveAsync(1);
    service.manager.documentProjector = createRuntimeDocumentProjector(() => null);
    const loaded = await service.loadAsync(1);
    expect(loaded.ok).toBe(true);
    expect(restored[0]).toEqual(makeGamePayload());
  });
});

describe('存档回归：capture meta 逐跳透传（rollbackUnavailable 修复）', () => {
  it('SnapshotManager.capture 把 meta 传给 provider.snapshot', () => {
    const manager = new SnapshotManager();
    let received = 'not-called';
    manager.register('probe', { snapshot: meta => { received = meta; return {}; }, restore: () => {} });
    manager.capture({ label: 'rollback' });
    expect(received).toEqual({ label: 'rollback' });
  });

  it('SaveGameService.setStateProvider 的包装函数透传 meta（46061c5 修复点）', () => {
    const service = makeService();
    let received = 'not-called';
    service.setStateProvider({ capture: meta => { received = meta; return {}; } });
    service.manager.capture({ label: 'rollback' });
    expect(received).toEqual({ label: 'rollback' });
  });

  it('restore 失败路径：game provider 采集回滚快照时收到 rollback label，错误为业务拒绝而非 rollbackUnavailable', async () => {
    const service = makeService();
    const labels = [];
    service.setStateProvider({
      capture: meta => { labels.push(meta?.label ?? null); return { player: { hp: 1 } }; },
      restore: () => ({ ok: false, errors: [{ code: 'restoreRejected', path: 'game', message: '业务拒绝' }] })
    });
    await service.saveAsync(1);
    const loaded = await service.loadAsync(1);
    // capture 调用序：保存时(无 label) → 校验后回滚快照(rollback) → 失败回滚再采集(rollback)
    expect(labels.filter(label => label === 'rollback').length).toBeGreaterThanOrEqual(1);
    expect(loaded.ok).toBe(false);
    expect(loaded.errors[0]?.code).toBe('restoreRejected');
  });

  it('回滚快照采集本身失败：rollbackUnavailable 携带 capture.errors 明细（诊断增强）', async () => {
    const service = makeService();
    let callCount = 0;
    service.setStateProvider({
      capture: meta => {
        callCount++;
        if (callCount > 1 && meta?.label === 'rollback') {
          const error = new Error('玩家位于无场景世界格 (0,0)');
          error.code = 'playerOutsideLoadableWorldCell';
          throw error;
        }
        return { player: { hp: 1 } };
      },
      restore: () => ({ ok: false, errors: [{ code: 'restoreRejected', path: 'game', message: '业务拒绝' }] })
    });
    await service.saveAsync(1);
    const loaded = await service.loadAsync(1);
    expect(loaded.ok).toBe(false);
    expect(loaded.errors[0]?.code).toBe('rollbackUnavailable');
    expect(JSON.stringify(loaded.errors[0]?.errors)).toContain('playerOutsideLoadableWorldCell');
  });
});

describe('存档回归：无场景世界格守卫只属于保存语义（rollback 豁免）', () => {
  function makeStateFlow({ hasScene = false } = {}) {
    const scene = {
      context: {
        services: {
          placements: {
            getPendingStateSnapshot: () => ({ resourceNodes: [], placementStates: [] }),
            getPlacements: () => []
          },
          containerInventories: null,
          corpses: { capture: () => null },
          s01s02: null
        }
      },
      entities: [],
      pickupItems: [],
      equipmentItems: [],
      _deathDrops: { capture: () => [], validate: () => ({ ok: true }) },
      _groupEnemies: {},
      _firedPickups: new Set(),
      _clearedGroups: new Set(),
      _regionDynamicStates: new Map(),
      _campfireService: { snapshot: () => ({ lit: false }) },
      _gameplaySnapshots: { capture: () => ({}), validate: () => ({ ok: true }), restoreFoundations: () => ({ ok: true }), restoreActors: () => ({ ok: true }) },
      s03s14BattleCoordinator: { capture: () => ({}), validateSnapshot: () => ({ ok: true }) },
      rescueSystem: null,
      s09RefugeeCoordinator: { captureUnauthorizedHarvestOperations: () => [] },
      s10ConstructionCoordinator: { _captureS10StructureStates: () => [], _validateS10StructureStates: () => ({ ok: true }) },
      s11s14SceneCoordinator: { _captureS11S14SceneState: () => ({}), _validateS11S14SceneState: () => ({ ok: true }) },
      timeSystem: null,
      weatherSystem: null,
      playerEntity: {
        id: 'p1',
        getComponent: name => name === 'transform' ? { position: { x: 420, y: 330 } } : null
      },
      worldStreamingManager: {
        chunkWidth: 1280,
        chunkHeight: 720,
        worldToChunk: (x, y) => ({ col: Math.floor(x / 1280), row: Math.floor(y / 720) }),
        getSceneId: () => (hasScene ? 'S01' : null),
        serialize: () => ({ schemaVersion: 1, current: { col: 0, row: 0 }, chunks: [] })
      }
    };
    return new SanguoSceneStateFlow(scene);
  }

  it('回滚采集（label=rollback）在玩家位于坏格时不抛——读档链不得被守卫拒绝', () => {
    const flow = makeStateFlow({ hasScene: false });
    const state = flow.captureSceneSaveState({ snapshotMeta: { label: 'rollback' } });
    expect(state).toBeTruthy();
  });

  it('保存采集（无 meta）在坏格时仍抛 playerOutsideLoadableWorldCell——拒存保护保留', () => {
    const flow = makeStateFlow({ hasScene: false });
    try {
      flow.captureSceneSaveState();
      throw new Error('should-have-thrown');
    } catch (error) {
      expect(error.code).toBe('playerOutsideLoadableWorldCell');
    }
  });
});

describe('存档回归：count 模板派生 id 的 tombstone 必须进流式存档（狼复活修复）', () => {
  it('pendingPlacementStates 的派生 id（base-N）经模板回退进入 chunk placementStates', () => {
    const capture = loadCaptureStreamedChunkState();
    const host = makeStreamedChunkHost({
      pendingPlacementStates: [[
        'S01-first-wolf-1',
        { kind: 'corpse', removed: true, decayExpired: true, placementSignature: getPlacementSignature({ id: 'S01-first-wolf', kind: 'enemy', sceneId: 'S01' }) }
      ]]
    });
    const snapshot = capture(host, makeStreamedChunk());
    const wolf = snapshot.placementStates.find(entry => entry.id === 'S01-first-wolf-1');
    expect(wolf, '派生 id tombstone 不得被丢弃').toBeTruthy();
    expect(wolf.state.removed).toBe(true);
  });

  it('pendingResourceNodes 的派生 id 同样经模板回退（resourceNodes 不丢）', () => {
    const capture = loadCaptureStreamedChunkState();
    const host = makeStreamedChunkHost({
      pendingResourceNodes: [[
        'S01-berry-bush-2',
        { remaining: 0, depleted: true, placementSignature: getPlacementSignature({ id: 'S01-berry-bush', kind: 'resource', sceneId: 'S01' }) }
      ]]
    });
    const snapshot = capture(host, makeStreamedChunk({
      placements: [{ id: 'S01-berry-bush', kind: 'resource', sceneId: 'S01' }]
    }));
    const bush = snapshot.resourceNodes.find(entry => entry.id === 'S01-berry-bush-2');
    expect(bush, '派生 id 资源节点状态不得被丢弃').toBeTruthy();
  });

  it('live 实体的派生 id 仍按模板回退匹配（既有行为不回归）', () => {
    const capture = loadCaptureStreamedChunkState();
    const host = makeStreamedChunkHost({
      entities: [{
        id: 'S01-first-wolf-1',
        placementId: 'S01-first-wolf-1',
        getComponent: name => {
          if (name === 'transform') return { position: { x: 8178, y: 4002 } };
          if (name === 'stats') return { hp: 28 };
          return null;
        }
      }]
    });
    const snapshot = capture(host, makeStreamedChunk());
    const wolf = snapshot.placementStates.find(entry => entry.id === 'S01-first-wolf-1');
    expect(wolf).toBeTruthy();
    expect(wolf.state.hp).toBe(28);
  });
});

describe('SDD 阶段 2：quests 节点镜像（任务系统自持文档）', () => {
  function makeQuestSystem({ definitionRevision = 0 } = {}) {
    return new QuestTransactionService({
      definitionRepository: {
        definitionRevision,
        get: (type, id) => (id === 'q1' ? { id: 'q1', name: '测试任务' } : null),
        snapshot: { definitions: { quests: [{ id: 'q1', name: '测试任务' }] } }
      }
    });
  }

  function makeRuntime(definitionId = 'q1') {
    return QuestRuntimeState.create({ questRuntimeId: `p1:${definitionId}`, definitionId, logicalTime: 5 }).toJSON();
  }

  it('serialize 后 sdd.quests 节点镜像勾选状态', () => {
    const quests = makeQuestSystem();
    const data = quests.serialize();
    const node = quests.sdd.getNode('quests');
    expect(node).toEqual(data);
    expect(node.actors).toEqual([]);
    expect(node.schemaVersion).toBe(2);
  });

  it('deserialize 后 sdd.quests 镜像恢复状态，_states 与文档一致', () => {
    const quests = makeQuestSystem();
    const data = {
      schemaVersion: 2,
      definitionRevision: 0,
      taskGraph: null,
      actors: [{ actorId: 'p1', runtimes: [makeRuntime()] }]
    };
    const restored = quests.deserialize(data);
    expect(restored.ok).toBe(true);
    expect(quests.sdd.getNode('quests').actors[0].actorId).toBe('p1');
    expect(quests.sdd.getNode('quests').actors[0].runtimes[0].definitionId).toBe('q1');
    expect(quests._runtime('p1', 'q1').state).toBe('active');
  });

  it('deserialize 版本冲突时拒绝且 sdd.quests 不被污染', () => {
    const quests = makeQuestSystem();
    quests.serialize(); // 先建立基线节点
    const before = quests.sdd.getNode('quests');
    const bad = { schemaVersion: 99, definitionRevision: 0, taskGraph: null, actors: [] };
    const result = quests.deserialize(bad);
    expect(result.ok).toBe(false);
    expect(quests.sdd.getNode('quests')).toEqual(before);
  });

  it('reset 后 sdd.quests 重建为空运行态', () => {
    const quests = makeQuestSystem();
    quests.deserialize({
      schemaVersion: 2, definitionRevision: 0, taskGraph: null,
      actors: [{ actorId: 'p1', runtimes: [makeRuntime()] }]
    });
    quests.reset();
    const node = quests.sdd.getNode('quests');
    expect(node.actors).toEqual([]);
    expect(node.schemaVersion).toBe(2);
  });

  it('quests 节点可订阅：serialize/deserialize 的 patch 通知订阅者（任务视图重建入口）', () => {
    const quests = makeQuestSystem();
    const events = [];
    quests.sdd.subscribe('quests', node => events.push(node));
    quests.serialize();
    quests.deserialize({
      schemaVersion: 2, definitionRevision: 0, taskGraph: null,
      actors: [{ actorId: 'p1', runtimes: [makeRuntime()] }]
    });
    expect(events.length).toBe(2);
    expect(events[1].actors[0].actorId).toBe('p1');
  });

  it('重复 serialize 幂等：sdd.quests 深相等且 revision 稳定推进', () => {
    const quests = makeQuestSystem();
    quests.deserialize({
      schemaVersion: 2, definitionRevision: 0, taskGraph: null,
      actors: [{ actorId: 'p1', runtimes: [makeRuntime()] }]
    });
    const first = quests.serialize();
    const revisionAfterFirst = quests.sdd.revision;
    const second = quests.serialize();
    expect(sddSemanticEquals(second, first)).toBe(true);
    expect(quests.sdd.revision).toBe(revisionAfterFirst + 1);
  });
});

describe('SDD 阶段 3：narrative 节点镜像（GameLoader 叙事状态自持文档）', () => {
  function makeQuestSystem() {
    return new QuestTransactionService({
      definitionRepository: {
        definitionRevision: 0,
        get: (type, id) => (id === 'q1' ? { id: 'q1', name: '测试任务' } : null),
        snapshot: { definitions: { quests: [{ id: 'q1', name: '测试任务' }] } }
      }
    });
  }

  function makeRuntime(definitionId = 'q1') {
    return QuestRuntimeState.create({ questRuntimeId: `p1:${definitionId}`, definitionId, logicalTime: 5 }).toJSON();
  }

  function makeLoader() {
    const loader = new GameLoader();
    loader.blackboard.set('storyState', { currentSceneId: 'S01' });
    return loader;
  }

  it('serialize 后 sddStore.narrative 镜像 blackboard/triggers', () => {
    const loader = makeLoader();
    const data = loader.serialize();
    const node = loader.sddStore.getNode('narrative');
    expect(node.blackboard).toEqual(data.blackboard);
    expect(node.triggers).toEqual(data.triggers);
  });

  it('deserialize 后 sddStore.narrative 镜像恢复状态', () => {
    const loader = makeLoader();
    const triggers = loader.serialize().triggers; // 合法 trigger 快照形状
    const data = {
      blackboard: { storyState: { currentSceneId: 'S02', joinedYellowTurban: true } },
      triggers
    };
    const restored = loader.deserialize(data);
    expect(restored.ok).toBe(true);
    const node = loader.sddStore.getNode('narrative');
    expect(node.blackboard.storyState.joinedYellowTurban).toBe(true);
    expect(loader.blackboard.serialize().storyState.currentSceneId).toBe('S02');
  });

  it('deserialize 校验失败时拒绝且 sddStore.narrative 不被污染', () => {
    const loader = makeLoader();
    loader.serialize(); // 建立基线
    const before = loader.sddStore.getNode('narrative');
    const result = loader.deserialize({});
    expect(result.ok).toBe(false);
    expect(loader.sddStore.getNode('narrative')).toEqual(before);
  });

  it('documentProjector 的运行时节点优先语义：quests/narrative 来源可切换（生产接线工厂）', () => {
    const quests = makeQuestSystem();
    quests.deserialize({
      schemaVersion: 2, definitionRevision: 0, taskGraph: null,
      actors: [{ actorId: 'p1', runtimes: [makeRuntime()] }]
    });
    const projector = createRuntimeDocumentProjector(() => ({ questSystem: quests, gameLoader: null }));
    const snapshot = { data: { game: { player: { hp: 1 }, authority: { serviceStates: { quests: { schemaVersion: 2, taskGraph: { nodes: {} }, actors: [] } } } } } };
    const { document } = projector(snapshot);
    // 运行时节点（有 actor）覆盖投影节点（空 actors）
    expect(document.quests.actors.length).toBe(1);
  });
});

describe('SDD 阶段 3b：读端 SDD 节点优先（snapshotTransformer）', () => {
  function makeSddService({ transformer = true } = {}) {
    const service = makeService();
    service.setStateProvider({
      capture: () => ({
        player: { id: 'player-1', hp: 10 },
        authority: {
          snapshotSchemaVersion: 2,
          serviceStates: {
            quests: { schemaVersion: 2, taskGraph: { nodes: { stale: {} } }, actors: [] },
            campaignContent: { blackboard: { storyState: { currentSceneId: 'OLD' } }, triggers: { snapshotSchemaVersion: 3 } }
          }
        }
      }),
      restore: data => {
        service.__restoredServiceStates = data?.authority?.serviceStates || null;
        return { ok: true };
      }
    });
    if (transformer) {
      service.manager.snapshotTransformer = createSddSnapshotTransformer();
    }
    return service;
  }

  const SDD_QUESTS = { schemaVersion: 2, taskGraph: { nodes: { fresh: {} } }, actors: [{ actorId: 'p1', runtimes: [] }] };
  const SDD_NARRATIVE = { blackboard: { storyState: { currentSceneId: 'NEW' } }, triggers: { snapshotSchemaVersion: 3 } };

  it('带 sdd 的存档：restore 收到的 quests/campaignContent 来自文档节点', async () => {
    const service = makeSddService();
    const baseProjector = createRuntimeDocumentProjector(() => null);
    service.manager.documentProjector = snapshot => {
      const projection = baseProjector(snapshot);
      projection.document.quests = SDD_QUESTS;             // 模拟运行时文档（新值）
      projection.document.narrative = SDD_NARRATIVE;
      return projection;
    };
    await service.saveAsync(1);
    service.__restoredServiceStates = null;
    const loaded = await service.loadAsync(1);
    expect(loaded.ok).toBe(true);
    expect(loaded.restored).toContain('game');
    const restored = service.__restoredServiceStates;
    expect(restored.quests).toEqual(SDD_QUESTS);
    expect(restored.campaignContent.blackboard.storyState.currentSceneId).toBe('NEW');
  });

  it('旧档无 sdd 字段：原样走旧链路（transformer 幂等跳过）', async () => {
    const service = makeSddService({ transformer: true });
    service.manager.documentProjector = null; // 旧档写入方（无双写）
    await service.saveAsync(1);
    service.__restoredServiceStates = null;
    const loaded = await service.loadAsync(1);
    expect(loaded.ok).toBe(true);
    expect(service.__restoredServiceStates.quests.taskGraph.nodes.stale).toEqual({});
    expect(service.__restoredServiceStates.campaignContent.blackboard.storyState.currentSceneId).toBe('OLD');
  });

  it('transformer 抛错：告警并使用原快照继续恢复（不阻断读档）', async () => {
    const service = makeSddService({ transformer: true });
    service.setStateProvider({
      capture: () => ({
        player: { id: 'p1' },
        authority: { snapshotSchemaVersion: 2, serviceStates: { quests: { schemaVersion: 2, taskGraph: { nodes: {} }, actors: [] } } }
      }),
      restore: data => {
        service.__restoredServiceStates = data?.authority?.serviceStates || null;
        return { ok: true };
      }
    });
    service.manager.documentProjector = createRuntimeDocumentProjector(() => null);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    service.manager.snapshotTransformer = () => { throw new Error('transformer boom'); };
    await service.saveAsync(1);
    const loaded = await service.loadAsync(1);
    expect(loaded.ok).toBe(true);
    expect(service.__restoredServiceStates.quests).toBeTruthy(); // 原字段仍在
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('SDD 阶段 3 第二批：全节点读端覆盖（player/ui/world，存档时文档）', () => {
  function makeFullSddService({ sddDocumentExtras = {} } = {}) {
    const service = makeService();
    service.setStateProvider({
      capture: () => ({
        player: { id: 'player-1', hp: 10, transform: { x: 111, y: 222 } },
        tutorial: { phase: 'old-tutorial' },
        dialogue: { activeId: 'old-dialogue' },
        scene: { campfireLit: false, oldMarker: true },
        authority: {
          snapshotSchemaVersion: 2,
          serviceStates: {
            quests: { schemaVersion: 2, taskGraph: { nodes: { stale: {} } }, actors: [] },
            campaignContent: { blackboard: { storyState: { currentSceneId: 'OLD' } }, triggers: { snapshotSchemaVersion: 3 } }
          }
        }
      }),
      restore: data => {
        service.__restoredGame = data || null;
        return { ok: true };
      }
    });
    const baseProjector = createRuntimeDocumentProjector(() => null);
    service.manager.documentProjector = snapshot => {
      const projection = baseProjector(snapshot);
      Object.assign(projection.document, sddDocumentExtras); // 模拟运行时文档/缺段
      return projection;
    };
    // 生产接线工厂（全节点覆盖 + 缺段判空）
    service.manager.snapshotTransformer = createSddSnapshotTransformer();
    return service;
  }

  it('全节点覆盖：player/tutorial/dialogue/scene 从文档节点恢复', async () => {
    const service = makeFullSddService({
      sddDocumentExtras: {
        player: { id: 'player-1', hp: 99, transform: { x: 999, y: 888 } },
        ui: { tutorial: { phase: 'new-tutorial' }, dialogue: { activeId: 'new-dialogue' } },
        world: { currentSceneId: 'S01', scene: { campfireLit: true, newMarker: true } }
      }
    });
    await service.saveAsync(1);
    service.__restoredGame = null;
    const loaded = await service.loadAsync(1);
    expect(loaded.ok).toBe(true);
    const game = service.__restoredGame;
    expect(game.player.hp).toBe(99);
    expect(game.player.transform.x).toBe(999);
    expect(game.tutorial.phase).toBe('new-tutorial');
    expect(game.dialogue.activeId).toBe('new-dialogue');
    expect(game.scene.campfireLit).toBe(true);
    expect(game.scene.newMarker).toBe(true);
  });

  it('缺段判空跳过：文档 player/ui/world 为 null 时不覆盖旧字段', async () => {
    const service = makeFullSddService({
      sddDocumentExtras: {
        player: null, ui: { tutorial: null, dialogue: null }, world: { scene: null }
      }
    });
    await service.saveAsync(1);
    service.__restoredGame = null;
    const loaded = await service.loadAsync(1);
    expect(loaded.ok).toBe(true);
    const game = service.__restoredGame;
    expect(game.player.hp).toBe(10);                 // 旧字段保留
    expect(game.player.transform.x).toBe(111);
    expect(game.tutorial.phase).toBe('old-tutorial');
    expect(game.dialogue.activeId).toBe('old-dialogue');
    expect(game.scene.oldMarker).toBe(true);
    expect(game.scene.campfireLit).toBe(false);
  });

  it('混合覆盖：部分节点有值部分缺段，各自独立判定', async () => {
    const service = makeFullSddService({
      sddDocumentExtras: {
        player: { id: 'player-1', hp: 50 },
        ui: { tutorial: null, dialogue: { activeId: 'new-dialogue' } },
        world: null
      }
    });
    await service.saveAsync(1);
    service.__restoredGame = null;
    await service.loadAsync(1);
    const game = service.__restoredGame;
    expect(game.player.hp).toBe(50);                 // 覆盖
    expect(game.tutorial.phase).toBe('old-tutorial'); // 缺段跳过
    expect(game.dialogue.activeId).toBe('new-dialogue'); // 覆盖
    expect(game.scene.oldMarker).toBe(true);         // world 缺段跳过
  });
});

describe('战斗中传送点抑制（isCombatActive 守卫）', () => {
  function makeBindingsSystem({ combat = false } = {}) {
    const fired = [];
    const system = new SceneTriggerBindingSystem({
      triggerSystem: {
        getById: id => ({ id, when: { type: id.includes('interact') ? 'interact' : 'enter' } }),
        hasFiredOnce: () => false,
        fireById: triggerId => { fired.push(triggerId); return true; },
        fire: (eventId, payload) => { fired.push(eventId); return { ok: true }; }
      },
      getPlayer: () => ({ getComponent: name => name === 'transform' ? { position: { x: 500, y: 400 } } : null }),
      isCombatActive: () => combat
    });
    system.setBindings([
      { type: 'trigger', id: 'b-travel', triggerId: 'trg-travel-enter', sceneId: 'S01', x: 500, y: 400, radius: 80, travel: { sceneId: 'S02' } },
      { type: 'trigger', id: 'b-plain', triggerId: 'trg-plain-enter', sceneId: 'S01', x: 540, y: 400, radius: 80 }
    ]);
    return { system, fired };
  }

  it('战斗中：travel 绑定不触发传送、光圈锚点不含传送点（非 travel 触发器照常）', () => {
    const { system, fired } = makeBindingsSystem({ combat: true });
    system.update();
    // 传送点被抑制；普通触发器不受战斗守卫影响
    expect(fired).toEqual(['trg-plain-enter']);
    const anchors = system.getGroundMarkerAnchors();
    expect(anchors).toEqual([]);
  });

  it('脱战后恢复：传送点重新触发，光圈恢复显示', () => {
    const { system, fired } = makeBindingsSystem({ combat: false });
    system.update();
    expect(fired.length).toBe(2);
    const anchors = system.getGroundMarkerAnchors();
    expect(anchors.length).toBe(1); // 只有 travel 绑定绘制传送点光圈
  });

  it('战斗中 interact 型传送点不出现在交互候选', () => {
    const system = new SceneTriggerBindingSystem({
      triggerSystem: {
        getById: id => ({ id, when: { type: 'interact' } }),
        hasFiredOnce: () => false,
        fireById: () => true,
        fire: () => ({ ok: true })
      },
      getPlayer: () => ({ getComponent: name => name === 'transform' ? { position: { x: 500, y: 400 } } : null }),
      isCombatActive: () => true
    });
    system.setBindings([
      { type: 'trigger', id: 'b-travel-i', triggerId: 'trg-travel-i', sceneId: 'S01', x: 500, y: 400, radius: 80, travel: { sceneId: 'S02' }, prompt: '传送' }
    ]);
    expect(system.listInteractCandidates()).toEqual([]);
  });
});
