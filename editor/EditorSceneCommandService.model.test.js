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
import { MemorySceneCacheAdapter } from '../src/core/scene/CanonicalSceneAdapters.js';
import {
  InMemoryDiskAdapter,
  ModelCommandRunner,
  SeedGenerator,
  cloneValue
} from '../test/support/ModelTesting.js';
import { CanonicalDocumentService } from './CanonicalDocumentService.js';
import { EditorSceneCommandService } from './EditorSceneCommandService.js';

const PROJECT_PATH = 'example/game/game.project.json';
const SCENE_ROOT = 'example/game/assets/scenes/';
const ORDER_PATH = `${SCENE_ROOT}_scene_order.json`;
const PROPERTY_SEEDS = Object.freeze([0x6ed17a11, 0x6ed17a12, 0x6ed17a13]);
const SCALAR_REFS = new Set([
  'sceneId', 'entrySceneId', 'currentSceneId', 'targetSceneId', 'nextSceneId',
  'destinationSceneId', 'sourceSceneId', 'fromSceneId', 'toSceneId',
  'chunkId', 'currentChunkId', 'targetChunkId'
]);
const ARRAY_REFS = new Set(['sceneIds', 'sceneRefs', 'unlockedScenes', 'completedScenes']);
const clone = cloneValue;

function aggregate(ids = ['S01', 'S02']) {
  return {
    project: {
      schemaVersion: 1,
      meta: { id: 'game', version: 3, schema: 3 },
      scenes: ids.map(id => ({ id, name: id }))
    },
    sceneOrder: {
      gameId: 'game',
      order: ids.slice(),
      scenes: Object.fromEntries(ids.map(id => [id, { name: id, type: 'terrain' }]))
    },
    scenes: Object.fromEntries(ids.map(id => [id, { id, name: id, layers: [] }]))
  };
}

function cacheEntry(sceneId, scene, transactionId = 'tx-0') {
  return {
    sceneId,
    source: `${SCENE_ROOT}${sceneId}.json`,
    canonicalData: clone(scene),
    diskRevision: transactionId,
    schemaVersion: 1,
    validatorFingerprint: 'property-v1',
    refreshedAt: 123,
    eligible: true
  };
}

function initialCache(canonical) {
  return Object.fromEntries(Object.entries(canonical.scenes)
    .map(([sceneId, scene]) => [sceneId, cacheEntry(sceneId, scene)]));
}

function rewriteModelReferences(value, oldId, newId, parentKey = '', inGrid = false) {
  if (Array.isArray(value)) {
    return value.map(child => {
      if ((ARRAY_REFS.has(parentKey) || inGrid) && child === oldId) return newId;
      return rewriteModelReferences(child, oldId, newId, parentKey, inGrid || parentKey === 'grid');
    });
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    SCALAR_REFS.has(key) && child === oldId
      ? newId
      : rewriteModelReferences(child, oldId, newId, key, inGrid || key === 'grid')
  ]));
}

function modelHasReference(value, sceneId, parentKey = '', inGrid = false) {
  if (Array.isArray(value)) {
    return value.some(child => ((ARRAY_REFS.has(parentKey) || inGrid) && child === sceneId)
      || modelHasReference(child, sceneId, parentKey, inGrid || parentKey === 'grid'));
  }
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) =>
    (SCALAR_REFS.has(key) && child === sceneId)
    || modelHasReference(child, sceneId, key, inGrid || key === 'grid'));
}

