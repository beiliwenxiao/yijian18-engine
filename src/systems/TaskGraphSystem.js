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

export const TASK_GRAPH_SCHEMA_VERSION = 1;

const NODE_TYPES = new Set(['start', 'objective', 'sequence', 'parallel', 'branch', 'complete', 'fail']);
const NODE_STATUS = new Set(['locked', 'available', 'active', 'succeeded', 'failed', 'skipped']);
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const error = (code, path, message) => ({ code, path, message });

function shallowMatch(expected = {}, actual = {}) {
  return Object.entries(expected || {}).every(([key, value]) => value === undefined || actual?.[key] === value);
}

function normalizeDefinitions(definitions = []) {
  const values = Array.isArray(definitions) ? definitions : Object.values(definitions || {});
  const errors = [];
  const map = new Map();
  for (const [index, definition] of values.entries()) {
    const path = `definitions[${index}]`;
    if (!hasText(definition?.id) || map.has(definition.id)) {
      errors.push(error('invalidTaskId', `${path}.id`, '任务 id 缺失或重复'));
      continue;
    }
    const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];
    const nodeMap = new Map();
    for (const [nodeIndex, node] of nodes.entries()) {
      const nodePath = `${path}.nodes[${nodeIndex}]`;
      if (!hasText(node?.id) || nodeMap.has(node.id)) errors.push(error('invalidTaskNodeId', `${nodePath}.id`, '节点 id 缺失或重复'));
      else if (!NODE_TYPES.has(node.type)) errors.push(error('invalidTaskNodeType', `${nodePath}.type`, '节点类型非法'));
      else nodeMap.set(node.id, clone(node));
    }
    if (!hasText(definition.entryNodeId) || !nodeMap.has(definition.entryNodeId)) {
      errors.push(error('invalidTaskEntry', `${path}.entryNodeId`, '入口节点不存在'));
    }
    for (const node of nodeMap.values()) {
      for (const targetId of node.next || []) {
        if (!nodeMap.has(targetId)) errors.push(error('invalidTaskEdge', `${path}.nodes.${node.id}.next`, `目标节点 ${targetId} 不存在`));
      }
      if (node.type === 'parallel') {
        const children = Array.isArray(node.children) ? node.children : [];
        if (children.length === 0 || children.some(id => !nodeMap.has(id))) {
          errors.push(error('invalidParallelChildren', `${path}.nodes.${node.id}.children`, '并行节点子节点不能为空且必须存在'));
        }
        const join = node.joinPolicy || 'all';
        if (!['all', 'any', 'count'].includes(join)) errors.push(error('invalidParallelJoin', `${path}.nodes.${node.id}.joinPolicy`, '并行汇合策略非法'));
        if (join === 'count' && (!Number.isInteger(node.requiredCount) || node.requiredCount < 1 || node.requiredCount > children.length)) {
          errors.push(error('invalidParallelCount', `${path}.nodes.${node.id}.requiredCount`, 'requiredCount 超出子节点范围'));
        }
      }
      if (node.type === 'branch' && (!Array.isArray(node.branches) || node.branches.length === 0)) {
        errors.push(error('invalidBranchRules', `${path}.nodes.${node.id}.branches`, '分支节点至少需要一个规则'));
      }
    }
    map.set(definition.id, {
      id: definition.id,
      title: definition.title || definition.id,
      category: definition.category || 'main',
      entryNodeId: definition.entryNodeId,
      nodes: nodeMap
    });
  }
  return { ok: errors.length === 0, errors, map };
}

/** EventJournal 的任务消费者。定义只读，实例状态和事件证据可持久化且不依赖 UI。 */
export class TaskGraphSystem {
  constructor({ definitions = [], eventJournal = null, now = () => 0 } = {}) {
    this.eventJournal = eventJournal;
    this.now = now;
    this.definitions = new Map();
    this.instances = new Map();
    this.nextInstanceSequence = 0;
    const prepared = this.prepareDefinitions(definitions);
    if (!prepared.ok) throw new TypeError(prepared.errors.map(item => `${item.path}: ${item.message}`).join('; '));
    prepared.commit();
  }

