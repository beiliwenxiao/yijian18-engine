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

import { getObjectiveTypeDescriptor, buildEventMatcher } from './ObjectiveTypeRegistry.js';
import { validateTriggerDefinition } from '../TriggerCatalog.js';
import { validateTaskGraphDefinitions } from '../TaskGraphSystem.js';

/**
 * QuestRuntime - 任务中心制编译器（Quest v2 → 现有运行时原语）
 *
 * 编译模型（设计文档 .kiro/steering/quest-center-design.md §3.3）：
 *   1 个 Quest → 1 个 taskGraph 定义 + N 个触发器。
 *   TaskGraphSystem / TriggerSystem 零改动；quest.id 直接作为 taskGraph definitionId，
 *   任务实例状态、per-trigger fingerprint 存档兼容机制对编译产物自动生效。
 *
 * 触发器产物：
 *   - accept 触发器      when(accept.when 编译) → do[task.command task.start]（mode:manual 不生成，阶段④ NPC 接取）
 *   - 开场编排触发器     when(task.started + definitionId) → do[首段非 objective 步骤]
 *   - 目标后编排触发器   when(前置 objective 的 eventMatcher) → do[后续非 objective 步骤段]
 *   - completion 触发器  when(task.completed + definitionId) → do[rewards]
 *
 * 确定性要求：同一定义必须产出完全一致的定义对象（键序由构造顺序决定），
 * 使编译触发器的 semantic digest 稳定 → per-trigger fingerprint 存档兼容可靠。
 */

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.trim() : '';
const isObjectiveStep = step => step?.type === 'objective';

/** 校验 Quest v2 定义；返回 errors 数组（空数组 = 合法）。 */
export function validateQuestDefinition(quest) {
  const errors = [];
  const path = 'quests[]';
  if (!isObject(quest)) return [`${path} 必须是对象`];
  if (!text(quest.id)) errors.push(`${path}.id 不能为空`);
  else if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(quest.id.trim())) errors.push(`${path}.id 只能使用字母开头的字母、数字、点、下划线和短横线`);
  if (!text(quest.title)) errors.push(`${path}.title 不能为空`);
  if (!Array.isArray(quest.steps) || quest.steps.length === 0) {
    errors.push(`${path}.steps 必须是非空数组`);
    return errors;
  }
  const seen = new Set();
  quest.steps.forEach((step, index) => {
    const stepPath = `${path}.steps[${index}]`;
    if (!isObject(step)) { errors.push(`${stepPath} 必须是对象`); return; }
    if (!text(step.id)) { errors.push(`${stepPath}.id 不能为空`); return; }
    if (seen.has(step.id)) errors.push(`${stepPath}.id 重复: ${step.id}`);
    seen.add(step.id);
    if (isObjectiveStep(step)) {
      if (!text(step.objectiveType)) errors.push(`${stepPath}.objectiveType 不能为空`);
      else if (!getObjectiveTypeDescriptor(step.objectiveType)) errors.push(`${stepPath}.objectiveType 未在目标类型目录登记: ${step.objectiveType}`);
      if (text(step.objectiveType) && !text(step.target) && !isObject(step.eventMatcher) && step.objectiveType !== 'custom.event') {
        errors.push(`${stepPath}.target 不能为空`);
      }
      if (step.requiredCount !== undefined && (!Number.isInteger(step.requiredCount) || step.requiredCount < 1)) {
        errors.push(`${stepPath}.requiredCount 必须为正整数`);
      }
    } else if (step.type === 'dialogue') {
      if (!text(step.dialogueId)) errors.push(`${stepPath}.dialogueId 不能为空`);
    } else if (step.type === 'tutorial') {
      if (!text(step.tutorialId)) errors.push(`${stepPath}.tutorialId 不能为空`);
    } else if (step.type === 'action') {
      if (!text(step.action)) errors.push(`${stepPath}.action 不能为空`);
    } else {
      errors.push(`${stepPath}.type 不支持: ${step.type || '(空)'}（仅 dialogue/tutorial/objective/action）`);
    }
  });
  const accept = quest.accept;
  if (accept !== undefined) {
    if (!isObject(accept)) errors.push(`${path}.accept 必须是对象`);
    else if ((accept.mode || 'auto') === 'auto' && !isObject(accept.when)) errors.push(`${path}.accept.when 不能为空（auto 接取）`);
  }
  if (quest.scenes !== undefined && (!Array.isArray(quest.scenes)
    || quest.scenes.some(sceneId => !text(sceneId)))) {
    errors.push(`${path}.scenes 必须是非空字符串数组`);
  }
  return errors;
}

/** 编译整个项目的 quests[]；空数组返回空产物（零回归直通）。 */
export function compileQuestProject(project = null) {
  const quests = Array.isArray(project?.quests) ? project.quests : [];
  if (quests.length === 0) return { taskGraphs: [], triggers: [] };
  const taskGraphs = [];
  const triggers = [];
  for (const quest of quests) {
    const compiled = compileQuest(quest, project);
    taskGraphs.push(compiled.taskGraph);
    triggers.push(...compiled.triggers);
  }
  return { taskGraphs, triggers };
}

