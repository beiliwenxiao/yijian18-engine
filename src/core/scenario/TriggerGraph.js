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

const list = value => Array.isArray(value) ? value : [];
const textList = value => list(value).filter(item => typeof item === 'string' && item.trim());

function triggerReferences(trigger) {
  const refs = new Set([
    ...textList(trigger?.triggerRefs),
    ...textList(trigger?.nextTriggerRefs)
  ]);
  for (const action of list(trigger?.do)) {
    const params = action?.params || {};
    for (const field of ['triggerId', 'triggerRef', 'nextTriggerId', 'onSuccessTriggerId', 'onFailureTriggerId']) {
      if (typeof params[field] === 'string' && params[field]) refs.add(params[field]);
    }
    textList(params.triggerRefs).forEach(id => refs.add(id));
  }
  return [...refs];
}

/** CanonicalSnapshot 派生的只读 Trigger 引用图；不执行且不持久化。 */
export class TriggerGraph {
  constructor({ revision, nodes, edges, incoming, scenarios }) {
    this.definitionRevision = revision;
    this._nodes = nodes;
    this._edges = edges;
    this._incoming = incoming;
    this._scenarios = scenarios;
    Object.freeze(this);
  }

  static fromSnapshot(snapshot) {
    if (!snapshot?.project) throw new TypeError('TriggerGraph.fromSnapshot requires CanonicalSnapshot');
    const definitions = list(snapshot.project.triggers);
    const nodes = Object.create(null);
    const edges = Object.create(null);
    const incoming = Object.create(null);
    for (const definition of definitions) {
      if (!definition?.id) continue;
      nodes[definition.id] = deepFreeze(cloneCanonicalValue(definition));
      edges[definition.id] = [];
      incoming[definition.id] = [];
    }
    for (const definition of definitions) {
      if (!nodes[definition?.id]) continue;
      const targets = triggerReferences(definition).filter(id => nodes[id]);
      edges[definition.id] = Object.freeze([...new Set(targets)]);
      for (const target of edges[definition.id]) incoming[target].push(definition.id);
    }
    for (const id of Object.keys(incoming)) incoming[id] = Object.freeze([...new Set(incoming[id])]);

    const scenarios = Object.create(null);
    for (const scenario of list(snapshot.project.scenarios)) {
      if (!scenario?.id) continue;
      const members = textList(scenario.triggerRefs).filter(id => nodes[id]);
      const explicitEntry = textList(scenario.entryTriggerRefs).filter(id => members.includes(id));
      const explicitExit = textList(scenario.exitTriggerRefs).filter(id => members.includes(id));
      const memberSet = new Set(members);
      const entry = explicitEntry.length ? explicitEntry : members.filter(id => !incoming[id].some(source => memberSet.has(source)));
      const exit = explicitExit.length ? explicitExit : members.filter(id => !edges[id].some(target => memberSet.has(target)));
      scenarios[scenario.id] = deepFreeze({
        id: scenario.id,
        scope: cloneCanonicalValue(scenario.scope ?? null),
        members,
        entry,
        exit
      });
    }
    return new TriggerGraph({
      revision: snapshot.definitionRevision ?? snapshot.revision,
      nodes: deepFreeze(nodes), edges: deepFreeze(edges), incoming: deepFreeze(incoming),
      scenarios: deepFreeze(scenarios)
    });
  }

  get(id) { return this._nodes[id] || null; }
  has(id) { return Object.prototype.hasOwnProperty.call(this._nodes, id); }
  ids() { return Object.freeze(Object.keys(this._nodes)); }
  successors(id) { return this._edges[id] || Object.freeze([]); }
  predecessors(id) { return this._incoming[id] || Object.freeze([]); }
  scenario(id) { return this._scenarios[id] || null; }

  reachableFrom(startIds = []) {
    const visited = new Set();
    const queue = textList(startIds).filter(id => this.has(id));
    while (queue.length) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      for (const target of this.successors(id)) if (!visited.has(target)) queue.push(target);
    }
    return Object.freeze([...visited]);
  }

  findCycles() {
    const cycles = [];
    const active = new Set();
    const visited = new Set();
    const stack = [];
    const canonical = new Set();
    const visit = id => {
      if (active.has(id)) {
        const cycle = stack.slice(stack.indexOf(id)).concat(id);
        const body = cycle.slice(0, -1);
        const rotations = body.map((_, index) => body.slice(index).concat(body.slice(0, index)));
        const normalized = rotations.map(value => value.join('\u0000')).sort()[0];
        if (!canonical.has(normalized)) {
          canonical.add(normalized);
          cycles.push(Object.freeze(cycle));
        }
        return;
      }
      if (visited.has(id)) return;
      active.add(id); stack.push(id);
      for (const target of this.successors(id)) visit(target);
      stack.pop(); active.delete(id); visited.add(id);
    };
    this.ids().forEach(visit);
    return Object.freeze(cycles);
  }

  toEditorView(scenarioId = null) {
    const scenario = scenarioId ? this.scenario(scenarioId) : null;
    const ids = scenario ? scenario.members : this.ids();
    return deepFreeze({
      definitionRevision: this.definitionRevision,
      scenario,
      nodes: ids.map(id => ({ id, definition: this.get(id), successors: this.successors(id), predecessors: this.predecessors(id) })),
      cycles: this.findCycles()
    });
  }
}

export default TriggerGraph;