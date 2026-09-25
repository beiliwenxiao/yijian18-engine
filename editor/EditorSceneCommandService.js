/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

import { ProjectWorldIndex } from '../src/core/ProjectWorldIndex.js';
import { CanonicalSceneValidator } from '../src/core/scene/CanonicalSceneValidation.js';
import { CanonicalCandidatePipeline } from '../src/core/validation/CanonicalCandidatePipeline.js';
import { CandidateRuleValidator } from '../src/core/validation/CandidateRuleValidator.js';
import { createContentValidator } from '../src/core/validation/ContentSchemas.js';
import { createStandardConfigConsumptionRegistry } from '../src/core/ConfigConsumptionRegistry.js';
import { commitCanonicalChanges } from './CanonicalTransactionClient.js';
import { splitShardedProject } from '../src/core/projectShards.js';

const COMMANDS = new Set(['create', 'update', 'rename', 'delete', 'import', 'save']);
const SCALAR_SCENE_REFS = new Set([
  'sceneId', 'entrySceneId', 'currentSceneId', 'targetSceneId', 'nextSceneId',
  'destinationSceneId', 'sourceSceneId', 'fromSceneId', 'toSceneId',
  'chunkId', 'currentChunkId', 'targetChunkId'
]);
const ARRAY_SCENE_REFS = new Set(['sceneIds', 'sceneRefs', 'unlockedScenes', 'completedScenes']);

const clone = value => value === undefined ? undefined : structuredClone(value);
const normalizePath = value => String(value || '').replace(/\\/g, '/').replace(/^(?:\.\.\/)+/, '').replace(/^\/+/, '');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

function projectInfo(projectPath) {
  const normalized = normalizePath(projectPath);
  if (!normalized.endsWith('/game.project.json')) throw new TypeError(`projectPath 无效: ${normalized}`);
  const root = normalized.slice(0, -'/game.project.json'.length);
  return {
    projectPath: normalized,
    projectRoot: root,
    sceneRoot: `${root}/assets/scenes/`,
    orderPath: `${root}/assets/scenes/_scene_order.json`
  };
}

/** 项目写入统一入口：shards 分片工程按声明路由主文件与分片文件；无声明退化为单文件替换。 */
function projectChanges(info, project) {
  const { main, shards } = splitShardedProject(project);
  return [
    { operation: 'replace', path: info.projectPath, content: json(main) },
    ...Object.entries(shards).map(([shardRel, value]) => ({
      operation: 'replace',
      path: `${info.projectRoot}/${shardRel}`,
      content: json(value)
    }))
  ];
}

function validationError(path, reason, category = 'referenceFailed', code = 'invalidReference') {
  return { path, reason, message: reason, category, code };
}

function validSceneId(sceneId) {
  return typeof sceneId === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(sceneId);
}
function rewriteReferences(value, oldId, newId, path = '', parentKey = '') {
  if (Array.isArray(value)) {
    return value.map((child, index) => {
      const childPath = `${path}[${index}]`;
      if ((ARRAY_SCENE_REFS.has(parentKey) || path.includes('.grid')) && child === oldId) return newId;
      return rewriteReferences(child, oldId, newId, childPath, parentKey);
    });
  }
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (SCALAR_SCENE_REFS.has(key) && child === oldId) result[key] = newId;
    else result[key] = rewriteReferences(child, oldId, newId, childPath, key);
  }
  return result;
}

function findReferences(value, sceneId, path = '', parentKey = '', errors = []) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => {
      const childPath = `${path}[${index}]`;
      if ((ARRAY_SCENE_REFS.has(parentKey) || path.includes('.grid')) && child === sceneId) {
        errors.push(validationError(childPath, `场景 ${sceneId} 仍被引用`));
      } else findReferences(child, sceneId, childPath, parentKey, errors);
    });
    return errors;
  }
  if (!value || typeof value !== 'object') return errors;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (SCALAR_SCENE_REFS.has(key) && child === sceneId) {
      errors.push(validationError(childPath, `场景 ${sceneId} 仍被引用`));
    } else findReferences(child, sceneId, childPath, key, errors);
  }
  return errors;
}

function makeProjectEntry(scene, supplied = {}) {
  const entry = { id: scene.id, name: scene.name || scene.id, ...clone(supplied), id: scene.id };
  if (Number.isInteger(scene.width) && scene.width > 0) entry.width = scene.width;
  if (Number.isInteger(scene.height) && scene.height > 0) entry.height = scene.height;
  return entry;
}

