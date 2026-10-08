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

import { SchemaFieldEditor } from './SchemaFieldEditor.js';

const clone = value => value === undefined ? undefined : structuredClone(value);
const freeze = value => Object.freeze(clone(value));
const stableId = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._-]*$/.test(value);
const list = value => Array.isArray(value) ? value : [];
const referenceFields = Object.freeze(['prerequisites', 'triggerRefs', 'dialogueRefs', 'sceneRefs']);

function setNested(value, path, nextValue) {
  const tokens = String(path).match(/[^.\[\]]+/g) || [];
  const result = clone(value);
  let owner = result;
  tokens.forEach((token, index) => {
    const key = /^\d+$/.test(token) ? Number(token) : token;
    if (index === tokens.length - 1) owner[key] = clone(nextValue);
    else {
      const nextKey = tokens[index + 1];
      if (owner[key] == null || typeof owner[key] !== 'object') owner[key] = /^\d+$/.test(nextKey) ? [] : {};
      owner = owner[key];
    }
  });
  return result;
}

function referenceError(path, reference, kind) {
  return Object.freeze({ path, code: 'invalidReference', category: 'referenceFailed', message: `${kind} 引用不存在: ${reference}` });
}

/**
 * QuestDefinition 的薄编辑适配器：所有可写数据都通过同一 CanonicalEditorSession
 * 的 SchemaFieldEditor、CanonicalDocumentModel 与 CanonicalDocumentService 提交。
 */
export class QuestEditor {
  constructor({ canonicalSession, scenarioIndex = null, triggerGraph = null, onSaved = null } = {}) {
    if (!canonicalSession?.fields || !(canonicalSession.fields instanceof SchemaFieldEditor)) {
      throw new TypeError('QuestEditor requires a shared CanonicalEditorSession');
    }
    this.session = canonicalSession;
    this.scenarioIndex = scenarioIndex;
    this.triggerGraph = triggerGraph || scenarioIndex?.triggerGraph || null;
    this.onSaved = typeof onSaved === 'function' ? onSaved : null;
    this.selectedQuestId = null;
  }

  get model() { return this.session.model; }
  get fields() { return this.session.fields; }
  get sourceUri() { return this.session.sourceUri; }
  get canUndo() { return this.model.canUndo; }
  get canRedo() { return this.model.canRedo; }

  list() {
    return freeze(list(this._project().quests).map((quest, index) => ({
      id: quest.id, index, name: quest.name || quest.text?.name || quest.id,
      type: quest.type || 'side', objectives: list(quest.objectives).length
    })));
  }

  select(questId) {
    if (questId !== null && this._indexOf(questId) < 0) throw new Error(`未知 QuestDefinition: ${questId}`);
    this.selectedQuestId = questId;
    return this.definition(questId);
  }

  definition(questId = this.selectedQuestId) {
    const index = this._indexOf(questId);
    return index < 0 ? null : freeze(this._quests()[index]);
  }

  fieldEditor(questId = this.selectedQuestId) {
    const index = this._indexOf(questId);
    if (index < 0) throw new Error(`未知 QuestDefinition: ${questId}`);
    return new SchemaFieldEditor({
      registry: this.fields.registry, documentModel: this.model, schemaId: this.fields.schemaId,
      rootPath: `project.quests[${index}]`, catalogs: this.referenceCatalogs(),
      consumptionRegistry: this.fields.consumptionRegistry
    });
  }

  create(definition = {}) {
    const id = definition.id;
    if (!stableId(id)) throw new TypeError('QuestDefinition ID 必须是稳定安全 ID');
    if (this._indexOf(id) >= 0) throw new Error(`QuestDefinition ID 已存在: ${id}`);
    const next = { id, type: 'side', objectives: [], ...clone(definition), id };
    this._writeQuests([...this._quests(), next]);
    this.selectedQuestId = id;
    return this.definition(id);
  }

