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

export const TASK_NODE_TYPES = Object.freeze([
  'start', 'objective', 'sequence', 'parallel', 'branch', 'complete', 'fail'
]);
const NODE_TYPES = new Set(TASK_NODE_TYPES);
const NODE_STATUS = new Set(['locked', 'available', 'active', 'succeeded', 'failed', 'skipped']);
const INSTANCE_STATUS = new Set(['active', 'completed', 'failed', 'cancelled']);
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const issue = (errors, code, path, message) => errors.push({ code, path, message });

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function shallowMatch(expected = {}, actual = {}) {
  return Object.entries(expected || {}).every(([key, value]) => (
    value === undefined || JSON.stringify(stableValue(actual?.[key])) === JSON.stringify(stableValue(value))
  ));
}

function nodeTargets(node) {
  return [
    ...(Array.isArray(node?.next) ? node.next : []),
    ...(node?.type === 'parallel' && Array.isArray(node.children) ? node.children : []),
    ...(node?.type === 'branch' && Array.isArray(node.branches)
      ? node.branches.map(branch => branch?.targetNodeId).filter(Boolean)
      : [])
  ];
}

function serializableDefinition(definition) {
  return {
    id: definition.id,
    title: definition.title,
    description: definition.description || '',
    category: definition.category,
    entryNodeId: definition.entryNodeId,
    reward: clone(definition.reward || {}),
    checkpoint: clone(definition.checkpoint || null),
    nodes: [...definition.nodes.values()].map(clone)
  };
}

