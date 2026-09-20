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

import { STANDARD_ACTION_DESCRIPTORS } from './ActionDescriptorRegistry.js';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.trim() : '';

const eventSchema = (properties = {}, required = []) => Object.freeze({
  type: 'object',
  additionalProperties: true,
  ...(required.length ? { required } : {}),
  properties
});

const CORE_EVENT_PARAMS = Object.freeze({
  sceneEnter: eventSchema({ sceneId: { type: 'string', title: '场景 ID' } }),
  enterRegion: eventSchema({ regionId: { type: 'string', title: '区域 ID' } }),
  dialogueEnd: eventSchema({ id: { type: 'string', title: '对话 ID' } }),
  dialogueChoice: eventSchema({ id: { type: 'string', title: '对话 ID' }, choiceId: { type: 'string', title: '选项 ID' } }),
  itemPickup: eventSchema({ placementId: { type: 'string', title: '放置点 ID' }, itemId: { type: 'string', title: '物品 ID' }, complete: { type: 'boolean', title: '拾取完整' } }),
  interact: eventSchema({ bindingId: { type: 'string', title: '空间 Binding ID' }, target: { type: 'string', title: '目标 ID' }, sceneId: { type: 'string', title: '场景 ID' } }),
  questComplete: eventSchema({ questId: { type: 'string', title: '任务 ID' } }),
  questProgress: eventSchema({ questId: { type: 'string', title: '任务 ID' } }),
  chunkEnter: eventSchema({ sceneId: { type: 'string', title: '场景／Chunk ID' } }),
  sceneComplete: eventSchema({ sceneId: { type: 'string', title: '场景 ID' } }),
  equipItem: eventSchema({ slot: { type: 'string', title: '装备槽位' }, item: { type: 'string', title: '物品 ID' } }),
  unequipItem: eventSchema({ slot: { type: 'string', title: '装备槽位' }, item: { type: 'string', title: '物品 ID' } }),
  classSelected: eventSchema({ classId: { type: 'string', title: '职业 ID' } }),
  triggerSucceeded: eventSchema({ triggerId: { type: 'string', title: 'Trigger ID' } }),
  triggerFailed: eventSchema({ triggerId: { type: 'string', title: 'Trigger ID' }, code: { type: 'string', title: '失败代码' } }),
  // 任务中心制阶段①：任务图高频事件补全（此前仅项目级 triggerCatalog 登记才可见）
  'gathering.completed': eventSchema({ itemId: { type: 'string', title: '物品 ID' }, resourceType: { type: 'string', title: '资源类型' }, nodeId: { type: 'string', title: '资源节点 ID' }, accepted: { type: 'integer', title: '入包份数' } }),
  'state.transaction': eventSchema({ definitionId: { type: 'string', title: '状态事务 ID', minLength: 1 } }),
  'enemy.killed': eventSchema({ enemyRole: { type: 'string', title: '敌人角色 ID' }, entityId: { type: 'string', title: '实体 ID' }, corpseReady: { type: 'boolean', title: '尸体已成立' } })
});

const CORE_EVENT_IDENTITIES = Object.freeze({
  sceneEnter: ['sceneId'], enterRegion: ['regionId'], dialogueEnd: ['id'], dialogueChoice: ['id', 'choiceId'],
  itemPickup: ['placementId', 'itemId'], interact: ['bindingId', 'target'], questComplete: ['questId'],
  questProgress: ['questId'], chunkEnter: ['sceneId'], sceneComplete: ['sceneId'], equipItem: ['slot', 'item'],
  unequipItem: ['slot', 'item'], classSelected: ['classId'], triggerSucceeded: ['triggerId'], triggerFailed: ['triggerId'],
  'gathering.completed': ['itemId'], 'state.transaction': ['definitionId'], 'enemy.killed': ['enemyRole']
});

const EVENT_SOURCES = Object.freeze({
  'gathering.completed': 'GatheringSystem',
  'state.transaction': 'CanonicalStateTransactionService',
  'enemy.killed': 'CombatSystem'
});

