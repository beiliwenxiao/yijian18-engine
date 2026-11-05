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
 * 编译模型（设计文档 .trae/rules/quest-center-design.md §3.3）：
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
  const checkStepId = (stepId, stepPath) => {
    if (!text(stepId)) { errors.push(`${stepPath}.id 不能为空`); return false; }
    if (seen.has(stepId)) { errors.push(`${stepPath}.id 重复: ${stepId}`); return false; }
    seen.add(stepId);
    return true;
  };
  const validateStep = (step, stepPath) => {
    if (!isObject(step)) { errors.push(`${stepPath} 必须是对象`); return; }
    if (!checkStepId(step.id, stepPath)) return;
    // gates 附属字段（全步骤通用）：任务对交互门/场景对象的显式引用（编辑器跳转+条件联动域）
    if (step.gates !== undefined) {
      if (!Array.isArray(step.gates)) errors.push(`${stepPath}.gates 必须是数组`);
      else step.gates.forEach((gate, gateIndex) => {
        const gatePath = `${stepPath}.gates[${gateIndex}]`;
        if (!isObject(gate)) { errors.push(`${gatePath} 必须是对象`); return; }
        if (!text(gate.sceneId)) errors.push(`${gatePath}.sceneId 不能为空`);
        if (!text(gate.placementId)) errors.push(`${gatePath}.placementId 不能为空`);
      });
    }
    if (isObjectiveStep(step)) {
      if (!text(step.objectiveType)) errors.push(`${stepPath}.objectiveType 不能为空`);
      else if (!getObjectiveTypeDescriptor(step.objectiveType)) errors.push(`${stepPath}.objectiveType 未在目标类型目录登记: ${step.objectiveType}`);
      if (text(step.objectiveType) && !text(step.target) && !isObject(step.eventMatcher) && step.objectiveType !== 'custom.event') {
        errors.push(`${stepPath}.target 不能为空`);
      }
      if (step.requiredCount !== undefined && (!Number.isInteger(step.requiredCount) || step.requiredCount < 1)) {
        errors.push(`${stepPath}.requiredCount 必须为正整数`);
      }
      if (step.commitFact !== undefined && !text(step.commitFact)) {
        errors.push(`${stepPath}.commitFact 必须为非空状态事务 ID`);
      }
    } else if (step.type === 'dialogue') {
      if (!text(step.dialogueId)) errors.push(`${stepPath}.dialogueId 不能为空`);
    } else if (step.type === 'tutorial') {
      if (!text(step.tutorialId)) errors.push(`${stepPath}.tutorialId 不能为空`);
    } else if (step.type === 'action') {
      if (!text(step.action)) errors.push(`${stepPath}.action 不能为空`);
    } else if (step.type === 'event') {
      // 事件编排步骤：when 事件 → 动作链（编译为独立触发器；不占任务目标节点）。
      // steps 支持 compileStepAction 兼容步骤（dialogue/tutorial/action，需 id）与
      // 原样触发器动作对象（branch 等复杂结构，无 type 键、原样透传）。
      if (!isObject(step.eventMatcher) || !text(step.eventMatcher.type)) {
        errors.push(`${stepPath}.eventMatcher.type 不能为空`);
      }
      if (Array.isArray(step.steps)) {
        step.steps.forEach((subStep, subIndex) => {
          const subPath = `${stepPath}.steps[${subIndex}]`;
          if (!isObject(subStep)) { errors.push(`${subPath} 必须是对象`); return; }
          if (!text(subStep.type)) {
            // 原样触发器动作对象（如 branch/复合动作）：交由 TriggerCatalog 运行时校验
            if (!text(subStep.action) && !text(subStep.branch) && !Array.isArray(subStep.branch)) {
              errors.push(`${subPath} 缺少动作定义（type 或 action/branch）`);
            }
            return;
          }
          if (!text(subStep.id)) errors.push(`${subPath}.id 不能为空`);
          if (isObjectiveStep(subStep) || subStep.type === 'choice' || subStep.type === 'event') {
            errors.push(`${subPath} 事件编排内不支持 ${subStep.type || 'objective'} 步骤（仅 dialogue/tutorial/action）`);
          }
        });
      }
    } else if (step.type === 'choice') {
      if (!text(step.dialogueId)) errors.push(`${stepPath}.dialogueId 不能为空（分支选项事件来源）`);
      if (!Array.isArray(step.options) || step.options.length === 0) {
        errors.push(`${stepPath}.options 必须是非空数组`);
        return;
      }
      const choices = new Set();
      step.options.forEach((option, optionIndex) => {
        const optionPath = `${stepPath}.options[${optionIndex}]`;
        if (!isObject(option)) { errors.push(`${optionPath} 必须是对象`); return; }
        if (!text(option.choice)) { errors.push(`${optionPath}.choice 不能为空`); return; }
        if (choices.has(option.choice)) errors.push(`${optionPath}.choice 重复: ${option.choice}`);
        choices.add(option.choice);
        if (Array.isArray(option.steps)) option.steps.forEach((subStep, subIndex) => validateStep(subStep, `${optionPath}.steps[${subIndex}]`));
      });
    } else {
      errors.push(`${stepPath}.type 不支持: ${step.type || '(空)'}（仅 dialogue/tutorial/objective/action/choice）`);
    }
  };
  (quest.steps || []).forEach((step, index) => validateStep(step, `${path}.steps[${index}]`));
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