function candidateSceneDimensions(scenes = {}) {
  return new Map(Object.entries(scenes).map(([sceneId, scene]) => [sceneId, {
    width: scene?.width,
    height: scene?.height
  }]));
}

function makeOrderEntry(scene, supplied = {}) {
  return { name: scene.name || scene.id, type: scene.type || 'terrain', ...clone(supplied) };
}

/** 完整项目候选的 schema/reference/business-rule/canonicalize 聚合器。 */
export class EditorCanonicalCandidateValidator {
  constructor({ projectPipeline = null, sceneValidator = null, configConsumptionRegistry = null } = {}) {
    const contentValidator = createContentValidator();
    this.projectPipeline = projectPipeline || new CanonicalCandidatePipeline({
      contentValidator,
      ruleValidator: new CandidateRuleValidator({ contentValidator })
    });
    this.sceneValidator = sceneValidator || new CanonicalSceneValidator();
    this.configConsumptionRegistry = configConsumptionRegistry || createStandardConfigConsumptionRegistry();
  }

  validateAndCanonicalize(candidate, { source = '<editor-candidate>' } = {}) {
    const errors = [];
    const projectResult = this.projectPipeline.process(candidate?.project, { schemaId: 'gameProject', source });
    if (!projectResult.ok) errors.push(...projectResult.errors);
    const project = projectResult.ok ? projectResult.value : candidate?.project;

    const orderResult = this.sceneValidator.validateSceneOrder(candidate?.sceneOrder, {
      source: `${source}#sceneOrder`, project
    });
    if (!orderResult.ok) errors.push(...orderResult.errors);
    const sceneOrder = orderResult.ok ? orderResult.value : candidate?.sceneOrder;
    const projectIds = (project?.scenes || []).map(entry => entry?.id).filter(Boolean);
    const orderIds = Object.keys(sceneOrder?.scenes || {});
    const sceneIds = Object.keys(candidate?.scenes || {});
    const closure = new Set(projectIds);
    for (const [label, ids] of [['sceneOrder.scenes', orderIds], ['scenes', sceneIds]]) {
      for (const id of ids) if (!closure.has(id)) errors.push(validationError(`${label}.${id}`, `ID 未在项目 closure 登记: ${id}`));
      for (const id of projectIds) if (!ids.includes(id)) errors.push(validationError(`${label}.${id}`, `项目场景缺少 canonical 文档: ${id}`, 'missing', 'missing'));
    }
    for (const [index, id] of (sceneOrder?.order || []).entries()) {
      if (!closure.has(id)) errors.push(validationError(`sceneOrder.order[${index}]`, `排序 ID 未在项目 closure 登记: ${id}`));
    }

    const scenes = {};
    for (const sceneId of sceneIds) {
      const result = this.sceneValidator.validateScene(candidate.scenes[sceneId], {
        source: `${source}#scenes.${sceneId}`, sceneId, project
      });
      if (!result.ok) errors.push(...result.errors);
      else scenes[sceneId] = result.value;
    }
    if (project?.worldMap) {
      try {
        ProjectWorldIndex.build(project, {
          sceneDimensions: candidateSceneDimensions(scenes),
          requireSceneDimensions: true
        });
      } catch (error) {
        errors.push(...(error.errors || [validationError('worldMap', error.message, 'businessRuleFailed', 'invalidProjectWorld')]));
      }
    }
    if (errors.length === 0) {
      try {
        this.configConsumptionRegistry.buildSources({ project }, {
          requirements: project?.consumptionRequirements,
          revision: candidate?.snapshotRevision || 0
        });
        for (const scene of Object.values(scenes)) {
          this.configConsumptionRegistry.buildSources({ scene }, { revision: candidate?.snapshotRevision || 0 });
        }
      } catch (error) {
        errors.push(...(error.errors || [validationError('', error.message, 'businessRuleFailed', 'configConsumptionUnproven')]));
      }
    }
    if (errors.length > 0) return { ok: false, committed: false, errors, value: null };
    return { ok: true, committed: false, errors: [], value: { project, sceneOrder, scenes } };
  }
}

/** 六类场景编辑命令的唯一提交链。 */
export class EditorSceneCommandService {
  constructor({
    documentService,
    validator = new EditorCanonicalCandidateValidator(),
    diskTransaction = commitCanonicalChanges,
    cacheAdapter = null,
    notifier = null,
    readCommittedSnapshot = null,
    now = () => Date.now()
  } = {}) {
    if (!documentService) throw new TypeError('EditorSceneCommandService requires documentService');
    if (typeof diskTransaction !== 'function') throw new TypeError('EditorSceneCommandService requires diskTransaction');
    this.documentService = documentService;
    this.validator = validator;
    this.diskTransaction = diskTransaction;
    this.cacheAdapter = cacheAdapter;
    this.notifier = notifier;
    this.readCommittedSnapshot = readCommittedSnapshot;
    this.now = now;
    this._queues = new Map();
  }