const CORE_EVENTS = [
  ['sceneEnter', '进入场景'], ['enterRegion', '进入区域'], ['dialogueEnd', '对话结束'],
  ['dialogueChoice', '对话选项确认'], ['kill', '击杀敌人'], ['itemPickup', '拾取物品'], ['interact', '交互', true],
  ['questComplete', '任务完成'], ['questProgress', '任务进度'], ['flagChange', '变量变化'],
  ['timer', '定时器'], ['chunkEnter', '进入区块'], ['campfireLit', '火堆点燃'],
  ['waveCleared', '波次清空'], ['gatheringRisk', '采集风险'], ['playerMoved', '玩家移动'], ['panelOpen', '打开面板'],
  ['equipItem', '装备物品'], ['unequipItem', '卸下物品'], ['classSelected', '选择职业'],
  ['approach', '靠近', true], ['enter', '进入范围', true], ['leave', '离开范围', true],
  ['stand', '站立'], ['climb', '攀爬'], ['jump', '跳跃'], ['itemTransform', '物品转化'],
  ['sceneComplete', '场景完成'], ['triggerSucceeded', 'Trigger 执行成功'], ['triggerFailed', 'Trigger 执行失败'],
  ['gathering.completed', '采集完成'], ['state.transaction', '状态事务已提交'], ['enemy.killed', '敌人死亡已提交']
].map(([value, label, spatial = false]) => Object.freeze({
  value,
  v: value,
  label,
  spatial,
  ...(EVENT_SOURCES[value] ? { source: EVENT_SOURCES[value] } : {}),
  identityFields: CORE_EVENT_IDENTITIES[value] || [],
  ...(CORE_EVENT_PARAMS[value] ? { paramsSchema: CORE_EVENT_PARAMS[value] } : {})
}));

const CORE_ACTIONS = [
  ['setVar', '设置变量'], ['addVar', '变量累加'], ['setFlag', '设置标记'], ['toggleFlag', '切换标记'],
  ['startDialogue', '开始对话'], ['teleportToChunk', '大地图传送'], ['switchScene', '切换场景'],
  ['loadRegion', '加载区域'], ['giveReward', '给予奖励'], ['heal', '治疗/恢复'],
  ['startQuest', '开始任务'], ['completeQuest', '完成任务'], ['showTip', '显示提示'],
  ['playSound', '播放音效'], ['playBgm', '播放 BGM'], ['spawnEnemy', '生成敌人'], ['wait', '等待'],
  ['parallel', '并行执行'], ['battleWin', '战斗胜利'], ['battleLose', '战斗失败'],
  ['mount', '上载具/骑乘']
].map(([value, label]) => Object.freeze({ value, v: value, label }));

const STANDARD_ACTION_LABELS = Object.freeze({
  'rescue.command': '救援命令',
  'battle.command': '战役命令',
  'construction.command': '营建命令',
  'vehicle.command': '载具命令',
  'quest.command': '任务命令',
  'task.command': '任务图命令',
  'world.teleport': '世界传送',
  'checkpoint.request': '检查点请求',
  'ending.command': '结局命令',
  'dialogue.command': '对话命令',
  'tutorial.command': '教学命令',
  'state.transaction': '状态事务',
  'scenario.command': '场景编排命令'
});

const STANDARD_CATALOG_ACTIONS = STANDARD_ACTION_DESCRIPTORS.map(descriptor => Object.freeze({
  ...descriptor,
  value: descriptor.id,
  v: descriptor.id,
  label: STANDARD_ACTION_LABELS[descriptor.id] || descriptor.id
}));

function catalogId(raw) {
  if (typeof raw === 'string') return text(raw);
  return text(raw?.value || raw?.v || raw?.id);
}

function normalizeOperation(raw) {
  const value = catalogId(raw);
  if (!value) return null;
  if (typeof raw === 'string') return { value, v: value, id: value, label: value };
  return {
    ...raw,
    id: text(raw.id) || value,
    value,
    v: value,
    label: text(raw.label) || value
  };
}

function mergeOperations(base = [], extra = []) {
  const merged = new Map();
  for (const raw of [...(base || []), ...(extra || [])]) {
    const normalized = normalizeOperation(raw);
    if (!normalized) continue;
    const previous = merged.get(normalized.value) || {};
    merged.set(normalized.value, { ...previous, ...normalized });
  }
  return [...merged.values()];
}

function mergeCatalog(core, extra = []) {
  const merged = new Map(core.map(item => [item.value, { ...item }]));
  for (const rawValue of extra || []) {
    const raw = typeof rawValue === 'string' ? { value: rawValue } : rawValue;
    const value = catalogId(raw);
    if (!value) continue;
    const previous = merged.get(value) || {};
    const rawLabel = text(raw?.label);
    const label = rawLabel && rawLabel !== value ? rawLabel : previous.label || rawLabel || value;
    const operations = raw?.operations === undefined
      ? previous.operations
      : mergeOperations(previous.operations, raw.operations);
    const next = { ...previous, ...raw, value, v: value, label };
    if (operations?.length) next.operations = operations;
    else delete next.operations;
    merged.set(value, next);
  }
  return [...merged.values()];
}

