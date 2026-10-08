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

import { cloneCanonicalValue, deepFreeze } from '../CanonicalSnapshot.js';
import { TriggerGraph } from './TriggerGraph.js';

const list = value => Array.isArray(value) ? value : [];
const refs = (value, field) => Object.freeze(list(value?.[field]).filter(id => typeof id === 'string' && id));

function recordOf(definition) {
  const references = {
    scenarios: refs(definition, 'scenarioRefs'),
    triggers: refs(definition, 'triggerRefs'),
    quests: refs(definition, 'questRefs'),
    dialogues: refs(definition, 'dialogueRefs'),
    scenes: refs(definition, 'sceneRefs'),
    commands: refs(definition, 'commandRefs')
  };
  const entryTriggerRefs = refs(definition, 'entryTriggerRefs');
  const exitTriggerRefs = refs(definition, 'exitTriggerRefs');
  return deepFreeze({
    id: definition.id,
    scope: cloneCanonicalValue(definition.scope ?? null),
    references,
    entryTriggerRefs,
    exitTriggerRefs
  });
}

/** ScenarioDefinition 的快照派生只读索引；不拥有执行、序列化或 patch 能力。 */
export class ScenarioDefinitionIndex {
  constructor(snapshot, records, triggerGraph) {
    this.definitionRevision = snapshot.definitionRevision ?? snapshot.revision;
    this._records = records;
    this.triggerGraph = triggerGraph;
    Object.freeze(this);
  }

  static empty(revision = 0) {
    const snapshot = Object.freeze({ project: Object.freeze({}), definitionRevision: revision });
    return ScenarioDefinitionIndex.fromSnapshot(snapshot);
  }

  static fromSnapshot(snapshot, { triggerGraph = null } = {}) {
    if (!snapshot?.project) throw new TypeError('ScenarioDefinitionIndex.fromSnapshot requires CanonicalSnapshot');
    const records = Object.create(null);
    for (const definition of list(snapshot.project.scenarios)) {
      if (!definition?.id) continue;
      if (records[definition.id]) throw new TypeError(`Duplicate ScenarioDefinition id: ${definition.id}`);
      records[definition.id] = recordOf(definition);
    }
    return new ScenarioDefinitionIndex(
      snapshot,
      deepFreeze(records),
      triggerGraph || TriggerGraph.fromSnapshot(snapshot)
    );
  }

  get(id) { return this._records[id] || null; }
  has(id) { return Object.prototype.hasOwnProperty.call(this._records, id); }
  ids() { return Object.freeze(Object.keys(this._records)); }
  all() { return Object.freeze(Object.values(this._records)); }
  getScope(id) { return this.get(id)?.scope ?? null; }

  getReferenceClosure(id) {
    const root = this.get(id);
    if (!root) return null;
    const scenarioIds = new Set();
    const typed = {
      triggers: new Set(), quests: new Set(), dialogues: new Set(),
      scenes: new Set(), commands: new Set()
    };
    const visit = scenarioId => {
      if (scenarioIds.has(scenarioId)) return;
      const record = this.get(scenarioId);
      if (!record) return;
      scenarioIds.add(scenarioId);
      for (const kind of Object.keys(typed)) record.references[kind].forEach(value => typed[kind].add(value));
      record.references.scenarios.forEach(visit);
    };
    visit(id);
    return deepFreeze({
      scenarios: [...scenarioIds],
      triggers: [...typed.triggers], quests: [...typed.quests],
      dialogues: [...typed.dialogues], scenes: [...typed.scenes], commands: [...typed.commands]
    });
  }

  getEntry(id) {
    const record = this.get(id);
    if (!record) return Object.freeze([]);
    return record.entryTriggerRefs.length ? record.entryTriggerRefs : (this.triggerGraph.scenario(id)?.entry || Object.freeze([]));
  }

  getExit(id) {
    const record = this.get(id);
    if (!record) return Object.freeze([]);
    return record.exitTriggerRefs.length ? record.exitTriggerRefs : (this.triggerGraph.scenario(id)?.exit || Object.freeze([]));
  }

  getReachable(id) { return this.triggerGraph.reachableFrom(this.getEntry(id)); }
  getCycles(id) {
    const members = new Set(this.get(id)?.references.triggers || []);
    return Object.freeze(this.triggerGraph.findCycles().filter(cycle => cycle.some(triggerId => members.has(triggerId))));
  }

  toEditorView(id) {
    const scenario = this.get(id);
    if (!scenario) return null;
    return deepFreeze({
      definitionRevision: this.definitionRevision,
      scenario,
      closure: this.getReferenceClosure(id),
      entry: this.getEntry(id), exit: this.getExit(id),
      reachable: this.getReachable(id), cycles: this.getCycles(id),
      triggerGraph: this.triggerGraph.toEditorView(id)
    });
  }
}

export default ScenarioDefinitionIndex;