  create(projectPath, payload) { return this.execute('create', projectPath, payload); }
  update(projectPath, payload) { return this.execute('update', projectPath, payload); }
  rename(projectPath, payload) { return this.execute('rename', projectPath, payload); }
  delete(projectPath, payload) { return this.execute('delete', projectPath, payload); }
  import(projectPath, payload) { return this.execute('import', projectPath, payload); }
  save(projectPath, payload) { return this.execute('save', projectPath, payload); }

  execute(command, projectPath, payload = {}) {
    if (!COMMANDS.has(command)) return Promise.resolve({ ok: false, committed: false, status: 'rejected', code: 'unknownEditorCommand', errors: [] });
    const key = normalizePath(projectPath);
    const previous = this._queues.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(() => this._execute(command, key, payload));
    this._queues.set(key, current);
    return current.finally(() => { if (this._queues.get(key) === current) this._queues.delete(key); });
  }
  _prepare(command, projectPath, payload) {
    const info = projectInfo(projectPath);
    const model = this.documentService.requireProject(projectPath);
    let candidate = model.getCandidate();
    const changedSceneIds = new Set();
    const changedRootPaths = new Set(payload.rootPaths || []);
    let removedSceneId = null;
    let sceneId = payload.sceneId || payload.scene?.id;

    // Schema-aware editors have already patched the one shared working copy. They submit
    // only affected root paths; complete-candidate validation still runs below before disk.
    if (command === 'save' && changedRootPaths.size > 0) {
      return { info, model, candidate, changedSceneIds, changedRootPaths, removedSceneId, sceneId };
    }

    if (command === 'create' || command === 'import') {
      const scene = typeof payload.scene === 'string' ? JSON.parse(payload.scene) : clone(payload.scene);
      sceneId = scene?.id;
      if (!validSceneId(sceneId)) return { errors: [validationError('scene.id', '场景 ID 必须是安全的稳定 ID', 'schemaFailed', 'invalidSceneId')] };
      if (candidate.scenes?.[sceneId]) return { errors: [validationError(`scenes.${sceneId}`, `场景已存在: ${sceneId}`, 'referenceFailed', 'duplicateId')] };
      candidate.scenes = { ...(candidate.scenes || {}), [sceneId]: scene };
      candidate.project.scenes = [...(candidate.project.scenes || []), makeProjectEntry(scene, payload.projectEntry)];
      candidate.sceneOrder.scenes = { ...(candidate.sceneOrder.scenes || {}), [sceneId]: makeOrderEntry(scene, payload.orderEntry) };
      candidate.sceneOrder.order = [...(candidate.sceneOrder.order || []), sceneId];
      changedSceneIds.add(sceneId);
    } else if (command === 'update' || command === 'save') {
      if (payload.sceneOrder) {
        candidate.sceneOrder = clone(payload.sceneOrder);
      } else {
        if (!validSceneId(sceneId) || !candidate.scenes?.[sceneId]) {
          return { errors: [validationError(`scenes.${String(sceneId)}`, `场景不存在: ${String(sceneId)}`, 'missing', 'missing')] };
        }
        candidate.scenes[sceneId] = clone(payload.scene || candidate.scenes[sceneId]);
        candidate.scenes[sceneId].id = sceneId;
        candidate.project.scenes = candidate.project.scenes.map(entry => (
          entry?.id === sceneId ? makeProjectEntry(candidate.scenes[sceneId], entry) : entry
        ));
        if (payload.orderEntry) {
          candidate.sceneOrder.scenes[sceneId] = {
            ...candidate.sceneOrder.scenes[sceneId],
            ...clone(payload.orderEntry)
          };
        }
        changedSceneIds.add(sceneId);
      }
    } else if (command === 'rename') {
      const oldId = payload.oldId;
      const newId = payload.newId;
      sceneId = newId;
      if (!validSceneId(newId)) return { errors: [validationError('newId', '新场景 ID 必须是安全的稳定 ID', 'schemaFailed', 'invalidSceneId')] };
      if (!candidate.scenes?.[oldId]) return { errors: [validationError(`scenes.${oldId}`, `场景不存在: ${oldId}`, 'missing', 'missing')] };
      if (candidate.scenes[newId]) return { errors: [validationError(`scenes.${newId}`, `场景已存在: ${newId}`, 'referenceFailed', 'duplicateId')] };
      const beforeScenes = candidate.scenes;
      candidate = rewriteReferences(candidate, oldId, newId);
      candidate.project.scenes = candidate.project.scenes.map(entry => entry?.id === oldId ? { ...entry, id: newId } : entry);
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
    } else if (command === 'delete') {
      if (!validSceneId(sceneId) || !candidate.scenes?.[sceneId]) return { errors: [validationError(`scenes.${String(sceneId)}`, `场景不存在: ${String(sceneId)}`, 'missing', 'missing')] };
      const references = findReferences(candidate.project, sceneId, 'project');
      for (const [id, scene] of Object.entries(candidate.scenes)) {
        if (id !== sceneId) findReferences(scene, sceneId, `scenes.${id}`, '', references);
      }
      if (references.length > 0) return { errors: references };
      candidate.project.scenes = candidate.project.scenes.filter(entry => entry?.id !== sceneId);
      candidate.sceneOrder.order = candidate.sceneOrder.order.filter(id => id !== sceneId);
      delete candidate.sceneOrder.scenes[sceneId];
      delete candidate.scenes[sceneId];
      removedSceneId = sceneId;
    }
    return { info, model, candidate, changedSceneIds, changedRootPaths, removedSceneId, sceneId };
  }
  _changesFor(command, prepared, canonical, payload) {
    const { info, changedSceneIds, changedRootPaths = new Set(), removedSceneId, sceneId } = prepared;
    const changes = [];
    if (command === 'save' && changedRootPaths.size > 0) {
      if ([...changedRootPaths].some(path => path === 'project' || path.startsWith('project.'))) {
        changes.push(...projectChanges(info, canonical.project));
      }
      if ([...changedRootPaths].some(path => path === 'sceneOrder' || path.startsWith('sceneOrder.'))) {
        changes.push({ operation: 'replace', path: info.orderPath, content: json(canonical.sceneOrder) });
      }
      const rootSceneIds = new Set([...changedRootPaths]
        .map(path => /^scenes\.([^.\[]+)/.exec(path)?.[1]).filter(Boolean));
      for (const id of rootSceneIds) {
        if (canonical.scenes[id]) changes.push({
          operation: 'replace', path: `${info.sceneRoot}${id}.json`, content: json(canonical.scenes[id])
        });
      }
      return changes;
    }
    if (['create', 'import', 'rename', 'delete'].includes(command)) {
      changes.push(...projectChanges(info, canonical.project));
      changes.push({ operation: 'replace', path: info.orderPath, content: json(canonical.sceneOrder) });
    }
    if (command === 'create' || command === 'import') {
      changes.push({ operation: 'create', path: `${info.sceneRoot}${sceneId}.json`, content: json(canonical.scenes[sceneId]) });
    } else if (command === 'rename') {
      for (const id of changedSceneIds) {
        if (id === sceneId) continue;
        changes.push({ operation: 'replace', path: `${info.sceneRoot}${id}.json`, content: json(canonical.scenes[id]) });
      }
      changes.push({
        operation: 'rename',
        from: normalizePath(payload.sourceUri || `${info.sceneRoot}${removedSceneId}.json`),
        path: `${info.sceneRoot}${sceneId}.json`,
        content: json(canonical.scenes[sceneId])
      });
    } else if (command === 'delete') {
      changes.push({ operation: 'delete', path: normalizePath(payload.sourceUri || `${info.sceneRoot}${removedSceneId}.json`) });
    } else {
      if (payload.sceneOrder || payload.orderEntry) {
        changes.push({ operation: 'replace', path: info.orderPath, content: json(canonical.sceneOrder) });
      }
      if (sceneId) {
        changes.push(...projectChanges(info, canonical.project));
        changes.push({
          operation: 'replace',
          path: normalizePath(payload.sourceUri || `${info.sceneRoot}${sceneId}.json`),
          content: json(canonical.scenes[sceneId])
        });
      }
    }
    return changes;
  }

  async _execute(command, projectPath, payload) {
    let prepared;
    try { prepared = this._prepare(command, projectPath, payload); }
    catch (error) {
      return { ok: false, committed: false, status: 'rejected', code: 'candidatePreparationFailed', errors: [validationError('', error.message, 'parseFailed', 'candidatePreparationFailed')] };
    }
    if (prepared.errors) return { ok: false, committed: false, status: 'rejected', code: 'candidateValidationFailed', errors: prepared.errors };

    const validation = this.validator.validateAndCanonicalize(prepared.candidate, { source: projectPath });
    if (!validation.ok) return { ok: false, committed: false, status: 'rejected', code: 'candidateValidationFailed', errors: validation.errors };
    const canonical = validation.value;
    const changes = this._changesFor(command, prepared, canonical, payload);

    let transaction;
    try {
      transaction = await this.diskTransaction(projectPath, changes);
      if (!transaction?.ok || transaction.committed !== true) throw Object.assign(new Error(transaction?.error || '磁盘提交失败'), { result: transaction });
    } catch (error) {
      return {
        ok: false, committed: false, status: 'failed', code: error.result?.category || error.result?.code || 'diskCommitFailed',
        errors: error.result?.errors || [], error
      };
    }

    const warnings = [...(transaction.warnings || [])];
    let revision = prepared.model.snapshotRevision + 1;
    try {
      this.documentService.commit(projectPath, canonical, { snapshotRevision: revision });
    } catch (memoryError) {
      warnings.push({ category: 'committedMemoryUpdateFailed', message: memoryError.message });
      try {
        if (typeof this.readCommittedSnapshot !== 'function') throw new Error('缺少 readCommittedSnapshot');
        const diskSnapshot = await this.readCommittedSnapshot({ projectPath, transaction, expectedSnapshot: canonical });
        revision = diskSnapshot.snapshotRevision ?? revision;
        this.documentService.rebuildFromCommitted(projectPath, diskSnapshot.canonical || diskSnapshot, { snapshotRevision: revision });
      } catch (rebuildError) {
        warnings.push({ category: 'committedMemoryRebuildFailed', message: rebuildError.message });
      }
    }

    warnings.push(...this._synchronizeCache(command, prepared, canonical, transaction));
    let result = {
      ok: true, committed: true, status: warnings.length > 0 ? 'committed-with-degradation' : 'committed',
      code: warnings.length > 0 ? 'committedWithDegradation' : 'committed',
      degraded: warnings.length > 0, warnings, errors: [], transactionId: transaction.transactionId,
      snapshotRevision: revision, value: canonical, changes
    };
    if (typeof this.notifier === 'function') {
      try { await this.notifier({ type: 'editorCanonicalCommitted', command, projectPath, result }); }
      catch (error) {
        result.warnings.push({ category: 'postCommitNotificationFailed', message: error.message });
        result = { ...result, status: 'committed-with-degradation', code: 'committedWithDegradation', degraded: true };
      }
    }
    return result;
  }

  _cacheEntry(sceneId, scene, info, transaction, projectSchemaVersion) {
    return {
      sceneId,
      source: `${info.sceneRoot}${sceneId}.json`,
      canonicalData: clone(scene),
      diskRevision: transaction.transactionId || null,
      schemaVersion: scene.schemaVersion ?? projectSchemaVersion,
      validatorFingerprint: this.validator.sceneValidator?.fingerprint || 'editor-canonical-candidate',
      refreshedAt: this.now(),
      eligible: true
    };
  }

  _synchronizeCache(command, prepared, canonical, transaction) {
    if (!this.cacheAdapter) return [];
    const warnings = [];
    const attempt = (sceneId, operation) => {
      try { operation(); }
      catch (error) {
        try { this.cacheAdapter.markIneligible?.(sceneId, 'post-commit-cache-sync-failed'); } catch (_ignored) { /* best effort */ }
        warnings.push({ category: 'postCommitCacheSyncFailed', sceneId, message: error.message });
      }
    };
    if (prepared.removedSceneId) attempt(prepared.removedSceneId, () => this.cacheAdapter.delete(prepared.removedSceneId));
    const sceneIds = new Set(prepared.changedSceneIds);
    for (const rootPath of prepared.changedRootPaths || []) {
      const sceneId = /^scenes\.([^.\[]+)/.exec(rootPath)?.[1];
      if (sceneId) sceneIds.add(sceneId);
    }
    for (const sceneId of sceneIds) {
      const scene = canonical.scenes[sceneId];
      if (scene) attempt(sceneId, () => this.cacheAdapter.set(
        sceneId,
        this._cacheEntry(sceneId, scene, prepared.info, transaction, canonical.project.schemaVersion)
      ));
    }
    return warnings;
  }
}

export { findReferences as findCanonicalSceneReferences, rewriteReferences as rewriteCanonicalSceneReferences };
export default EditorSceneCommandService;