/** TaskGraph 定义唯一校验器；运行时、ContentValidator 与编辑器应复用。 */
export function validateTaskGraphDefinitions(definitions = []) {
  const values = Array.isArray(definitions) ? definitions : Object.values(definitions || {});
  const errors = [];
  const map = new Map();
  for (const [index, raw] of values.entries()) {
    const path = `taskGraphs[${index}]`;
    if (!hasText(raw?.id) || map.has(raw.id)) {
      issue(errors, 'invalidTaskId', `${path}.id`, '任务 id 缺失或重复');
      continue;
    }
    const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
    const nodeMap = new Map();
    for (const [nodeIndex, node] of nodes.entries()) {
      const nodePath = `${path}.nodes[${nodeIndex}]`;
      if (!hasText(node?.id) || nodeMap.has(node.id)) {
        issue(errors, 'invalidTaskNodeId', `${nodePath}.id`, '节点 id 缺失或重复');
        continue;
      }
      if (!NODE_TYPES.has(node.type)) {
        issue(errors, 'invalidTaskNodeType', `${nodePath}.type`, '节点类型非法');
        continue;
      }
      if (node.next !== undefined && (!Array.isArray(node.next) || node.next.some(id => !hasText(id)))) {
        issue(errors, 'invalidTaskEdges', `${nodePath}.next`, 'next 必须是稳定节点 ID 数组');
      }
      if (node.type === 'objective') {
        if (!hasText(node.eventMatcher?.type)) issue(errors, 'invalidTaskEventMatcher', `${nodePath}.eventMatcher.type`, '目标节点必须声明事件类型');
        if (node.eventMatcher?.payload !== undefined
          && (!node.eventMatcher.payload || typeof node.eventMatcher.payload !== 'object' || Array.isArray(node.eventMatcher.payload))) {
          issue(errors, 'invalidTaskEventMatcher', `${nodePath}.eventMatcher.payload`, '事件 payload matcher 必须是对象');
        }
        if (node.requiredCount !== undefined
          && (!Number.isInteger(node.requiredCount) || node.requiredCount < 1)) {
          issue(errors, 'invalidTaskObjectiveCount', `${nodePath}.requiredCount`, '目标数量必须为正整数');
        }
        if (node.progressBy !== undefined && !hasText(node.progressBy)) {
          issue(errors, 'invalidTaskProgressBy', `${nodePath}.progressBy`, 'progressBy 必须为非空的事件数量字段名');
        }
      }
      if (node.mapTarget !== undefined) {
        const target = node.mapTarget;
        const hasTargetId = hasText(target?.targetId);
        const hasCoordinates = Number.isFinite(Number(target?.x)) && Number.isFinite(Number(target?.y));
        if (!target || typeof target !== 'object' || Array.isArray(target) || !hasText(target.sceneId)
          || (!hasTargetId && !hasCoordinates)) {
          issue(errors, 'invalidTaskMapTarget', `${nodePath}.mapTarget`, 'mapTarget 必须包含 sceneId，并提供 targetId 或有限 x/y 坐标');
        }
      }
      nodeMap.set(node.id, clone(node));
    }
    if (!hasText(raw.entryNodeId) || !nodeMap.has(raw.entryNodeId)) {
      issue(errors, 'invalidTaskEntry', `${path}.entryNodeId`, '入口节点不存在');
    }
    if (![...nodeMap.values()].some(node => node.type === 'complete' || node.type === 'fail')) {
      issue(errors, 'missingTaskTerminal', `${path}.nodes`, '任务图至少需要一个 complete 或 fail 终点');
    }
    for (const node of nodeMap.values()) {
      for (const targetId of nodeTargets(node)) {
        if (!nodeMap.has(targetId)) issue(errors, 'invalidTaskEdge', `${path}.nodes.${node.id}`, `目标节点 ${targetId} 不存在`);
      }
      if (node.type === 'parallel') {
        const children = Array.isArray(node.children) ? node.children : [];
        if (children.length === 0 || new Set(children).size !== children.length) {
          issue(errors, 'invalidParallelChildren', `${path}.nodes.${node.id}.children`, '并行子节点不能为空或重复');
        }
        const join = node.joinPolicy || 'all';
        if (!['all', 'any', 'count'].includes(join)) issue(errors, 'invalidParallelJoin', `${path}.nodes.${node.id}.joinPolicy`, '并行汇合策略非法');
        if (join === 'count' && (!Number.isInteger(node.requiredCount) || node.requiredCount < 1 || node.requiredCount > children.length)) {
          issue(errors, 'invalidParallelCount', `${path}.nodes.${node.id}.requiredCount`, 'requiredCount 超出子节点范围');
        }
      }
      if (node.type === 'branch') {
        const branches = Array.isArray(node.branches) ? node.branches : [];
        if (branches.length === 0) issue(errors, 'invalidBranchRules', `${path}.nodes.${node.id}.branches`, '分支节点至少需要一个规则');
        const branchIds = new Set();
        const ruleFingerprints = new Set();
        for (const [branchIndex, branch] of branches.entries()) {
          const branchPath = `${path}.nodes.${node.id}.branches[${branchIndex}]`;
          if (!hasText(branch?.id) || branchIds.has(branch.id)) issue(errors, 'invalidBranchId', `${branchPath}.id`, '分支 id 缺失或重复');
          branchIds.add(branch?.id);
          if (!hasText(branch?.targetNodeId) || !nodeMap.has(branch.targetNodeId)) issue(errors, 'invalidBranchTarget', `${branchPath}.targetNodeId`, '分支目标不存在');
          for (const reference of branch?.allCompleted || []) {
            if (!nodeMap.has(reference)) issue(errors, 'invalidBranchReference', `${branchPath}.allCompleted`, `节点 ${reference} 不存在`);
          }
          const count = branch?.countCompleted;
          if (count) {
            if (!Array.isArray(count.nodes) || count.nodes.some(reference => !nodeMap.has(reference))
              || !Number.isInteger(count.gte) || count.gte < 1 || count.gte > count.nodes.length) {
              issue(errors, 'invalidBranchCount', `${branchPath}.countCompleted`, 'countCompleted 配置非法');
            }
          }
          const ruleFingerprint = JSON.stringify(stableValue({
            allCompleted: branch?.allCompleted || [], countCompleted: count || null
          }));
          if (ruleFingerprints.has(ruleFingerprint)) issue(errors, 'duplicateBranchRule', branchPath, '分支条件重复，后续规则永远不可达');
          ruleFingerprints.add(ruleFingerprint);
        }
      }
    }
    if (nodeMap.has(raw.entryNodeId)) {
      const reachable = new Set();
      const visiting = new Set();
      const visited = new Set();
      const walk = nodeId => {
        if (visiting.has(nodeId)) {
          issue(errors, 'unboundedTaskCycle', `${path}.nodes.${nodeId}`, '任务图存在无界循环');
          return;
        }
        if (visited.has(nodeId)) return;
        visiting.add(nodeId);
        reachable.add(nodeId);
        for (const targetId of nodeTargets(nodeMap.get(nodeId))) if (nodeMap.has(targetId)) walk(targetId);
        visiting.delete(nodeId);
        visited.add(nodeId);
      };
      walk(raw.entryNodeId);
      for (const nodeId of nodeMap.keys()) {
        if (!reachable.has(nodeId)) issue(errors, 'unreachableTaskNode', `${path}.nodes.${nodeId}`, '节点从入口不可达');
      }
    }
    map.set(raw.id, {
      id: raw.id,
      title: raw.title || raw.id,
      description: raw.description || '',
      category: raw.category || 'main',
      entryNodeId: raw.entryNodeId,
      reward: clone(raw.reward || {}),
      checkpoint: clone(raw.checkpoint || null),
      nodes: nodeMap
    });
  }
  return { ok: errors.length === 0, errors, map };
}

