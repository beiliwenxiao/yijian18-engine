import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemorySceneCacheAdapter } from '../src/core/scene/CanonicalSceneAdapters.js';
import { CanonicalDocumentService } from './CanonicalDocumentService.js';
import { EditorCanonicalCandidateValidator, EditorSceneCommandService } from './EditorSceneCommandService.js';
import { validateWorldMapRepositoryClosure } from './WorldMapEditor.js';

const clone = value => structuredClone(value);
const PROJECT_PATH = 'example/game/game.project.json';

function aggregate(ids = ['S01']) {
  return {
    project: { schemaVersion: 1, meta: { id: 'game', version: 3, schema: 3 }, scenes: ids.map(id => ({ id })) },
    sceneOrder: { gameId: 'game', order: ids.slice(), scenes: Object.fromEntries(ids.map(id => [id, { name: id, type: 'terrain' }])) },
    scenes: Object.fromEntries(ids.map(id => [id, { id, layers: [] }]))
  };
}

function harness({ validator, cacheAdapter, diskTransaction, notifier, readCommittedSnapshot } = {}) {
  const documentService = new CanonicalDocumentService();
  const model = documentService.openProject({ sourceUri: PROJECT_PATH, canonical: aggregate() });
  const calls = [];
  const service = new EditorSceneCommandService({
    documentService,
    validator: validator || { sceneValidator: { fingerprint: 'test-v1' }, validateAndCanonicalize: candidate => ({ ok: true, value: clone(candidate), errors: [] }) },
    diskTransaction: diskTransaction || (async (_path, changes) => { calls.push(['disk', changes]); return { ok: true, committed: true, transactionId: 'tx-1', warnings: [] }; }),
    cacheAdapter,
    notifier,
    readCommittedSnapshot,
    now: () => 123
  });
  return { service, documentService, model, calls };
}