function prepareModelCommand(current, command) {
  let candidate = clone(current);
  const payload = command.payload || {};
  const changedSceneIds = new Set();
  let removedSceneId = null;
  let sceneId = payload.sceneId || payload.scene?.id;

  if (command.type === 'create' || command.type === 'import') {
    const scene = clone(payload.scene);
    sceneId = scene.id;
    candidate.scenes[sceneId] = scene;
    candidate.project.scenes.push({ id: sceneId, name: scene.name || sceneId });
    candidate.sceneOrder.scenes[sceneId] = { name: scene.name || sceneId, type: scene.type || 'terrain' };
    candidate.sceneOrder.order.push(sceneId);
    changedSceneIds.add(sceneId);
  } else if (command.type === 'update' || command.type === 'save') {
    candidate.scenes[sceneId] = { ...clone(payload.scene || candidate.scenes[sceneId]), id: sceneId };
    changedSceneIds.add(sceneId);
  } else if (command.type === 'rename') {
    const { oldId, newId } = payload;
    sceneId = newId;
    const beforeScenes = candidate.scenes;
    candidate = rewriteModelReferences(candidate, oldId, newId);
    candidate.project.scenes = candidate.project.scenes.map(entry => entry.id === oldId ? { ...entry, id: newId } : entry);
    candidate.sceneOrder.order = candidate.sceneOrder.order.map(id => id === oldId ? newId : id);
    candidate.sceneOrder.scenes[newId] = candidate.sceneOrder.scenes[oldId];
    delete candidate.sceneOrder.scenes[oldId];
    candidate.scenes[newId] = { ...candidate.scenes[oldId], id: newId };
    delete candidate.scenes[oldId];
    removedSceneId = oldId;
    for (const id of Object.keys(candidate.scenes)) {
      const before = id === newId ? beforeScenes[oldId] : beforeScenes[id];
      if (JSON.stringify(before) !== JSON.stringify(candidate.scenes[id])) changedSceneIds.add(id);
    }
  } else if (command.type === 'delete') {
    const referenced = modelHasReference(candidate.project, sceneId)
      || Object.entries(candidate.scenes).some(([id, scene]) => id !== sceneId && modelHasReference(scene, sceneId));
    if (referenced) return { rejected: true };
    candidate.project.scenes = candidate.project.scenes.filter(entry => entry.id !== sceneId);
    candidate.sceneOrder.order = candidate.sceneOrder.order.filter(id => id !== sceneId);
    delete candidate.sceneOrder.scenes[sceneId];
    delete candidate.scenes[sceneId];
    removedSceneId = sceneId;
  }

  const cacheOperations = [];
  if (removedSceneId) cacheOperations.push({ operation: 'delete', sceneId: removedSceneId });
  for (const id of changedSceneIds) {
    if (candidate.scenes[id]) cacheOperations.push({ operation: 'set', sceneId: id });
  }
  return { candidate, cacheOperations };
}
function initialModelState() {
  const canonical = aggregate();
  return {
    disk: clone(canonical),
    memory: clone(canonical),
    cache: initialCache(canonical),
    notifications: [],
    transactionCount: 0,
    snapshotRevision: 0
  };
}

function resultShape(overrides) {
  return {
    ok: false,
    committed: false,
    status: 'rejected',
    code: 'candidateValidationFailed',
    degraded: false,
    ...overrides
  };
}

function expectedPhases(fault, cacheOperationCount, rejected = false) {
  if (rejected) return [];
  const phases = ['validate'];
  if (fault?.phase === 'validate') return phases;
  phases.push('canonicalize');
  if (fault?.phase === 'canonicalize') return phases;
  phases.push('disk.prepare');
  if (fault?.phase === 'disk.prepare') return phases;
  phases.push('disk.commit');
  if (fault?.phase === 'disk.commit') return phases;
  phases.push('memory.publish');
  if (fault?.phase === 'memory.publish' || fault?.phase === 'memory.rebuild') phases.push('memory.rebuild');
  for (let index = 0; index < cacheOperationCount; index++) phases.push('cache.sync');
  phases.push('notify');
  return phases;
}

function applyCacheModel(model, operations, candidate, transactionId, fault) {
  let degraded = false;
  operations.forEach((operation, index) => {
    const failed = fault?.phase === 'cache.sync' && (fault.at || 1) === index + 1;
    if (failed) {
      degraded = true;
      if (model.cache[operation.sceneId]) {
        model.cache[operation.sceneId] = {
          ...model.cache[operation.sceneId],
          eligible: false,
          ineligibleReason: 'post-commit-cache-sync-failed'
        };
      }
      return;
    }
    if (operation.operation === 'delete') delete model.cache[operation.sceneId];
    else model.cache[operation.sceneId] = cacheEntry(
      operation.sceneId,
      candidate.scenes[operation.sceneId],
      transactionId
    );
  });
  return degraded;
}