  duplicate(sourceId, newId) {
    if (!stableId(newId)) throw new TypeError('复制后的 QuestDefinition ID 必须是稳定安全 ID');
    if (this._indexOf(newId) >= 0) throw new Error(`QuestDefinition ID 已存在: ${newId}`);
    const source = this.definition(sourceId);
    if (!source) throw new Error(`未知 QuestDefinition: ${sourceId}`);
    return this.create({ ...source, id: newId, objectives: list(source.objectives).map((objective, index) => ({
      ...objective, id: objective.id || `${newId}.objective.${index + 1}`
    })) });
  }

  rename(oldId, newId) {
    if (!stableId(newId)) throw new TypeError('新的 QuestDefinition ID 必须是稳定安全 ID');
    if (this._indexOf(oldId) < 0) throw new Error(`未知 QuestDefinition: ${oldId}`);
    if (oldId !== newId && this._indexOf(newId) >= 0) throw new Error(`QuestDefinition ID 已存在: ${newId}`);
    const project = clone(this._project());
    project.quests = this._quests().map(quest => ({
      ...quest,
      id: quest.id === oldId ? newId : quest.id,
      prerequisites: list(quest.prerequisites).map(id => id === oldId ? newId : id)
    }));
    project.scenarios = list(project.scenarios).map(scenario => ({
      ...scenario, questRefs: list(scenario.questRefs).map(id => id === oldId ? newId : id)
    }));
    project.triggers = list(project.triggers).map(trigger => this._rewriteQuestActionReferences(trigger, oldId, newId));
    this.session.patch('', project);
    this.session.dirtyRootPaths.add('project');
    this.selectedQuestId = newId;
    return this.definition(newId);
  }

  delete(questId) {
    const index = this._indexOf(questId);
    if (index < 0) throw new Error(`未知 QuestDefinition: ${questId}`);
    const errors = this.referenceErrors(questId, { includeSelf: true });
    if (errors.length) return Object.freeze({ ok: false, errors });
    const quests = this._quests();
    this._writeQuests(quests.filter(quest => quest.id !== questId));
    if (this.selectedQuestId === questId) this.selectedQuestId = null;
    return Object.freeze({ ok: true, errors: [] });
  }

  patch(questId, path, value, options) {
    const index = this._indexOf(questId);
    if (index < 0) throw new Error(`未知 QuestDefinition: ${questId}`);
    try { return this.fieldEditor(questId).patch(path, value, options); }
    catch (error) {
      if (!/canonical path 不存在/.test(error.message) || options?.op === 'delete') throw error;
      const quests = this._quests();
      quests[index] = setNested(quests[index], path, value);
      return this._writeQuests(quests);
    }
  }
  patchMany(questId, operations) {
    return operations.reduce((result, operation) => this.patch(questId, operation.path, operation.value, operation), null);
  }
  undo() { return this.session.undo(); }
  redo() { return this.session.redo(); }

  referenceCatalogs() {
    const project = this._project();
    return freeze({
      prerequisites: list(project.quests).map(quest => ({ id: quest.id, name: quest.name || quest.text?.name || quest.id })),
      triggerRefs: list(project.triggers).map(trigger => ({ id: trigger.id, name: trigger.name || trigger.id })),
      dialogueRefs: list(project.dialogues).map(dialogue => ({ id: dialogue.id, name: dialogue.name || dialogue.id })),
      sceneRefs: list(project.scenes).map(scene => ({ id: scene.id, name: scene.name || scene.id }))
    });
  }

