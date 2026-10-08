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

import { FlowGroupDefinitionRepository } from '../core/scene/FlowGroupDefinitionRepository.js';
import { resolveFlowGroupId } from '../migration/SceneEventToFlowGroupMigrator.js';

// @deprecated 兼容别名（旧名 SceneEventDefinitionRepository → 新名 FlowGroupDefinitionRepository）
const SceneEventDefinitionRepository = FlowGroupDefinitionRepository;

/**
 * Tutorial definitions 的不可变只读索引。
 * TutorialSystem 只借用该索引并保存运行进度，不拥有可变 definition Map。
 */
const cloneValue = value => {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, child]) => typeof child !== 'function')
      .map(([key, child]) => [key, cloneValue(child)]));
  }
  return value;
};

const deepFreeze = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

function normalizeDefinition(input) {
  if (!input?.id || typeof input.id !== 'string') {
    throw new TypeError(`Invalid TutorialDefinition: ${String(input?.id)}`);
  }
  // 双读：flowGroupId 优先，回退 sceneEventId；归一化后两者同时写（保证旧代码读取兼容）
  const fgId = resolveFlowGroupId(input);
  return deepFreeze({
    ...cloneValue(input),
    id: input.id,
    flowGroupId: fgId,
    sceneEventId: fgId,
    title: input.title || '教程',
    description: input.description || '',
    steps: Array.isArray(input.steps) ? cloneValue(input.steps) : [],
    pauseGame: input.pauseGame === true,
    canSkip: input.canSkip !== false,
    priority: Number.isFinite(input.priority) ? input.priority : 0,
    category: input.category || 'general',
    scope: input.scope ? cloneValue(input.scope) : null,
    order: Number.isFinite(input.order) ? input.order : 0,
    signalRules: Array.isArray(input.signalRules) ? cloneValue(input.signalRules) : [],
    movementRule: input.movementRule ? cloneValue(input.movementRule) : null,
    completionPolicy: input.completionPolicy || 'allSteps',
    autoAdvance: input.autoAdvance === true,
    autoTrigger: input.autoTrigger === true
  });
}

export class TutorialDefinitionRepository {
  /**
   * @param flowGroupDefinitions  FlowGroupDefinition[]（新命名）
   * @param sceneEventDefinitions SceneEventDefinition[]（兼容旧名，优先级低于 flowGroupDefinitions）
   */
  constructor(definitions = [], { flowGroupDefinitions, sceneEventDefinitions } = {}) {
    // 双轨解析：优先 flowGroupDefinitions，回退 sceneEventDefinitions；两者都允许
    // 是 FlowGroupDefinitionRepository 实例（GameLoader 装配路径）或定义数组。
    const fgDefs = flowGroupDefinitions instanceof FlowGroupDefinitionRepository
      ? flowGroupDefinitions
      : (Array.isArray(flowGroupDefinitions) && flowGroupDefinitions.length > 0
        ? flowGroupDefinitions
        : (sceneEventDefinitions instanceof FlowGroupDefinitionRepository
          ? sceneEventDefinitions
          : (sceneEventDefinitions || [])));
    this.flowGroupDefinitions = FlowGroupDefinitionRepository.from(fgDefs);
    this.sceneEventDefinitions = this.flowGroupDefinitions; // 兼容：同引用别名
    this._definitions = new Map();
    this._definitionIndexes = new Map();
    for (const [index, input] of definitions.entries()) {
      const definition = normalizeDefinition(input);
      if (this._definitions.has(definition.id)) {
        throw new TypeError(`Invalid or duplicate TutorialDefinition: ${definition.id}`);
      }
      const fgId = definition.flowGroupId || definition.sceneEventId;
      // 全 Trigger 化后 flowGroupId 仅为兼容标签：不再要求所属 FlowGroup 已登记
      // （flowGroups/sceneEvents 目录已清空为 []），教程顺序完全由 Trigger 编排驱动。
      this._definitions.set(definition.id, definition);
      this._definitionIndexes.set(definition.id, index);
    }
    Object.freeze(this);
  }

  static from(definitions = [], options = {}) {
    return definitions instanceof TutorialDefinitionRepository
      ? definitions
      : new TutorialDefinitionRepository(definitions, options);
  }

  get size() { return this._definitions.size; }
  get(id) { return this._definitions.get(id) || null; }
  has(id) { return this._definitions.has(id); }
  values() { return this._definitions.values(); }
  all() { return Object.freeze([...this._definitions.values()]); }
  getFlowGroupDefinitions() { return this.flowGroupDefinitions.all(); }
  /** @deprecated 使用 getFlowGroupDefinitions() */
  getSceneEventDefinitions() { return this.flowGroupDefinitions.all(); }

  compare(left, right) {
    if (left === right) return 0;
    const leftFgId = (left?.flowGroupId || left?.sceneEventId) || '';
    const rightFgId = (right?.flowGroupId || right?.sceneEventId) || '';
    const leftFg = leftFgId && this.flowGroupDefinitions.has(leftFgId) ? leftFgId : '';
    const rightFg = rightFgId && this.flowGroupDefinitions.has(rightFgId) ? rightFgId : '';
    if (leftFg && rightFg && leftFg !== rightFg) {
      const fgOrder = this.flowGroupDefinitions.compareIds(leftFg, rightFg);
      if (fgOrder !== 0) return fgOrder;
    } else if (leftFg !== rightFg) {
      return leftFg ? -1 : 1;
    }
    if (!leftFg && !rightFg && left.order !== right.order) return left.order - right.order;
    return right.priority - left.priority
      || (this._definitionIndexes.get(left.id) ?? 0) - (this._definitionIndexes.get(right.id) ?? 0)
      || left.id.localeCompare(right.id);
  }

  withDefinition(id, input) {
    if (!id || !input) throw new TypeError('Invalid TutorialDefinition');
    const definitions = [...this._definitions.values(), { ...input, id }]
      .filter((definition, index, all) => all.findLastIndex(item => item.id === definition.id) === index);
    return new TutorialDefinitionRepository(definitions, {
      flowGroupDefinitions: this.flowGroupDefinitions
    });
  }
}

export default TutorialDefinitionRepository;