export const getTriggerEvents = project => mergeCatalog(CORE_EVENTS, project?.triggerCatalog?.events);
export const getTriggerActions = project => mergeCatalog(
  [...CORE_ACTIONS, ...STANDARD_CATALOG_ACTIONS],
  project?.triggerCatalog?.actions
);

export function getTriggerEventDescriptor(eventType, project = null) {
  const type = text(eventType);
  return getTriggerEvents(project).find(event => event.value === type) || null;
}

export function getTriggerActionDescriptor(actionId, project = null) {
  const id = text(actionId);
  return getTriggerActions(project).find(action => action.value === id) || null;
}

export function getTriggerActionOperations(actionId, project = null) {
  return [...(getTriggerActionDescriptor(actionId, project)?.operations || [])];
}

export function getTriggerActionOperation(actionId, operationId, project = null) {
  const id = text(operationId);
  return getTriggerActionOperations(actionId, project).find(operation => operation.value === id) || null;
}

export const isSpatialTriggerEvent = (type, project = null) => (
  getTriggerEvents(project).some(item => item.value === type && item.spatial)
);

function schemaType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function validateSchema(value, schema, path, errors) {
  if (!isObject(schema)) return;
  const actualType = schemaType(value);
  const typeMatches = schema.type === 'integer'
    ? Number.isInteger(value)
    : !schema.type || actualType === schema.type;
  if (!typeMatches) {
    errors.push(`${path} 必须是 ${schema.type}`);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path} 不在允许值中`);
  }
  if (schema.type === 'object' && isObject(value)) {
    for (const field of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${path}.${field} 不能为空`);
    }
    for (const [field, child] of Object.entries(value)) {
      if (field === 'operation') continue;
      const childSchema = schema.properties?.[field];
      if (childSchema) validateSchema(child, childSchema, `${path}.${field}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}.${field} 未在参数 Schema 中登记`);
    }
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    value.forEach((child, index) => validateSchema(child, schema.items, `${path}[${index}]`, errors));
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path} 不得小于 ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path} 不得大于 ${schema.maximum}`);
  }
  if (typeof value === 'string' && schema.minLength != null && value.length < schema.minLength) {
    errors.push(`${path} 长度不得小于 ${schema.minLength}`);
  }
}

export function validateTriggerActionParams(action, project = null, path = 'action') {
  const errors = [];
  const descriptor = getTriggerActionDescriptor(action?.action, project);
  if (!descriptor) return [`${path}.action 未登记: ${action?.action || ''}`];
  const params = action?.params ?? {};
  if (!isObject(params)) return [`${path}.params 必须是对象`];
  const operations = descriptor.operations || [];
  let paramsSchema = descriptor.paramsSchema;
  if (operations.length) {
    const operationId = text(params.operation);
    if (!operationId) errors.push(`${path}.params.operation 不能为空`);
    const operation = operations.find(candidate => candidate.value === operationId);
    if (operationId && !operation) errors.push(`${path}.params.operation 未登记: ${operationId}`);
    if (operation?.paramsSchema) paramsSchema = operation.paramsSchema;
  }
  validateSchema(params, paramsSchema, `${path}.params`, errors);
  return errors;
}

export function summarizeTrigger(trigger, project = null) {
  if (!trigger) return '未找到行为定义';
  const names = new Map(getTriggerActions(project).map(item => [item.value, item.label || item.value]));
  const actions = (trigger.do || []).map(item => {
    const actionName = names.get(item.action) || item.action || '?';
    const operation = getTriggerActionOperation(item.action, item.params?.operation, project);
    return operation ? `${actionName}／${operation.label}` : actionName;
  }).join(' → ') || '无动作';
  return `${trigger.when?.type || '?'} · ${actions}${trigger.once ? ' · 一次' : ''}${trigger.cooldown ? ` · ${trigger.cooldown}s` : ''}`;
}

export function validateTriggerDefinition(trigger, project = null) {
  const errors = [];
  if (!trigger?.id || typeof trigger.id !== 'string') errors.push('id 必须是非空字符串');
  if (trigger?.name !== undefined && (typeof trigger.name !== 'string' || !trigger.name.trim())) {
    errors.push('name 必须是非空字符串');
  }
  if (!trigger?.when?.type) errors.push('when.type 不能为空');
  const whenParams = trigger?.when?.params;
  if (whenParams !== undefined && !isObject(whenParams)) {
    errors.push('when.params 必须是对象');
  } else if (isObject(whenParams)) {
    const eventDescriptor = getTriggerEventDescriptor(trigger.when.type, project);
    if (eventDescriptor?.paramsSchema) {
      validateSchema(whenParams, eventDescriptor.paramsSchema, 'when.params', errors);
    }
  }
  if (!Array.isArray(trigger?.do)) errors.push('do 必须是数组');
  if (trigger?.sceneEventId !== undefined
    && (typeof trigger.sceneEventId !== 'string' || !trigger.sceneEventId.trim())) {
    errors.push('sceneEventId 必须是非空字符串');
  }
  if (trigger?.editorScope !== undefined) {
    const editorScope = trigger.editorScope;
    if (!isObject(editorScope)) {
      errors.push('editorScope 必须是对象');
    } else if (!Array.isArray(editorScope.sceneIds)) {
      errors.push('editorScope.sceneIds 必须是数组');
    } else {
      const normalized = editorScope.sceneIds.map(sceneId => text(sceneId));
      if (normalized.some(sceneId => !sceneId)) errors.push('editorScope.sceneIds 只能包含非空字符串');
      if (new Set(normalized).size !== normalized.length) errors.push('editorScope.sceneIds 不允许重复');
    }
  }
  if (trigger?.coordination !== undefined) {
    const coordination = trigger.coordination;
    if (!isObject(coordination)) {
      errors.push('coordination 必须是对象');
    } else {
      if (!text(coordination.group)) errors.push('coordination.group 必须是非空字符串');
      if (coordination.priority !== undefined && !Number.isInteger(coordination.priority)) {
        errors.push('coordination.priority 必须是整数');
      }
      const policy = coordination.policy ?? 'broadcast';
      if (!['broadcast', 'firstSuccess'].includes(policy)) errors.push('coordination.policy 仅允许 broadcast 或 firstSuccess');
      if (policy === 'firstSuccess' && !text(coordination.group)) errors.push('firstSuccess 必须声明 coordination.group');
    }
  }

  const known = new Set(getTriggerActions(project).map(item => item.value));
  const stepIds = new Set();
  const requiresStableSteps = Boolean(text(trigger?.flowGroupId) || text(trigger?.sceneEventId));
  const validateStepList = (actions, path) => {
    for (const [index, action] of (actions || []).entries()) {
      const stepPath = `${path}[${index}]`;
      if (!known.has(action?.action)) errors.push(`${stepPath}.action 未登记: ${action?.action || ''}`);
      const stepId = text(action?.stepId);
      if (requiresStableSteps && !stepId) errors.push(`${stepPath}.stepId 不能为空`);
      if (stepId && stepIds.has(stepId)) errors.push(`${stepPath}.stepId 重复: ${stepId}`);
      if (stepId) stepIds.add(stepId);
      if (Array.isArray(action?.branch)) {
        // 分支容器：递归校验各分支条件与子步骤（单 Trigger 多路径/多教程）
        action.branch.forEach((branch, bIndex) => {
          const branchPath = `${stepPath}.branch[${bIndex}]`;
          if (branch?.otherwise === true && branch?.when != null) {
            errors.push(`${branchPath} 不能同时设置 otherwise 与 when`);
          }
          if (!Array.isArray(branch?.do)) {
            errors.push(`${branchPath}.do 必须是数组`);
          } else {
            validateStepList(branch.do, `${branchPath}.do`);
          }
        });
      } else {
        if (requiresStableSteps && Object.prototype.hasOwnProperty.call(action || {}, 'await')) {
          errors.push(`${stepPath}.await 已废弃；TriggerSystem 始终严格串行等待并在失败时短路`);
        }
        if (action?.params?.await === true && action.action !== 'tutorial.command') {
          errors.push(`${stepPath}.params.await 仅允许用于 tutorial.command 步骤`);
        }
        errors.push(...validateTriggerActionParams(action, project, stepPath));
      }
    }
  };
  validateStepList(trigger?.do, 'do');
  return errors;
}

export default {
  getTriggerEvents,
  getTriggerEventDescriptor,
  getTriggerActions,
  getTriggerActionDescriptor,
  getTriggerActionOperations,
  getTriggerActionOperation,
  isSpatialTriggerEvent,
  summarizeTrigger,
  validateTriggerActionParams,
  validateTriggerDefinition
};
