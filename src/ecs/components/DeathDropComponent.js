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

import { Component } from '../Component.js';
import {
  getItemRuntimeQuantity,
  isItemInstanceState,
  normalizeItemRuntimeState,
  serializeItemRuntimeState,
  validateItemRuntimeStates
} from '../../systems/items/ItemRuntimeState.js';

function createStack(stack, index, definitionResolver) {
  const state = normalizeItemRuntimeState(stack.runtimeState || stack);
  const result = {
    id: stack.id || `${state.definitionId}-${index}`,
    definitionId: state.definitionId,
    instanceId: isItemInstanceState(state) ? state.instanceId : null,
    mutable: isItemInstanceState(state) ? { ...state.mutable } : null,
    quantity: getItemRuntimeQuantity(state)
  };
  Object.defineProperty(result, 'item', {
    enumerable: false,
    get() {
      const definition = definitionResolver?.(result.definitionId);
      if (!definition) return null;
      return result.instanceId
        ? { ...definition, instanceId: result.instanceId, ...(result.mutable || {}) }
        : definition;
    }
  });
  return result;
}

function stackRuntimeState(stack) {
  return stack.instanceId
    ? { definitionId: stack.definitionId, instanceId: stack.instanceId, mutable: { ...(stack.mutable || {}) } }
    : { definitionId: stack.definitionId, quantity: stack.quantity };
}

/** DeathDrop ECS 投影；只保存 definition/instance 引用、quantity 与最小 mutable state。 */
export class DeathDropComponent extends Component {
  constructor(config = {}) {
    super('deathDrop');
    this.schemaVersion = 2;
    this.deathId = config.deathId || '';
    this.definitionResolver = typeof config.definitionResolver === 'function' ? config.definitionResolver : null;
    this.stacks = (config.stacks || []).map((stack, index) => createStack(stack, index, this.definitionResolver));
  }

  take(stackId, quantity) {
    const stack = this.stacks.find(entry => entry.id === stackId);
    if (!stack) return 0;
    const accepted = Math.min(stack.quantity, Math.max(0, Math.floor(Number(quantity) || 0)));
    stack.quantity -= accepted;
    if (stack.quantity <= 0) this.stacks.splice(this.stacks.indexOf(stack), 1);
    return accepted;
  }

  isEmpty() { return this.stacks.length === 0; }

  validateSerialized(data, { hasDefinition = null } = {}) {
    if (!data || ![1, 2].includes(data.schemaVersion) || typeof data.deathId !== 'string'
      || !data.deathId || !Array.isArray(data.stacks)) {
      return { ok: false, code: 'invalidDeathDropSnapshot', errors: [] };
    }
    const ids = new Set();
    const states = data.stacks.map(stack => stack?.runtimeState || stack);
    const checked = validateItemRuntimeStates(states, { hasDefinition, path: 'stacks' });
    const errors = [...checked.errors];
    data.stacks.forEach((stack, index) => {
      if (typeof stack?.id !== 'string' || !stack.id || ids.has(stack.id)) {
        errors.push({ code: 'invalidDeathDropState', path: `stacks[${index}].id`, message: '掉落 stack id 无效或重复' });
      }
      ids.add(stack?.id);
    });
    return { ok: errors.length === 0, code: errors[0]?.code || null, errors, states: checked.states };
  }

  deserialize(data) {
    const checked = this.validateSerialized(data, {
      hasDefinition: this.definitionResolver ? id => Boolean(this.definitionResolver(id)) : null
    });
    if (!checked.ok) return { ok: false, code: checked.code, errors: checked.errors };
    this.deathId = data.deathId;
    this.stacks = data.stacks.map((stack, index) => createStack({
      id: stack.id,
      runtimeState: checked.states[index]
    }, index, this.definitionResolver));
    return { ok: true };
  }

  serialize() {
    return {
      schemaVersion: this.schemaVersion,
      deathId: this.deathId,
      stacks: this.stacks.map(stack => ({
        id: stack.id,
        ...serializeItemRuntimeState(stackRuntimeState(stack))
      }))
    };
  }

  destroy() {
    this.definitionResolver = null;
    super.destroy();
  }
}

export default DeathDropComponent;