/** choice 步骤的分支选项 objective 节点 id：`${choice步骤id}.${choiceId}`（图内唯一）。 */
const choiceOptionNodeId = (choiceStep, option, prefix) => (
  `${prefix ? `${prefix}.` : ''}${text(choiceStep.id)}.${text(option.choice)}`
);

/** choice 选项 → dialogueChoice eventMatcher（与手写触发器 when params 同形）。 */
const choiceOptionMatcher = (choiceStep, option) => ({
  type: 'dialogueChoice',
  payload: { id: text(choiceStep.dialogueId), choiceId: text(option.choice) }
});

/**
 * Quest → taskGraph 定义：start + objective 节点链 + complete（非 objective 步骤进触发器 do 链）。
 *
 * choice 步骤（分支路由，任务系统分支语义）展开规则：
 *   - 每个选项生成一个 objective 节点（eventMatcher = dialogueChoice{id, choiceId}），
 *     「做出选择」即该目标完成；前驱节点 next 并列解锁全部选项（UI 呈现为并列分支目标）；
 *   - 选项内 steps 递归编译为该选项的后续链（可继续含 objective），链尾接后继主线节点或 complete；
 *   - 任一分支链走到 complete 即任务完成（complete 节点被任一前驱解锁即生效）。
 *
 * objective 可选 commitFact：目标完成的同时提交一条状态事务（见 compileQuestTriggers 的
 * commit 触发器），用于替代「外部触发器提交事实 + 目标监听事实」的旧双件套。
 *
 * 节点 id 采用裸命名（'start'/'complete' + step.id，图内唯一）——与手写任务图及既有测试的
 * nodeId 寻址约定一致，迁移时编译产物可逐节点等价替换手写定义（存档 nodeStates 兼容）。
 */