/** 编译单个 Quest → { taskGraph, triggers }。 */
export function compileQuest(quest, project = null) {
  return { taskGraph: compileQuestTaskGraph(quest, project), triggers: compileQuestTriggers(quest, project) };
}

/** Quest → taskGraph 定义：仅 start + objective 节点 + complete（非 objective 步骤进触发器 do 链）。
 * 节点 id 采用裸命名（'start'/'complete' + step.id，图内唯一）——与手写任务图及既有测试的
 * nodeId 寻址约定一致，迁移时编译产物可逐节点等价替换手写定义（存档 nodeStates 兼容）。 */
export function compileQuestTaskGraph(quest, project = null) {
  const questId = text(quest.id);
  const startId = 'start';
  const completeId = 'complete';
  const objectives = (quest.steps || []).filter(isObjectiveStep);
  const nodeIds = objectives.map(step => text(step.id));
  const nodes = [{
    id: startId,
    type: 'start',
    next: [nodeIds[0] || completeId]
  }];
  objectives.forEach((step, index) => {
    const node = {
      id: nodeIds[index],
      type: 'objective',
      title: text(step.title) || step.id,
      next: [nodeIds[index + 1] || completeId]
    };
    const matcher = compileObjectiveEventMatcher(step, project);
    if (matcher) node.eventMatcher = matcher;
    const descriptor = getObjectiveTypeDescriptor(step.objectiveType, project);
    const progressBy = step.progressBy !== undefined ? step.progressBy : descriptor?.progressBy;
    if (text(progressBy)) node.progressBy = text(progressBy);
    node.requiredCount = Math.max(1, Math.floor(Number(step.requiredCount) || 1));
    nodes.push(node);
  });
  nodes.push({ id: completeId, type: 'complete' });
  return {
    id: questId,
    title: text(quest.title),
    ...(text(quest.description) ? { description: text(quest.description) } : {}),
    ...(text(quest.category) ? { category: text(quest.category) } : {}),
    entryNodeId: startId,
    reward: isObject(quest.reward) ? clone(quest.reward) : {},
    checkpoint: quest.checkpoint ?? null,
    nodes
  };
}

/** objective 步骤 → eventMatcher：目标类型目录模板 + target 身份 + extraPayload 附加限定。 */
export function compileObjectiveEventMatcher(step, project = null) {
  if (isObjectiveStep(step) && step.eventMatcher && isObject(step.eventMatcher)) {
    return clone(step.eventMatcher); // 逃生舱：直接提供 eventMatcher 时原样使用
  }
  const descriptor = getObjectiveTypeDescriptor(step?.objectiveType, project);
  if (!descriptor) return null;
  const identityField = descriptor.identityFields[0];
  const identityValues = identityField && text(step?.target) ? { [identityField.name]: text(step.target) } : {};
  return buildEventMatcher(descriptor, identityValues, isObject(step?.extraPayload) ? step.extraPayload : {});
}

/** 编译 Quest 的全部触发器产物（accept / 开场编排 / 目标后编排 / completion）。 */
export function compileQuestTriggers(quest, project = null) {
  const questId = text(quest.id);
  const triggers = [];
  const steps = Array.isArray(quest.steps) ? quest.steps : [];
  const scope = Array.isArray(quest.scenes) && quest.scenes.length
    ? { sceneIds: quest.scenes.map(text) }
    : null;
  const withScope = trigger => (scope ? { ...trigger, editorScope: clone(scope) } : trigger);

  // ① accept 触发器（manual 接取在阶段④由 NPC 流程驱动，不生成）
  const accept = isObject(quest.accept) ? quest.accept : {};
  if ((text(accept.mode) || 'auto') === 'auto' && isObject(accept.when)) {
    triggers.push(withScope({
      id: `trg_${questId}_accept`,
      name: text(accept.name) || `接取任务：${text(quest.title)}`,
      when: compileAcceptWhen(accept.when),
      do: [{
        action: 'task.command',
        params: {
          definitionId: questId,
          instanceId: `${questId}.main`,
          operation: 'task.start',
          tracking: accept.tracking !== false
        },
        stepId: 'quest-accept-start'
      }],
      once: true
    }));
  }

  // ② 段划分：首个 objective 前为开场段；每个 objective 后为其后续段
  const introSegment = [];
  const segmentsByObjective = new Map();
  let currentObjective = null;
  let hasObjective = false;
  for (const step of steps) {
    if (isObjectiveStep(step)) {
      hasObjective = true;
      currentObjective = step;
      segmentsByObjective.set(step.id, []);
    } else if (hasObjective) {
      segmentsByObjective.get(currentObjective.id).push(step);
    } else {
      introSegment.push(step);
    }
  }

  // ③ 开场编排触发器：task.started 驱动首段非 objective 步骤
  if (introSegment.length) {
    triggers.push(withScope({
      id: `trg_${questId}_intro`,
      name: `任务开场：${text(quest.title)}`,
      when: { type: 'task.started', params: { definitionId: questId } },
      do: introSegment.map(compileStepAction),
      once: true
    }));
  }

  // ④ 目标后编排触发器：objective 的 eventMatcher 兼作 when（任务图消费同一事件）
  for (const [objectiveId, segment] of segmentsByObjective) {
    if (!segment.length) continue;
    const objectiveStep = steps.find(step => isObjectiveStep(step) && step.id === objectiveId);
    const matcher = compileObjectiveEventMatcher(objectiveStep, project);
    if (!matcher?.type) continue;
    triggers.push(withScope({
      id: `trg_${questId}_after_${objectiveId}`,
      name: `目标完成后续：${objectiveId}`,
      when: { type: matcher.type, params: clone(matcher.payload || {}) },
      do: segment.map(compileStepAction),
      once: true
    }));
  }

  // ⑤ completion 触发器：task.completed 驱动奖励发放
  const rewardActions = compileRewardActions(quest, questId);
  if (rewardActions.length) {
    triggers.push(withScope({
      id: `trg_${questId}_complete`,
      name: `任务完成：${text(quest.title)}`,
      when: { type: 'task.completed', params: { definitionId: questId } },
      do: rewardActions,
      once: true
    }));
  }
  return triggers;
}

