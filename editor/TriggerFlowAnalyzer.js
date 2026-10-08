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

import {
  getTriggerActionDescriptor,
  getTriggerActionOperation,
  getTriggerEventDescriptor
} from '../src/systems/TriggerCatalog.js';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.trim() : '';
const asList = value => Array.isArray(value) ? value : [];
const IGNORED_MATCH_PARAMS = new Set(['seconds', 'catchUpPolicy', 'maxCatchUp']);

function displayValue(value) {
  if (value === undefined || value === null || value === '') return '未设置';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function summarizeTriggerCondition(condition) {
  if (!condition) return '无（事件匹配后直接准入）';
  if (!isObject(condition)) return displayValue(condition);
  if (condition.op === 'hasItem') {
    return `持有 ${condition.item || '?'} ×${Math.max(1, Number(condition.count) || 1)}`;
  }
  const variable = condition.var ?? condition.flag ?? condition.left?.var;
  const value = condition.value !== undefined ? condition.value : condition.right;
  if (condition.op && variable !== undefined) {
    return `${variable} ${condition.op} ${displayValue(value)}`;
  }
  return JSON.stringify(condition);
}

export function describeTriggerEvent(type, params = {}, project = null) {
  const eventType = text(type);
  const descriptor = getTriggerEventDescriptor(eventType, project);
  const safeParams = isObject(params) ? params : {};
  const identityFields = asList(descriptor?.identityFields).filter(field => text(field));
  const identities = identityFields.map(field => ({
    field,
    value: safeParams[field],
    displayValue: displayValue(safeParams[field]),
    missing: safeParams[field] === undefined || safeParams[field] === null || safeParams[field] === ''
  }));
  return {
    type: eventType,
    name: descriptor?.label || '未登记的自定义事件',
    registered: Boolean(descriptor),
    descriptor,
    params: safeParams,
    identities
  };
}

function resolveEmissionValue(value, actionParams, trigger) {
  if (value === '$trigger.id') return trigger?.id;
  if (typeof value === 'string' && value.startsWith('$params.')) {
    return actionParams[value.slice('$params.'.length)];
  }
  return value;
}

function buildEmissionParams(emission, actionParams, trigger) {
  const params = {};
  if (text(emission?.idParam)) params[emission.idParam] = actionParams[emission.idParam];
  for (const [outputField, inputField] of Object.entries(emission?.paramMap || {})) {
    params[outputField] = actionParams[inputField];
  }
  for (const [field, value] of Object.entries(emission?.params || {})) {
    params[field] = resolveEmissionValue(value, actionParams, trigger);
  }
  return params;
}

function matchesRuntimeParams(wanted, emitted) {
  if (!wanted) return true;
  for (const [key, value] of Object.entries(wanted)) {
    if (IGNORED_MATCH_PARAMS.has(key)) continue;
    if (value === undefined || value === null || value === '') continue;
    if (emitted[key] !== value) return false;
  }
  return true;
}

function collectStepOutputs(steps, trigger, project, outputs, basePath = 'do') {
  asList(steps).forEach((step, index) => {
    const path = `${basePath}[${index}]`;
    if (Array.isArray(step?.branch)) {
      step.branch.forEach((branch, branchIndex) => {
        collectStepOutputs(branch?.do, trigger, project, outputs, `${path}.branch[${branchIndex}].do`);
      });
      return;
    }
    const descriptor = getTriggerActionDescriptor(step?.action, project);
    const operation = getTriggerActionOperation(step?.action, step?.params?.operation, project);
    const emissions = operation?.emits ?? descriptor?.emits ?? [];
    asList(emissions).forEach(emission => {
      if (!text(emission?.type)) return;
      const event = describeTriggerEvent(
        emission.type,
        buildEmissionParams(emission, step?.params || {}, trigger),
        project
      );
      outputs.push({
        ...event,
        source: {
          kind: 'action',
          path,
          stepId: text(step?.stepId),
          action: text(step?.action),
          actionName: descriptor?.label || text(step?.action) || '未登记动作',
          operation: text(step?.params?.operation),
          operationName: operation?.label || text(step?.params?.operation)
        },
        condition: text(emission.condition) || 'succeeded'
      });
    });
  });
}

function attachDownstream(output, triggers) {
  const targets = asList(triggers)
    .filter(candidate => candidate?.when?.type === output.type)
    .filter(candidate => matchesRuntimeParams(candidate?.when?.params, output.params))
    .map(candidate => ({ id: candidate.id, name: candidate.name || candidate.id }));
  return {
    ...output,
    targets,
    connectionStatus: targets.length === 0 ? 'unconnected' : targets.length === 1 ? 'connected' : 'ambiguous'
  };
}

function countConditionalSteps(steps) {
  let stepIfCount = 0;
  let branchCount = 0;
  asList(steps).forEach(step => {
    if (step?.if) stepIfCount += 1;
    if (Array.isArray(step?.branch)) {
      branchCount += step.branch.length;
      step.branch.forEach(branch => {
        const nested = countConditionalSteps(branch?.do);
        stepIfCount += nested.stepIfCount;
        branchCount += nested.branchCount;
      });
    }
  });
  return { stepIfCount, branchCount };
}

export function analyzeTriggerFlow(trigger, triggers = [], project = null) {
  if (!trigger) return null;
  const start = describeTriggerEvent(trigger.when?.type, trigger.when?.params, project);
  const outputs = [];
  collectStepOutputs(trigger.do, trigger, project, outputs);
  outputs.push({
    ...describeTriggerEvent('triggerSucceeded', { triggerId: trigger.id }, project),
    source: { kind: 'automatic', path: '', stepId: '', action: '', actionName: 'TriggerSystem', operation: '', operationName: '' },
    condition: 'triggerSucceeded'
  });
  const conditionalCounts = countConditionalSteps(trigger.do);
  return {
    triggerId: trigger.id,
    triggerName: trigger.name || trigger.id,
    start,
    completion: {
      admission: summarizeTriggerCondition(trigger.if),
      success: '顶层 if 准入后，do[] 中所有实际执行步骤均成功；step.if 不满足的步骤跳过，branch.when 只选择执行分支。',
      ...conditionalCounts
    },
    outputs: outputs.map(output => attachDownstream(output, triggers))
  };
}

export default {
  summarizeTriggerCondition,
  describeTriggerEvent,
  analyzeTriggerFlow
};