describe('EditorSceneCommandService atomic command chain', () => {
  it.each(['create', 'import'])('%s 同事务提交场景、项目元数据和列表', async command => {
    const cache = new MemorySceneCacheAdapter();
    const { service, model, calls } = harness({ cacheAdapter: cache });

    const result = await service[command](PROJECT_PATH, { scene: { id: 'S02', name: 'two', layers: [] } });

    expect(result).toMatchObject({ ok: true, committed: true, status: 'committed' });
    expect(calls[0][1].map(change => [change.operation, change.path])).toEqual([
      ['replace', PROJECT_PATH],
      ['replace', 'example/game/assets/scenes/_scene_order.json'],
      ['create', 'example/game/assets/scenes/S02.json']
    ]);
    expect(model.originalCanonical.project.scenes.map(scene => scene.id)).toEqual(['S01', 'S02']);
    expect(model.originalCanonical.sceneOrder.order).toEqual(['S01', 'S02']);
    expect(cache.get('S02')).toMatchObject({ sceneId: 'S02', eligible: true, diskRevision: 'tx-1', refreshedAt: 123 });
  });

  it.each(['update', 'save'])('%s 原位写回加载时 sourceUri 且不重写项目/list', async command => {
    const { service, calls } = harness();
    const result = await service[command](PROJECT_PATH, {
      sceneId: 'S01', sourceUri: 'custom/canonical/S01.json', scene: { id: 'S01', marker: command, layers: [] }
    });
    expect(result.ok).toBe(true);
    expect(calls[0][1]).toEqual([expect.objectContaining({ operation: 'replace', path: 'custom/canonical/S01.json' })]);
    expect(result.value.scenes.S01.marker).toBe(command);
  });
  it('rootPaths 保存把受影响 canonical 场景同步到 fallback cache', async () => {
    const cache = new MemorySceneCacheAdapter();
    const { service, model, calls } = harness({ cacheAdapter: cache });
    const candidate = model.getCandidate();
    candidate.scenes.S01.marker = 'edited-through-root-path';

    const result = await service.save(PROJECT_PATH, {
      rootPaths: ['scenes.S01.layers[0].objects[0]']
    });

    expect(result).toMatchObject({ ok: true, committed: true });
    expect(calls[0][1]).toEqual([
      expect.objectContaining({ operation: 'replace', path: 'example/game/assets/scenes/S01.json' })
    ]);
    expect(cache.get('S01')).toMatchObject({
      sceneId: 'S01', eligible: true,
      canonicalData: expect.objectContaining({ marker: 'edited-through-root-path' })
    });
  });

  it('rename 原子更新支持引用、新文件/list/project 并移除旧缓存', async () => {
    const cache = new MemorySceneCacheAdapter({ S01: { sceneId: 'S01', eligible: true } });
    const { service, documentService, calls } = harness({ cacheAdapter: cache });
    const model = documentService.requireProject(PROJECT_PATH);
    const current = aggregate(['S01', 'S02']);
    current.project.worldMap = { entrySceneId: 'S01', regions: [{ grid: [['S01']] }] };
    current.scenes.S02.portal = { targetSceneId: 'S01' };
    model.commitSnapshot(current);

    const result = await service.rename(PROJECT_PATH, { oldId: 'S01', newId: 'S01A' });

    expect(result.ok).toBe(true);
    expect(result.value.project.worldMap.entrySceneId).toBe('S01A');
    expect(result.value.project.worldMap.regions[0].grid[0][0]).toBe('S01A');
    expect(result.value.scenes.S02.portal.targetSceneId).toBe('S01A');
    expect(result.value.sceneOrder.order).toEqual(['S01A', 'S02']);
    expect(result.value.scenes.S01).toBeUndefined();
    expect(calls[0][1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'replace', path: 'example/game/assets/scenes/S02.json' }),
      expect.objectContaining({ operation: 'rename', from: 'example/game/assets/scenes/S01.json', path: 'example/game/assets/scenes/S01A.json' })
    ]));
    expect(cache.get('S01')).toBeNull();
    expect(cache.get('S01A')).toMatchObject({ eligible: true });
  });

  it('delete 对仍被引用项在磁盘提交前拒绝，所有正式状态零修改', async () => {
    const cache = new MemorySceneCacheAdapter({ S01: { sceneId: 'S01', eligible: true } });
    const { service, model, calls } = harness({ cacheAdapter: cache });
    const candidate = model.getCommittedSnapshot();
    candidate.project.worldMap = { entrySceneId: 'S01', regions: [{ grid: [['S01']] }] };
    model.commitSnapshot(candidate);
    const before = model.getCommittedSnapshot();

    const result = await service.delete(PROJECT_PATH, { sceneId: 'S01' });

    expect(result).toMatchObject({ ok: false, committed: false, status: 'rejected', code: 'candidateValidationFailed' });
    expect(result.errors.map(error => error.path)).toEqual(expect.arrayContaining([
      'project.worldMap.entrySceneId', 'project.worldMap.regions[0].grid[0][0]'
    ]));
    expect(calls).toEqual([]);
    expect(model.getCommittedSnapshot()).toEqual(before);
    expect(cache.get('S01')).toMatchObject({ eligible: true });
  });

  it('候选校验失败与磁盘失败都保持 committed memory/cache 不变', async () => {
    const cache = new MemorySceneCacheAdapter({ S01: { sceneId: 'S01', eligible: true } });
    const invalid = harness({
      cacheAdapter: cache,
      validator: { validateAndCanonicalize: () => ({ ok: false, errors: [{ path: 'scenes.S01.layers', category: 'schemaFailed', reason: 'invalid' }] }) }
    });
    const before = invalid.model.getCommittedSnapshot();
    const rejected = await invalid.service.save(PROJECT_PATH, { sceneId: 'S01', scene: { id: 'S01', layers: null } });
    expect(rejected.code).toBe('candidateValidationFailed');
    expect(invalid.calls).toEqual([]);
    expect(invalid.model.getCommittedSnapshot()).toEqual(before);

    const failed = harness({ cacheAdapter: cache, diskTransaction: async () => { throw new Error('disk down'); } });
    const diskResult = await failed.service.save(PROJECT_PATH, { sceneId: 'S01', scene: { id: 'S01', layers: [], marker: 'candidate' } });
    expect(diskResult).toMatchObject({ ok: false, committed: false, code: 'diskCommitFailed' });
    expect(failed.model.getCommittedSnapshot().scenes.S01.marker).toBeUndefined();
    expect(cache.get('S01')).toMatchObject({ eligible: true });
  });
  it('磁盘 commit 后内存异常从 committed disk snapshot 重建，再继续 cache 与 notify', async () => {
    const trace = [];
    const cache = new MemorySceneCacheAdapter();
    const { service, documentService, model } = harness({
      cacheAdapter: cache,
      diskTransaction: async () => { trace.push('disk'); return { ok: true, committed: true, transactionId: 'tx-memory', warnings: [] }; },
      readCommittedSnapshot: async ({ expectedSnapshot }) => { trace.push('read-disk'); return { canonical: expectedSnapshot, snapshotRevision: 9 }; },
      notifier: () => { trace.push('notify'); }
    });
    const originalCommit = documentService.commit.bind(documentService);
    documentService.commit = () => { trace.push('memory-failed'); throw new Error('memory fault'); };
    const originalRebuild = documentService.rebuildFromCommitted.bind(documentService);
    documentService.rebuildFromCommitted = (...args) => { trace.push('memory-rebuilt'); return originalRebuild(...args); };
    const originalSet = cache.set.bind(cache);
    cache.set = (...args) => { trace.push('cache'); return originalSet(...args); };

    const result = await service.save(PROJECT_PATH, { sceneId: 'S01', scene: { id: 'S01', layers: [], marker: 'disk-value' } });

    expect(trace).toEqual(['disk', 'memory-failed', 'read-disk', 'memory-rebuilt', 'cache', 'notify']);
    expect(result).toMatchObject({ ok: true, committed: true, status: 'committed-with-degradation', snapshotRevision: 9 });
    expect(model.getCommittedSnapshot().scenes.S01.marker).toBe('disk-value');
    documentService.commit = originalCommit;
  });

  it('post-commit cache failure 立即取消 fallback 资格并返回明确降级，不误报候选失败', async () => {
    const cache = new MemorySceneCacheAdapter({ S01: { sceneId: 'S01', eligible: true, canonicalData: { id: 'S01', layers: [] } } });
    cache.set = () => { throw new Error('quota exceeded'); };
    const { service, model } = harness({ cacheAdapter: cache });

    const result = await service.update(PROJECT_PATH, { sceneId: 'S01', scene: { id: 'S01', layers: [], marker: 'committed' } });

    expect(result).toMatchObject({ ok: true, committed: true, degraded: true, status: 'committed-with-degradation', code: 'committedWithDegradation' });
    expect(result.warnings).toContainEqual(expect.objectContaining({ category: 'postCommitCacheSyncFailed', sceneId: 'S01' }));
    expect(cache.get('S01')).toMatchObject({ eligible: false, ineligibleReason: 'post-commit-cache-sync-failed' });
    expect(model.getCommittedSnapshot().scenes.S01.marker).toBe('committed');
  });
});