export function compileQuestTaskGraph(quest, project = null) {
  const questId = text(quest.id);
  const startId = 'start';
  const completeId = 'complete';
  const nodes = [];
  const nodeById = new Map();
  const addNode = node => { nodes.push(node); nodeById.set(node.id, node); return node; };
  const link = (fromId, toId) => {
    const from = nodeById.get(fromId);
    if (from && !from.next.includes(toId)) from.next.push(toId);
  };
  const buildObjectiveNode = (step, nodeId) => {
    const node = {
      id: nodeId,
      type: 'objective',
      title: text(step.title) || nodeId,
      next: []
    };
    const matcher = compileObjectiveEventMatcher(step, project);
    if (matcher) node.eventMatcher = matcher;
    // 地图引导锚点：策划在步骤上声明 mapTarget / mapTargets 时原样带入任务图节点，
    // 供 SceneHudUpdater 解析世界坐标（小地图任务点 + 任务点粒子信标共用）。
    if (isObject(step.mapTarget)) node.mapTarget = clone(step.mapTarget);
    if (Array.isArray(step.mapTargets)) node.mapTargets = step.mapTargets.filter(isObject).map(clone);
    // 交互门/场景对象引用：原样带入节点供编辑器反向查询与定位（运行时无消费）
    if (Array.isArray(step.gates)) node.gates = step.gates.filter(isObject).map(clone);
    const descriptor = getObjectiveTypeDescriptor(step.objectiveType, project);
    const progressBy = step.progressBy !== undefined ? step.progressBy : descriptor?.progressBy;
    if (text(progressBy)) node.progressBy = text(progressBy);
    node.requiredCount = Math.max(1, Math.floor(Number(step.requiredCount) || 1));
    return node;
  };

  /**
   * 编译一段线性步骤序列（顶层主线或 choice 选项内）。
   * 返回 { heads: 无前驱的首目标 ids, tails: 链尾目标 ids（待调用方链接后继） }。
   */
  const emitSequence = (chainSteps, prefix) => {
    const heads = [];
    let prevTails = null;
    for (const step of Array.isArray(chainSteps) ? chainSteps : []) {
      if (isObjectiveStep(step)) {
        const node = addNode(buildObjectiveNode(step, prefix ? `${prefix}.${text(step.id)}` : text(step.id)));
        if (prevTails) prevTails.forEach(tailId => link(tailId, node.id));
        else heads.push(node.id);
        prevTails = [node.id];
      } else if (step.type === 'event') {
        // 事件编排步骤：编译为独立触发器（见 compileQuestTriggers），不产生任务图节点
      } else if (step.type === 'choice' && Array.isArray(step.options)) {
        const optionHeads = [];
        const optionTails = [];
        for (const option of step.options) {
          if (!isObject(option) || !text(option.choice)) continue;
          const optionNodeId = choiceOptionNodeId(step, option, prefix);
          const optionNode = addNode({
            id: optionNodeId,
            type: 'objective',
            title: text(option.title) || optionNodeId,
            eventMatcher: choiceOptionMatcher(step, option),
            next: [],
            requiredCount: 1
          });
          optionHeads.push(optionNode.id);
          const sub = emitSequence(option.steps, optionNodeId);
          sub.heads.forEach(headId => link(optionNode.id, headId));
          if (sub.heads.length === 0) optionTails.push(optionNode.id);
          else optionTails.push(...sub.tails);
        }
        if (prevTails) prevTails.forEach(tailId => optionHeads.forEach(headId => link(tailId, headId)));
        else heads.push(...optionHeads);
        prevTails = optionTails;
      }
      // 其余非 objective 步骤（dialogue/tutorial/action）进触发器 do 链，不产生节点
    }
    return { heads, tails: prevTails || [] };
  };

  const chain = emitSequence(quest.steps, null);
  // start 节点居首（与旧产物节点顺序一致，保证编译产物确定性）
  nodes.unshift({
    id: startId,
    type: 'start',
    next: chain.heads.length > 1 ? [...chain.heads] : [chain.heads[0] || completeId]
  });
  chain.tails.forEach(tailId => link(tailId, completeId));
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

  // ② 段划分（含 choice 选项子链递归）：首个 objective 前为开场段；每个 objective 后为其后续段。
  // choice 选项内 steps 的非 objective 前置步骤并入选项 objective 的段（选择完成后执行）。
  // event 编排步骤单独收集（编译为独立触发器；不进段、不占任务节点）。
  const introSegment = [];
  const questEvents = []; // { step, id }（id 含 choice 前缀，与节点寻址同构）
  const segmentGroups = []; // { nodeId, step, matcher, segment[] }（step=objective 原步骤；选项组 step=null）
  const walkSegments = (chainSteps, prefix, sink) => {
    let current = null;
    for (const step of Array.isArray(chainSteps) ? chainSteps : []) {
      if (isObjectiveStep(step)) {
        const nodeId = prefix ? `${prefix}.${text(step.id)}` : text(step.id);
        current = { nodeId, step, matcher: null, segment: [] };
        segmentGroups.push(current);
      } else if (step.type === 'event') {
        questEvents.push({ step, id: prefix ? `${prefix}.${text(step.id)}` : text(step.id) });
      } else if (step.type === 'choice' && Array.isArray(step.options)) {
        current = null;
        for (const option of step.options) {
          if (!isObject(option) || !text(option.choice)) continue;
          const optionNodeId = choiceOptionNodeId(step, option, prefix);
          const optionGroup = { nodeId: optionNodeId, step: null, matcher: choiceOptionMatcher(step, option), segment: [] };
          segmentGroups.push(optionGroup);
          // 选项子链递归：sink=选项 objective 的段（子链开头的非 objective 步骤选择后立即执行）
          walkSegments(option.steps, optionNodeId, optionGroup.segment);
        }
      } else {
        (current ? current.segment : sink).push(step);
      }
    }
  };
  walkSegments(steps, null, introSegment);

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

  // ④ 目标后编排触发器：objective 的 eventMatcher 兼作 when（任务图消费同一事件）。
  //    同时为声明 commitFact 的目标生成事实提交触发器（目标完成同刻提交状态事务，
  //    替代「外部触发器提交事实 + 目标监听事实」旧双件套）。
  for (const group of segmentGroups) {
    const matcher = group.matcher || compileObjectiveEventMatcher(group.step, project);
    if (!matcher?.type) continue;
    if (group.segment.length) {
      triggers.push(withScope({
        id: `trg_${questId}_after_${group.nodeId}`,
        name: `目标完成后续：${group.nodeId}`,
        when: { type: matcher.type, params: clone(matcher.payload || {}) },
        do: group.segment.map(compileStepAction),
        once: true
      }));
    }
    if (group.step && text(group.step.commitFact)) {
      triggers.push(withScope({
        id: `trg_${questId}_commit_${group.nodeId}`,
        name: `目标事实提交：${group.nodeId}`,
        when: { type: matcher.type, params: clone(matcher.payload || {}) },
        do: [{
          action: 'state.transaction',
          params: { definitionId: text(group.step.commitFact) },
          stepId: `commit.${group.nodeId}`
        }],
        once: true
      }));
    }
  }

  // ⑤ 事件编排触发器：when=eventMatcher → do=编排动作链（once 缺省 true）。
  //    事件驱动剧情（波次推进/施粥批次/军队入画等）收编形态——运行行为与手写
  //    触发器完全一致（编译产物），但定义归属任务文件、任务编辑器可见。
  for (const { step, id } of questEvents) {
    const matcher = step.eventMatcher;
    if (!isObject(matcher) || !text(matcher.type)) continue;
    // 身份限定兼容 TaskGraph 契约（payload）与手写触发器（params）两种书写习惯
    const identity = isObject(matcher.payload) ? matcher.payload : (isObject(matcher.params) ? matcher.params : {});
    const doActions = (Array.isArray(step.steps) ? step.steps : []).map(subStep => (
      // 原样触发器动作对象（无 type、含 action/branch 等键）直接透传；其余走 compileStepAction
      isObject(subStep) && !text(subStep.type) ? clone(subStep) : compileStepAction(subStep)
    ));
    triggers.push(withScope({
      id: `trg_${questId}_event_${id}`,
      name: `剧情编排：${text(step.title) || id}`,
      when: { type: text(matcher.type), params: clone(identity) },
      // 条件守卫（编排类触发器的防重入 if）原样透传
      ...(isObject(step.if) ? { if: clone(step.if) } : {}),
      do: doActions,
      once: step.once !== false
    }));
  }

  // ⑥ completion 触发器：task.completed 驱动奖励发放
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

/** Quest 步骤 → 触发器 do 动作（dialogue/tutorial/action；await 支持 dialogue/tutorial）。 */
export function compileStepAction(step) {
  const stepId = `step.${text(step.id)}`;
  if (step.type === 'dialogue') {
    return {
      action: 'dialogue.command',
      params: {
        dialogueId: text(step.dialogueId),
        operation: 'start',
        ...(step.await === true ? { await: true } : {})
      },
      stepId
    };
  }
  if (step.type === 'tutorial') {
    const operation = text(step.operation) || 'show';
    return {
      action: 'tutorial.command',
      params: {
        operation,
        tutorialId: text(step.tutorialId),
        ...(operation === 'showStep' && text(step.tutorialStepId) ? { tutorialStepId: text(step.tutorialStepId) } : {}),
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
export function validateQuestCompilation(compilation, project = null) {
  const errors = [];
  const taskGraphValidation = validateTaskGraphDefinitions(compilation?.taskGraphs || []);
  if (!taskGraphValidation.ok) errors.push(...taskGraphValidation.errors.map(error => `[taskGraph] ${error.path}: ${error.message}`));
  for (const trigger of compilation?.triggers || []) {
    // project 透传：编译产物可含项目级动作（triggerCatalog.actions 登记，如 s01Survival）
    for (const message of validateTriggerDefinition(trigger, project)) {
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