/** EventJournal 的任务消费者；修改只能经 prepare* 草稿提交。 */
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
    const result = validateTaskGraphDefinitions(definitions);
    const previous = this.definitions;
    return {
      ...result,
      commit: () => { if (result.ok) this.definitions = result.map; },
      rollback: () => { this.definitions = previous; }
    };
  }

  hasDefinition(definitionId) { return this.definitions.has(definitionId); }
  getDefinition(definitionId) {
    const value = this.definitions.get(definitionId);
    return value ? serializableDefinition(value) : null;
  }
  getDefinitions() { return [...this.definitions.values()].map(serializableDefinition); }

  prepareStart(definitionId, options = {}) {
    return this._prepareMutation(system => system.start(definitionId, options));
  }

  prepareConsumeEvent(event, options = {}) {
    return this._prepareMutation(system => system.consumeEvent(event, options));
  }

  prepareTracking(instanceId, tracking, actorId = null) {
    return this._prepareMutation(system => system.setTracking(instanceId, tracking, actorId));
  }

  canConsumeEvent(event, actorId = null) {
    if (!hasText(event?.eventId) || !hasText(event?.type)) return false;
    return [...this.instances.values()].some(instance => {
      if (instance.status !== 'active' || (actorId && instance.actorId !== actorId)) return false;
      const definition = this.definitions.get(instance.definitionId);
      return [...(definition?.nodes?.values?.() || [])].some(node => {
        const state = instance.nodeStates[node.id];
        return node.type === 'objective' && state?.status === 'active'
          && node.eventMatcher?.type === event.type
          && shallowMatch(node.eventMatcher?.payload, event.payload);
      });
    });
  }

  start(definitionId, { instanceId = null, startedByEventId = null, actorId = 'global', tracking = true } = {}) {
    const definition = this.definitions.get(definitionId);
    if (!definition) return { ok: false, changed: false, code: 'unknownTaskDefinition' };
    const id = instanceId || `task:${actorId}:${definitionId}:${++this.nextInstanceSequence}`;
    if (this.instances.has(id)) return { ok: true, changed: false, idempotent: true, instance: clone(this.instances.get(id)) };
    const nodeStates = Object.fromEntries([...definition.nodes.keys()].map(nodeId => [nodeId, {
      status: 'locked', eventIds: [], selectedBranchId: null, progress: 0
    }]));
    nodeStates[definition.entryNodeId].status = 'available';
    const instance = {
      instanceId: id,
      definitionId,
      actorId,
      status: 'active',
      tracking: tracking === true,
      startedByEventId,
      startedLogicalTime: Math.max(0, Math.floor(Number(this.now()) || 0)),
      completedLogicalTime: null,
      nodeStates,
      eventIds: []
    };
    this.instances.set(id, instance);
    this._stabilize(instance, definition);
    return { ok: true, changed: true, instance: clone(instance), completed: instance.status === 'completed' };
  }

  consumeEvent(event = {}, { actorId = null } = {}) {
    if (!hasText(event?.eventId) || !hasText(event?.type)) return { ok: false, changed: false, code: 'invalidTaskEvent' };
    const changed = [];
    const completedInstances = [];
    for (const instance of this.instances.values()) {
      if (instance.status !== 'active' || (actorId && instance.actorId !== actorId) || instance.eventIds.includes(event.eventId)) continue;
      const definition = this.definitions.get(instance.definitionId);
      if (!definition) continue;
      for (const [nodeId, node] of definition.nodes) {
        const state = instance.nodeStates[nodeId];
        if (node.type !== 'objective' || state.status !== 'active') continue;
        if (node.eventMatcher?.type !== event.type || !shallowMatch(node.eventMatcher?.payload, event.payload)) continue;
        const requiredCount = Math.max(1, Math.floor(Number(node.requiredCount) || 1));
        state.eventIds.push(event.eventId);
        instance.eventIds.push(event.eventId);
        // progressBy：按事件 payload 的数量字段累计（如 gathering.completed 的 accepted = 本次入包份数）；
        // 未声明时保持逐事件 +1 的既有语义。旧档快照无 progress 字段时从 0 起算。
        if (node.progressBy) {
          const delta = Math.max(0, Math.floor(Number(event.payload?.[node.progressBy]) || 0));
          state.progress = Math.min(requiredCount, (state.progress || 0) + delta);
        } else {
          state.progress = state.eventIds.length;
        }
        const currentCount = Math.min(requiredCount, state.progress || 0);
        const completed = currentCount >= requiredCount;
        if (completed) {
          state.status = 'succeeded';
          this._advance(instance, node);
        }
        changed.push({
          instanceId: instance.instanceId,
          nodeId,
          eventId: event.eventId,
          currentCount,
          requiredCount,
          completed
        });
      }
      const beforeStatus = instance.status;
      this._stabilize(instance, definition);
      if (beforeStatus !== 'completed' && instance.status === 'completed') completedInstances.push(clone(instance));
    }
    return { ok: true, changed: changed.length > 0, changes: changed, completedInstances };
  }

  setTracking(instanceId, tracking, actorId = null) {
    const instance = this.instances.get(instanceId);
    if (!instance || instance.status !== 'active') return { ok: false, changed: false, code: 'taskInstanceUnavailable' };
    if (actorId && instance.actorId !== actorId) return { ok: false, changed: false, code: 'taskInstanceOwnerMismatch' };
    const next = tracking === true;
    if (instance.tracking === next) return { ok: true, changed: false, idempotent: true, instance: clone(instance) };
    instance.tracking = next;
    return { ok: true, changed: true, instance: clone(instance) };
  }

  _stabilize(instance, definition) {
    let changed = true;
    let guard = definition.nodes.size * 4 + 4;
    while (changed && guard-- > 0 && instance.status === 'active') {
      changed = false;
      for (const [nodeId, state] of Object.entries(instance.nodeStates)) {
        if (state.status !== 'available') continue;
        const node = definition.nodes.get(nodeId);
        if (!node) continue;
        if (node.type === 'start' || node.type === 'sequence') {
          state.status = 'succeeded';
          this._advance(instance, node);
          changed = true;
        } else if (node.type === 'objective') {
          state.status = 'active';
          changed = true;
        } else if (node.type === 'parallel') {
          state.status = 'active';
          for (const childId of node.children || []) {
            if (instance.nodeStates[childId].status === 'locked') instance.nodeStates[childId].status = 'available';
          }
          changed = true;
        } else if (node.type === 'branch') {
          state.status = 'active';
          changed = true;
        } else if (node.type === 'complete' || node.type === 'fail') {
          state.status = node.type === 'complete' ? 'succeeded' : 'failed';
          instance.status = node.type === 'complete' ? 'completed' : 'failed';
          instance.completedLogicalTime = Math.max(0, Math.floor(Number(this.now()) || 0));
          changed = true;
        }
      }
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
            this._advance(instance, node);
            changed = true;
          }
        } else if (node.type === 'branch') {
          const selected = (node.branches || []).find(branch => {
            const allCompleted = (branch.allCompleted || []).every(id => instance.nodeStates[id]?.status === 'succeeded');
            const count = branch.countCompleted;
            const countMatches = !count || (count.nodes || []).filter(id => instance.nodeStates[id]?.status === 'succeeded').length >= count.gte;
            return allCompleted && countMatches;
          });
          if (selected?.targetNodeId) {
            state.status = 'succeeded';
            state.selectedBranchId = selected.id;
            const target = instance.nodeStates[selected.targetNodeId];
            if (target?.status === 'locked') target.status = 'available';
            changed = true;
          }
        }
      }
    }
  }

  _advance(instance, node) {
    for (const nextId of node.next || []) {
      const next = instance.nodeStates[nextId];
      if (next?.status === 'locked') next.status = 'available';
    }
  }

  _prepareMutation(apply) {
    const before = this.snapshot();
    const shadow = new TaskGraphSystem({ definitions: this.getDefinitions(), eventJournal: this.eventJournal, now: this.now });
    const restored = shadow.restore(before);
    if (!restored.ok) return restored;
    const result = apply(shadow);
    if (result?.ok !== true) return result;
    const after = shadow.snapshot();
    let committed = false;
    return {
      ...clone(result),
      before,
      after,
      commit: () => {
        if (committed) return { ok: true, idempotent: true };
        const outcome = this.restore(after);
        if (outcome.ok) committed = true;
        return outcome;
      },
      rollback: () => {
        if (!committed) return { ok: true, idempotent: true };
        const outcome = this.restore(before);
        if (outcome.ok) committed = false;
        return outcome;
      }
    };
  }

  getInstance(instanceId) { return this.instances.has(instanceId) ? clone(this.instances.get(instanceId)) : null; }

  getProjection(actorId = null) {
    return Object.freeze([...this.instances.values()]
      .filter(instance => instance.status === 'active' && instance.tracking === true && (!actorId || instance.actorId === actorId))
      .map(instance => {
        const definition = this.definitions.get(instance.definitionId);
        const objectiveProgress = [...(definition?.nodes?.values?.() || [])]
          .filter(node => node.type === 'objective')
          .map(node => {
            const state = instance.nodeStates[node.id];
            const requiredCount = Math.max(1, Math.floor(Number(node.requiredCount) || 1));
            const rawCount = node.progressBy
              ? (state?.progress || 0)
              : (state?.eventIds?.length || 0);
            const currentCount = state?.status === 'succeeded'
              ? requiredCount
              : Math.min(requiredCount, rawCount);
            return { currentCount, requiredCount };
          });
        const nodes = Object.entries(instance.nodeStates)
          .filter(([, state]) => state.status === 'active' || state.status === 'available')
          .map(([nodeId, state]) => {
            const node = definition?.nodes.get(nodeId);
            const requiredCount = node?.type === 'objective'
              ? Math.max(1, Math.floor(Number(node.requiredCount) || 1))
              : 1;
            const rawCount = node?.progressBy
              ? (state.progress || 0)
              : state.eventIds.length;
            const currentCount = state.status === 'succeeded'
              ? requiredCount
              : Math.min(requiredCount, rawCount);
            return Object.freeze({
              nodeId,
              label: node?.label || node?.title || nodeId,
              status: state.status,
              isObjective: node?.type === 'objective',
              currentCount,
              requiredCount,
              eventIds: Object.freeze([...state.eventIds]),
              mapTarget: node?.mapTarget ? Object.freeze(clone(node.mapTarget)) : null
            });
          });
        return Object.freeze({
          instanceId: instance.instanceId,
          definitionId: instance.definitionId,
          title: definition?.title || instance.definitionId,
          description: definition?.description || '',
          category: definition?.category || 'main',
          currentCount: objectiveProgress.reduce((sum, progress) => sum + progress.currentCount, 0),
          requiredCount: objectiveProgress.reduce((sum, progress) => sum + progress.requiredCount, 0),
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
    if (!snapshot || snapshot.schemaVersion !== TASK_GRAPH_SCHEMA_VERSION) return { ok: false, errors: [{ code: 'invalidTaskGraphSchema', path: 'schemaVersion', message: '任务图快照版本不兼容' }] };
    if (!Number.isInteger(snapshot.nextInstanceSequence) || snapshot.nextInstanceSequence < 0) issue(errors, 'invalidTaskSequence', 'nextInstanceSequence', '任务实例序号非法');
    if (!Array.isArray(snapshot.instances)) return { ok: false, errors: [...errors, { code: 'invalidTaskInstances', path: 'instances', message: 'instances 必须是数组' }] };
    const ids = new Set();
    for (const [index, instance] of snapshot.instances.entries()) {
      const path = `instances[${index}]`;
      const definition = this.definitions.get(instance?.definitionId);
      if (!hasText(instance?.instanceId) || ids.has(instance.instanceId) || !definition) issue(errors, 'invalidTaskInstance', path, '任务实例 ID 重复或定义无效');
      ids.add(instance?.instanceId);
      if (!hasText(instance?.actorId) || !INSTANCE_STATUS.has(instance?.status) || typeof instance?.tracking !== 'boolean') issue(errors, 'invalidTaskInstanceState', path, '任务实例角色、状态或追踪字段无效');
      if (!instance?.nodeStates || typeof instance.nodeStates !== 'object' || Array.isArray(instance.nodeStates)) {
        issue(errors, 'invalidTaskNodeStates', `${path}.nodeStates`, '节点状态必须是对象');
        continue;
      }
      for (const nodeId of definition?.nodes.keys?.() || []) if (!instance.nodeStates[nodeId]) issue(errors, 'missingTaskNodeState', `${path}.nodeStates.${nodeId}`, '缺少节点状态');
      for (const [nodeId, state] of Object.entries(instance.nodeStates)) {
        if (!definition?.nodes.has(nodeId) || !NODE_STATUS.has(state?.status) || !Array.isArray(state?.eventIds)
          || state.eventIds.some(id => !hasText(id))) issue(errors, 'invalidTaskNodeState', `${path}.nodeStates.${nodeId}`, '任务节点状态无效');
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