describe('WorldMapEditor repository closure', () => {
  it.each([
    ['普通单元', 'CACHE_ONLY'],
    ['reserved 单元', { sceneId: 'CACHE_ONLY', reserved: true }]
  ])('%s 出现 cache-only ID 时整份候选拒绝', (_name, cell) => {
    const project = {
      worldMap: { regions: [{ rows: 1, cols: 2, grid: [['S01', cell]] }] }
    };
    const result = validateWorldMapRepositoryClosure(project, new Set(['S01']));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatchObject({ code: 'sceneOutsideRepositoryClosure', path: 'worldMap.regions[0].grid[0][1]' });
  });
});

describe('EditorCanonicalCandidateValidator real project', () => {
  it('当前《三国张角传》磁盘 project/order/scenes 可作为完整候选通过', () => {
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
    const project = resolveRefs(projectSource);
    const sceneOrder = JSON.parse(fs.readFileSync(path.join(root, 'assets/scenes/_scene_order.json'), 'utf8'));
    const scenes = Object.fromEntries(project.scenes.map(entry => [
      entry.id,
      JSON.parse(fs.readFileSync(path.join(root, `assets/scenes/${entry.id}.json`), 'utf8'))
    ]));

    const result = new EditorCanonicalCandidateValidator().validateAndCanonicalize({ project, sceneOrder, scenes }, {
      source: 'example/sanguo_zhangjiao/game.project.json'
    });

    expect(result.ok, result.errors?.map(error => `${error.path}: ${error.message || error.reason}`).join('\n')).toBe(true);
    expect(Object.keys(result.value.scenes)).toEqual(project.scenes.map(entry => entry.id));
  });
});