/** accept.when 三种来源 → 触发器 when：fact（状态事务）/ questCompleted / event。 */
export function compileAcceptWhen(when) {
  const type = text(when.type);
  if (type === 'fact' && text(when.fact)) {
    return { type: 'state.transaction', params: { definitionId: text(when.fact) } };
  }
  if (type === 'questCompleted' && text(when.questId)) {
    return { type: 'task.completed', params: { definitionId: text(when.questId) } };
  }
  if (type === 'event' && text(when.event)) {
    return { type: text(when.event), params: clone(isObject(when.params) ? when.params : {}) };
  }
  return { type: '', params: {} };
}

/** Quest 步骤 → 触发器 do 动作（dialogue/tutorial/action；await 仅 tutorial 支持）。 */
export function compileStepAction(step) {
  const stepId = `step.${text(step.id)}`;
  if (step.type === 'dialogue') {
    return {
      action: 'dialogue.command',
      params: { dialogueId: text(step.dialogueId), operation: 'start' },
      stepId
    };
  }
  if (step.type === 'tutorial') {
    return {
      action: 'tutorial.command',
      params: {
        operation: 'show',
        tutorialId: text(step.tutorialId),
        ...(step.await === true ? { await: true } : {})
      },
      stepId
    };
  }
  return {
    action: text(step.action),
    params: clone(isObject(step.params) ? step.params : {}),
    stepId
  };
}

/** Quest rewards → do 动作：state 事实 → state.transaction；items → giveReward。 */
export function compileRewardActions(quest, questId) {
  const rewards = Array.isArray(quest.rewards) ? quest.rewards : [];
  return rewards.map((reward, index) => {
    const stepId = `reward.${String(index + 1).padStart(2, '0')}`;
    if (reward?.type === 'state' && text(reward.definitionId)) {
      return { action: 'state.transaction', params: { definitionId: text(reward.definitionId) }, stepId };
    }
    if (reward?.type === 'items' && Array.isArray(reward.items)) {
      return {
        action: 'giveReward',
        params: { items: reward.items.map(item => ({ id: text(item.itemId), quantity: Math.max(1, Math.floor(Number(item.count) || 1)) })) },
        stepId
      };
    }
    return null;
  }).filter(Boolean);
}

/**
 * 编译产物完整校验：复用 TaskGraphSystem 与 TriggerCatalog 的唯一校验器，
 * 确保 QuestRuntime 产物与手写定义同规同矩。返回 errors 数组。
 */
export function validateQuestCompilation(compilation) {
  const errors = [];
  const taskGraphValidation = validateTaskGraphDefinitions(compilation?.taskGraphs || []);
  if (!taskGraphValidation.ok) errors.push(...taskGraphValidation.errors.map(error => `[taskGraph] ${error.path}: ${error.message}`));
  for (const trigger of compilation?.triggers || []) {
    for (const message of validateTriggerDefinition(trigger)) {
      errors.push(`[trigger:${trigger.id}] ${message}`);
    }
  }
  return errors;
}

export default {
  validateQuestDefinition,
  compileQuestProject,
  compileQuest,
  compileQuestTaskGraph,
  compileObjectiveEventMatcher,
  compileQuestTriggers,
  compileAcceptWhen,
  compileStepAction,
  compileRewardActions,
  validateQuestCompilation
};