  prepareDefinitions(definitions) {
    const result = normalizeDefinitions(definitions);
    const previous = this.definitions;
    return {
      ...result,
      commit: () => { if (result.ok) this.definitions = result.map; },
      rollback: () => { this.definitions = previous; }
    };
  }

  start(definitionId, { instanceId = null, startedByEventId = null } = {}) {
    const definition = this.definitions.get(definitionId);
    if (!definition) return { ok: false, code: 'unknownTaskDefinition' };
    const id = instanceId || `task:${definitionId}:${++this.nextInstanceSequence}`;
    if (this.instances.has(id)) return { ok: true, idempotent: true, instance: clone(this.instances.get(id)) };
    const nodeStates = Object.fromEntries([...definition.nodes.keys()].map(nodeId => [nodeId, {
      status: 'locked', eventIds: [], selectedBranchId: null
    }]));
    nodeStates[definition.entryNodeId].status = 'available';
    const instance = {
      instanceId: id,
      definitionId,
      status: 'active',
      startedByEventId,
      startedLogicalTime: Math.max(0, Math.floor(Number(this.now()) || 0)),
      completedLogicalTime: null,
      nodeStates,
      eventIds: []
    };
    this.instances.set(id, instance);
    this._activateAvailable(instance, definition);
    return { ok: true, instance: clone(instance) };
  }

  consumeEvent(event = {}) {
    if (!hasText(event?.eventId) || !hasText(event?.type)) return { ok: false, code: 'invalidTaskEvent' };
    const changed = [];
    for (const instance of this.instances.values()) {
      if (instance.status !== 'active') continue;
      const definition = this.definitions.get(instance.definitionId);
      if (!definition) continue;
      for (const [nodeId, node] of definition.nodes) {
        const state = instance.nodeStates[nodeId];
        if (node.type !== 'objective' || state.status !== 'active') continue;
        if (node.eventMatcher?.type !== event.type || !shallowMatch(node.eventMatcher?.payload, event.payload)) continue;
        state.status = 'succeeded';
        state.eventIds.push(event.eventId);
        instance.eventIds.push(event.eventId);
        this._advance(instance, definition, node);
        changed.push({ instanceId: instance.instanceId, nodeId, eventId: event.eventId });
      }
      this._resolveParallelAndBranches(instance, definition);
      this._activateAvailable(instance, definition);
    }
    return { ok: true, changed };
  }

  _activateAvailable(instance, definition) {
    for (const [nodeId, state] of Object.entries(instance.nodeStates)) {
      if (state.status !== 'available') continue;
      const node = definition.nodes.get(nodeId);
      if (!node) continue;
      if (node.type === 'start' || node.type === 'sequence') {
        state.status = 'succeeded';
        this._advance(instance, definition, node);
      } else if (node.type === 'objective' || node.type === 'parallel' || node.type === 'branch') {
        state.status = 'active';
        if (node.type === 'parallel') {
          for (const childId of node.children || []) {
            if (instance.nodeStates[childId].status === 'locked') instance.nodeStates[childId].status = 'available';
          }
        }
      } else if (node.type === 'complete' || node.type === 'fail') {
        state.status = node.type === 'complete' ? 'succeeded' : 'failed';
        instance.status = node.type === 'complete' ? 'completed' : 'failed';
        instance.completedLogicalTime = Math.max(0, Math.floor(Number(this.now()) || 0));
      }
    }
  }