function applyEditorModel({ model, command }) {
  const prepared = prepareModelCommand(model.memory, command);
  if (prepared.rejected) {
    return {
      result: resultShape({}),
      phases: expectedPhases(command.fault, 0, true),
      snapshots: clone(model)
    };
  }

  const fault = command.fault;
  if (fault?.phase === 'validate' || fault?.phase === 'canonicalize') {
    return {
      result: resultShape({}),
      phases: expectedPhases(fault, prepared.cacheOperations.length),
      snapshots: clone(model)
    };
  }
  if (fault?.phase === 'disk.prepare' || fault?.phase === 'disk.commit') {
    return {
      result: resultShape({ status: 'failed', code: 'diskCommitFailed' }),
      phases: expectedPhases(fault, prepared.cacheOperations.length),
      snapshots: clone(model)
    };
  }

  model.transactionCount++;
  const transactionId = `tx-${model.transactionCount}`;
  model.disk = clone(prepared.candidate);
  let degraded = false;
  if (fault?.phase === 'memory.publish') {
    model.memory = clone(prepared.candidate);
    model.snapshotRevision++;
    degraded = true;
  } else if (fault?.phase === 'memory.rebuild') {
    degraded = true;
  } else {
    model.memory = clone(prepared.candidate);
    model.snapshotRevision++;
  }

  if (applyCacheModel(model, prepared.cacheOperations, prepared.candidate, transactionId, fault)) degraded = true;
  if (fault?.phase === 'notify') degraded = true;
  else model.notifications.push(command.type);

  return {
    result: resultShape({
      ok: true,
      committed: true,
      status: degraded ? 'committed-with-degradation' : 'committed',
      code: degraded ? 'committedWithDegradation' : 'committed',
      degraded
    }),
    phases: expectedPhases(fault, prepared.cacheOperations.length),
    snapshots: clone(model)
  };
}

function diskFiles(canonical) {
  return {
    [PROJECT_PATH]: `${JSON.stringify(canonical.project, null, 2)}\n`,
    [ORDER_PATH]: `${JSON.stringify(canonical.sceneOrder, null, 2)}\n`,
    ...Object.fromEntries(Object.entries(canonical.scenes)
      .map(([sceneId, scene]) => [`${SCENE_ROOT}${sceneId}.json`, `${JSON.stringify(scene, null, 2)}\n`]))
  };
}

function diskCanonical(disk) {
  const files = disk.snapshot();
  const project = JSON.parse(files[PROJECT_PATH]);
  return {
    project,
    sceneOrder: JSON.parse(files[ORDER_PATH]),
    scenes: Object.fromEntries(project.scenes.map(({ id }) => [id, JSON.parse(files[`${SCENE_ROOT}${id}.json`])]))
  };
}

function cacheSnapshot(cache) {
  return Object.fromEntries(cache.keys().sort().map(sceneId => [sceneId, cache.get(sceneId)]));
}