  referenceErrors(questId = this.selectedQuestId, { includeSelf = true } = {}) {
    const index = this._indexOf(questId);
    if (index < 0) return freeze([{ path: 'project.quests', code: 'missing', category: 'missing', message: `未知 QuestDefinition: ${questId}` }]);
    const project = this._project();
    const catalogs = this.referenceCatalogs();
    const errors = [];
    const quest = this._quests()[index];
    for (const field of referenceFields) {
      const allowed = new Set(list(catalogs[field]).map(item => item.id));
      list(quest[field]).forEach((reference, referenceIndex) => {
        if (!allowed.has(reference)) errors.push(referenceError(`project.quests[${index}].${field}[${referenceIndex}]`, reference, field));
      });
    }
    if (includeSelf) {
      list(project.scenarios).forEach((scenario, scenarioIndex) => list(scenario.questRefs).forEach((reference, referenceIndex) => {
        if (reference === questId) errors.push(Object.freeze({ path: `project.scenarios[${scenarioIndex}].questRefs[${referenceIndex}]`, code: 'referencedByScenario', category: 'referenceFailed', message: `任务被场景编排引用: ${scenario.id}` }));
      }));
      list(project.quests).forEach((item, itemIndex) => {
        if (itemIndex === index) return;
        list(item.prerequisites).forEach((reference, referenceIndex) => {
          if (reference === questId) errors.push(Object.freeze({ path: `project.quests[${itemIndex}].prerequisites[${referenceIndex}]`, code: 'referencedByQuest', category: 'referenceFailed', message: `任务被前置条件引用: ${item.id}` }));
        });
      });
    }
    return freeze(errors);
  }

  referenceGraph(questId = this.selectedQuestId) {
    const definition = this.definition(questId);
    if (!definition) return null;
    const scenarios = this.scenarioIndex?.all?.().filter(item => item.references.quests.includes(questId)) || [];
    return freeze({ definitionRevision: this.scenarioIndex?.definitionRevision ?? null, quest: definition,
      scenarios: scenarios.map(item => this.scenarioIndex.toEditorView(item.id)),
      triggerGraph: this.triggerGraph?.toEditorView?.() || null,
      errors: this.referenceErrors(questId) });
  }

  runtimePreview(projectionStore, { projectionType = 'questRuntime', projectionId } = {}) {
    const projection = projectionId ? projectionStore?.get?.(projectionType, projectionId) : projectionStore?.list?.(projectionType)?.[0];
    const values = list(projection?.value?.runtimes || projection?.value?.quests || (projection?.value?.quest ? [projection.value.quest] : []));
    return freeze(values.filter(value => value?.definitionId === this.selectedQuestId || value?.id === this.selectedQuestId).map(value => ({
      definitionId: value.definitionId || value.id, questRuntimeId: value.questRuntimeId || null,
      state: value.state, progress: clone(value.objectiveProgress || value.objectives || {}), remaining: value.remaining ?? null,
      repeat: clone(value.repeat ?? null), tracking: value.tracking === true || value.tracked === true,
      settlement: clone(value.rewardSettlementLedger ?? null), stateRevision: value.stateRevision ?? 0
    })));
  }

  async save(extra = {}) {
    const errors = this.list().flatMap(item => this.referenceErrors(item.id, { includeSelf: false }));
    if (errors.length) return Object.freeze({ ok: false, committed: false, code: 'candidateValidationFailed', errors });
    const result = await this.session.save({ ...extra, rootPaths: ['project.quests', 'project.scenarios', 'project.triggers'] });
    if (result?.committed) this.onSaved?.(result);
    return result;
  }

  _project() { return this.model.getCandidate().project || {}; }
  _quests() { return list(this._project().quests); }
  _indexOf(questId) { return this._quests().findIndex(quest => quest?.id === questId); }
  _writeQuests(quests) { this.session.patch('quests', quests); }
  _rewriteQuestActionReferences(value, oldId, newId) {
    const next = clone(value);
    for (const action of list(next?.do)) {
      const params = action?.params;
      if (!params || typeof params !== 'object') continue;
      for (const key of ['questId', 'questRef']) if (params[key] === oldId) params[key] = newId;
      if (Array.isArray(params.questRefs)) params.questRefs = params.questRefs.map(id => id === oldId ? newId : id);
    }
    return next;
  }
}

export default QuestEditor;