  _resolveParallelAndBranches(instance, definition) {
    for (const [nodeId, node] of definition.nodes) {
      const state = instance.nodeStates[nodeId];
      if (state.status !== 'active') continue;
      if (node.type === 'parallel') {
        const childStates = (node.children || []).map(childId => instance.nodeStates[childId]?.status);
        const succeeded = childStates.filter(status => status === 'succeeded').length;
        const complete = node.joinPolicy === 'any' ? succeeded >= 1
          : node.joinPolicy === 'count' ? succeeded >= node.requiredCount
            : childStates.length > 0 && succeeded === childStates.length;
        if (complete) {
          state.status = 'succeeded';
          this._advance(instance, definition, node);
        }
      }
      if (node.type === 'branch') {
        const selected = (node.branches || []).find(branch => {
          const completed = (branch.allCompleted || []).every(id => instance.nodeStates[id]?.status === 'succeeded');
          const count = branch.countCompleted;
          const countMatches = !count || (count.nodes || []).filter(id => instance.nodeStates[id]?.status === 'succeeded').length >= count.gte;
          return completed && countMatches;
        });
        if (selected?.targetNodeId) {
          state.status = 'succeeded';
          state.selectedBranchId = selected.id || selected.targetNodeId;
          this._advance(instance, definition, { ...node, next: [selected.targetNodeId] });
        }
      }
    }
  }

  _advance(instance, definition, node) {
    for (const nextId of node.next || []) {
      const next = instance.nodeStates[nextId];
      if (next?.status === 'locked') next.status = 'available';
    }
  }

  getInstance(instanceId) {
    return this.instances.has(instanceId) ? clone(this.instances.get(instanceId)) : null;
  }

  getProjection() {
    return Object.freeze([...this.instances.values()]
      .filter(instance => instance.status === 'active')
      .map(instance => {
        const definition = this.definitions.get(instance.definitionId);
        const nodes = Object.entries(instance.nodeStates)
          .filter(([, state]) => state.status === 'active' || state.status === 'available')
          .map(([nodeId, state]) => Object.freeze({
            nodeId,
            status: state.status,
            eventIds: Object.freeze([...state.eventIds])
          }));
        return Object.freeze({
          instanceId: instance.instanceId,
          definitionId: instance.definitionId,
          title: definition?.title || instance.definitionId,
          category: definition?.category || 'main',
          nodes: Object.freeze(nodes),
          startedByEventId: instance.startedByEventId || null
        });
      }));
  }

  snapshot() {
    return {
      schemaVersion: TASK_GRAPH_SCHEMA_VERSION,
      nextInstanceSequence: this.nextInstanceSequence,
      instances: [...this.instances.values()].map(clone)
    };
  }

  validate(snapshot) {
    const errors = [];
    if (!snapshot || snapshot.schemaVersion !== TASK_GRAPH_SCHEMA_VERSION) return { ok: false, errors: [error('invalidTaskGraphSchema', 'schemaVersion', '任务图快照版本不兼容')] };
    if (!Number.isInteger(snapshot.nextInstanceSequence) || snapshot.nextInstanceSequence < 0) errors.push(error('invalidTaskSequence', 'nextInstanceSequence', '任务实例序号非法'));
    if (!Array.isArray(snapshot.instances)) errors.push(error('invalidTaskInstances', 'instances', 'instances 必须是数组'));
    for (const [index, instance] of (snapshot.instances || []).entries()) {
      const definition = this.definitions.get(instance?.definitionId);
      if (!hasText(instance?.instanceId) || !definition) errors.push(error('invalidTaskInstance', `instances[${index}]`, '任务实例或定义无效'));
      for (const [nodeId, state] of Object.entries(instance?.nodeStates || {})) {
        if (!definition?.nodes.has(nodeId) || !NODE_STATUS.has(state?.status) || !Array.isArray(state?.eventIds)) {
          errors.push(error('invalidTaskNodeState', `instances[${index}].nodeStates.${nodeId}`, '任务节点状态无效'));
        }
      }
    }
    return { ok: errors.length === 0, errors };
  }

  restore(snapshot) {
    const validation = this.validate(snapshot);
    if (!validation.ok) return validation;
    this.nextInstanceSequence = snapshot.nextInstanceSequence;
    this.instances = new Map(snapshot.instances.map(instance => [instance.instanceId, clone(instance)]));
    return { ok: true, errors: [] };
  }
}

export default TaskGraphSystem;