function createEditorSystem(context) {
  const canonical = aggregate();
  const disk = new InMemoryDiskAdapter(diskFiles(canonical));
  const cache = new MemorySceneCacheAdapter(initialCache(canonical));
  const documentService = new CanonicalDocumentService();
  const model = documentService.openProject({ sourceUri: PROJECT_PATH, canonical });
  const notifications = [];
  const phaseLog = [];
  const phaseCounts = new Map();
  let activeFault = null;
  let transactionCount = 0;

  const phase = name => {
    const occurrence = (phaseCounts.get(name) || 0) + 1;
    phaseCounts.set(name, occurrence);
    phaseLog.push(name);
    context.trace.phase(name, 'editor-command-phase', { occurrence });
    return activeFault?.phase === name && (activeFault.at || 1) === occurrence;
  };

  const validator = {
    sceneValidator: { fingerprint: 'property-v1' },
    validateAndCanonicalize(candidate) {
      if (phase('validate')) {
        return { ok: false, errors: [{ path: 'scenes', category: 'schemaFailed', reason: 'injected validation fault' }] };
      }
      if (phase('canonicalize')) {
        return { ok: false, errors: [{ path: '', category: 'businessRuleFailed', reason: 'injected canonicalize fault' }] };
      }
      return { ok: true, value: clone(candidate), errors: [] };
    }
  };

  const diskTransaction = async (_projectPath, changes) => {
    if (phase('disk.prepare')) throw new Error('injected disk prepare fault');
    if (phase('disk.commit')) throw new Error('injected disk commit fault');
    const before = disk.snapshot();
    try {
      for (const change of changes) {
        if (change.operation === 'delete') disk.delete(change.path);
        else if (change.operation === 'rename') {
          disk.rename(change.from, change.path);
          disk.write(change.path, change.content);
        } else disk.write(change.path, change.content);
      }
    } catch (error) {
      disk.restore(before);
      throw error;
    }
    transactionCount++;
    return { ok: true, committed: true, transactionId: `tx-${transactionCount}`, warnings: [] };
  };

  const originalCommit = documentService.commit.bind(documentService);
  documentService.commit = (...args) => {
    const injected = phase('memory.publish');
    if (injected || activeFault?.phase === 'memory.rebuild') throw new Error('injected memory publish fault');
    return originalCommit(...args);
  };

  const originalSet = cache.set.bind(cache);
  cache.set = (...args) => {
    if (phase('cache.sync')) throw new Error('injected cache set fault');
    return originalSet(...args);
  };
  const originalDelete = cache.delete.bind(cache);
  cache.delete = (...args) => {
    if (phase('cache.sync')) throw new Error('injected cache delete fault');
    return originalDelete(...args);
  };

  const service = new EditorSceneCommandService({
    documentService,
    validator,
    diskTransaction,
    cacheAdapter: cache,
    readCommittedSnapshot: async () => {
      if (phase('memory.rebuild')) throw new Error('injected memory rebuild fault');
      return { canonical: diskCanonical(disk), snapshotRevision: model.snapshotRevision + 1 };
    },
    notifier: async event => {
      if (phase('notify')) throw new Error('injected notification fault');
      notifications.push(event.command);
    },
    now: () => 123
  });

  return {
    async execute(command) {
      activeFault = command.fault || null;
      phaseCounts.clear();
      phaseLog.length = 0;
      const result = await service[command.type](PROJECT_PATH, clone(command.payload));
      return {
        result,
        phases: phaseLog.slice(),
        snapshots: {
          disk: diskCanonical(disk),
          memory: model.getCommittedSnapshot(),
          cache: cacheSnapshot(cache),
          notifications: notifications.slice(),
          transactionCount,
          snapshotRevision: model.snapshotRevision
        }
      };
    }
  };
}
function generatedCommandSequence(seed) {
  const random = new SeedGenerator(seed);
  const suffix = () => random.string(5, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  const createdId = `C${suffix()}`;
  const renamedId = `R${suffix()}`;
  const importedId = `I${suffix()}`;
  const marker = random.string(8);
  return [
    { type: 'create', payload: { scene: { id: createdId, name: `created-${marker}`, layers: [] } } },
    {
      type: 'update',
      payload: {
        sceneId: 'S02',
        scene: {
          id: 'S02',
          name: 'reference-holder',
          layers: [],
          portal: {
            targetSceneId: createdId,
            sceneRefs: [createdId],
            nested: { sourceSceneId: createdId }
          }
        }
      }
    },
    { type: 'rename', payload: { oldId: createdId, newId: renamedId } },
    { type: 'delete', payload: { sceneId: renamedId } },
    {
      type: 'save',
      payload: { sceneId: 'S02', scene: { id: 'S02', name: `cleared-${marker}`, layers: [] } }
    },
    { type: 'delete', payload: { sceneId: renamedId } },
    { type: 'import', payload: { scene: { id: importedId, name: `imported-${marker}`, layers: [] } } }
  ];
}

function normalizeResult(result) {
  return {
    ok: result.ok,
    committed: result.committed,
    status: result.status,
    code: result.code,
    degraded: result.degraded === true
  };
}

function createRunner() {
  return new ModelCommandRunner({
    createModel: initialModelState,
    createSystem: createEditorSystem,
    applyModel: applyEditorModel,
    executeSystem: ({ system, command }) => system.execute(command),
    oracle: ({ command, expected, actual }) => {
      try {
        expect(normalizeResult(actual.result)).toEqual(expected.result);
        expect(actual.phases).toEqual(expected.phases);
        expect(actual.snapshots).toEqual(expected.snapshots);
      } catch (error) {
        error.code = 'editorCommandModelMismatch';
        error.phase = command.fault?.phase || 'editor-command-oracle';
        throw error;
      }
    }
  });
}

function updateWithFault(phase, at = 1) {
  return {
    type: 'update',
    fault: { phase, at },
    payload: {
      sceneId: 'S01',
      scene: { id: 'S01', name: `fault-${phase}-${at}`, layers: [], marker: `${phase}#${at}` }
    }
  };
}

function renameFaultSequence(at) {
  return [
    {
      type: 'update',
      payload: {
        sceneId: 'S02',
        scene: {
          id: 'S02',
          layers: [],
          portal: { targetSceneId: 'S01', sceneRefs: ['S01'], nested: { sourceSceneId: 'S01' } }
        }
      }
    },
    { type: 'rename', fault: { phase: 'cache.sync', at }, payload: { oldId: 'S01', newId: 'S01A' } }
  ];
}

// Property 6: Fix Checking — Atomic Editor Command State Machine.
// **Validates: Requirements 2.5, 2.6, 2.10**
describe('Property 6: Atomic Editor Command State Machine', () => {
  it('固定 seed 生成六类命令并与 disk/memory/cache 三快照模型逐步一致', async () => {
    for (const seed of PROPERTY_SEEDS) {
      const commands = generatedCommandSequence(seed);
      const first = await createRunner().run(commands, { seed });
      const replay = await createRunner().run(commands, { seed });

      expect(new Set(commands.map(command => command.type))).toEqual(
        new Set(['create', 'update', 'rename', 'delete', 'import', 'save'])
      );
      expect(replay.trace).toEqual(first.trace);
      expect(first.model.notifications).toEqual(['create', 'update', 'rename', 'save', 'delete', 'import']);
      const finalIds = first.model.disk.project.scenes.map(scene => scene.id);
      expect(finalIds).not.toContain(commands[2].payload.oldId);
      expect(finalIds).not.toContain(commands[2].payload.newId);
      expect(finalIds).toContain(commands[6].payload.scene.id);
      expect(JSON.stringify(first.model.disk)).not.toContain(commands[2].payload.oldId);
    }
  });

  it('固定 seed 覆盖 commit point 前后阶段故障、内存重建及通知顺序', async () => {
    const seed = 0x6ed17aff;
    const phases = [
      'validate', 'canonicalize', 'disk.prepare', 'disk.commit',
      'memory.publish', 'memory.rebuild', 'cache.sync', 'notify'
    ];

    for (const phase of phases) {
      const outcome = await createRunner().run([updateWithFault(phase)], { seed });
      const preCommit = ['validate', 'canonicalize', 'disk.prepare', 'disk.commit'].includes(phase);
      if (preCommit) {
        expect(outcome.model.disk.scenes.S01.marker).toBeUndefined();
        expect(outcome.model.memory.scenes.S01.marker).toBeUndefined();
        expect(outcome.model.cache.S01.canonicalData.marker).toBeUndefined();
        expect(outcome.model.notifications).toEqual([]);
      } else {
        expect(outcome.model.disk.scenes.S01.marker).toBe(`${phase}#1`);
      }
      if (phase === 'memory.publish') {
        expect(outcome.model.memory.scenes.S01.marker).toBe('memory.publish#1');
      }
      if (phase === 'memory.rebuild') {
        expect(outcome.model.memory.scenes.S01.marker).toBeUndefined();
      }
      if (phase === 'cache.sync') {
        expect(outcome.model.cache.S01).toMatchObject({
          eligible: false,
          ineligibleReason: 'post-commit-cache-sync-failed'
        });
      }
      if (phase === 'notify') expect(outcome.model.notifications).toEqual([]);
    }
  });

  it('rename 的每个 cache operation 故障都不回滚磁盘并取消对应 fallback 资格', async () => {
    const seed = 0x6ed17ac0;
    for (const at of [1, 2, 3]) {
      const outcome = await createRunner().run(renameFaultSequence(at), { seed: seed + at });
      expect(outcome.model.disk.scenes.S01).toBeUndefined();
      expect(outcome.model.disk.scenes.S01A).toBeDefined();
      expect(outcome.model.memory.scenes.S01A).toBeDefined();
      const targetId = at === 1 ? 'S01' : at === 2 ? 'S02' : 'S01A';
      expect(outcome.model.cache[targetId]?.eligible === true).toBe(false);
      expect(outcome.model.notifications).toEqual(['update', 'rename']);
    }
  });
});
