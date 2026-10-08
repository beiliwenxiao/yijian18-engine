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

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ALLOWED_MUTABLE_FIELDS = Object.freeze(['durability', 'binding', 'charges', 'container']);

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function positiveQuantity(value, fallback = 1) {
  const quantity = value === undefined ? fallback : Number(value);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : 0;
}

function extractMutable(source = {}) {
  const input = isObject(source.mutable) ? source.mutable : source;
  const mutable = {};
  for (const key of ALLOWED_MUTABLE_FIELDS) {
    if (input[key] !== undefined) mutable[key] = clone(input[key]);
  }
  return mutable;
}

export function isItemInstanceState(state) {
  return typeof state?.instanceId === 'string' && state.instanceId.length > 0;
}

export function createItemStack(definitionId, quantity = 1) {
  if (typeof definitionId !== 'string' || !definitionId || positiveQuantity(quantity) === 0) {
    throw new TypeError('ItemStack requires definitionId and positive integer quantity');
  }
  return { definitionId, quantity };
}

export function createItemInstanceState(definitionId, instanceId, mutable = {}) {
  if (typeof definitionId !== 'string' || !definitionId || typeof instanceId !== 'string' || !instanceId) {
    throw new TypeError('ItemInstanceState requires definitionId and instanceId');
  }
  return { definitionId, instanceId, mutable: extractMutable(mutable) };
}

/** 将 legacy item/stack 或 canonical state 收口为最小运行态，不保留定义、表现和资源路径。 */
export function normalizeItemRuntimeState(input, { quantity = undefined } = {}) {
  if (!isObject(input)) throw new TypeError('item runtime state must be an object');
  const legacyItem = isObject(input.item) ? input.item : null;
  const definitionId = input.definitionId || input.itemId || legacyItem?.definitionId || legacyItem?.id || input.id;
  const instanceId = input.instanceId || legacyItem?.instanceId || null;
  const resolvedQuantity = positiveQuantity(quantity ?? input.quantity, 1);
  if (typeof definitionId !== 'string' || !definitionId || resolvedQuantity === 0) {
    throw new TypeError('item runtime state requires definitionId and positive quantity');
  }
  const mutable = extractMutable({ ...(legacyItem || {}), ...(input.mutable || {}), ...input });
  const hasMutable = Object.keys(mutable).length > 0;
  if (instanceId || hasMutable) {
    if (typeof instanceId !== 'string' || !instanceId) {
      throw new TypeError(`instanceId required for mutable item state: ${definitionId}`);
    }
    if (resolvedQuantity !== 1) throw new TypeError(`instance item quantity must be 1: ${definitionId}`);
    return createItemInstanceState(definitionId, instanceId, mutable);
  }
  return createItemStack(definitionId, resolvedQuantity);
}

export function validateItemRuntimeState(input, { hasDefinition = null, path = 'itemRuntimeState' } = {}) {
  const errors = [];
  let state;
  try {
    state = normalizeItemRuntimeState(input);
  } catch (error) {
    return { ok: false, state: null, errors: [{ code: 'invalidItemRuntimeState', path, message: error.message }] };
  }
  if (hasDefinition && !hasDefinition(state.definitionId)) {
    errors.push({ code: 'invalidReference', path: `${path}.definitionId`,
      message: `物品定义不存在: ${state.definitionId}` });
  }
  if (isItemInstanceState(state)) {
    const { mutable } = state;
    if (mutable.durability !== undefined && (!Number.isInteger(mutable.durability) || mutable.durability < 0)) {
      errors.push({ code: 'outOfRange', path: `${path}.mutable.durability`, message: 'durability 必须为非负整数' });
    }
    if (mutable.charges !== undefined && (!Number.isFinite(mutable.charges) || mutable.charges < 0)) {
      errors.push({ code: 'outOfRange', path: `${path}.mutable.charges`, message: 'charges 必须为非负数' });
    }
    if (mutable.container !== undefined && !Array.isArray(mutable.container)) {
      errors.push({ code: 'typeMismatch', path: `${path}.mutable.container`, message: 'container 必须为数组' });
    }
  }
  return { ok: errors.length === 0, state, errors };
}

/** 先验证全部 definition/instance 引用，再返回可用于 shadow ECS 重建的规范状态。 */
export function validateItemRuntimeStates(inputs, options = {}) {
  if (!Array.isArray(inputs)) {
    return { ok: false, states: [], errors: [{ code: 'typeMismatch', path: options.path || 'itemRuntimeStates', message: '必须为数组' }] };
  }
  const states = [];
  const errors = [];
  const instanceIds = new Set();
  inputs.forEach((input, index) => {
    const checked = validateItemRuntimeState(input, { ...options, path: `${options.path || 'itemRuntimeStates'}[${index}]` });
    errors.push(...checked.errors);
    if (!checked.state) return;
    if (isItemInstanceState(checked.state)) {
      if (instanceIds.has(checked.state.instanceId)) {
        errors.push({ code: 'duplicateId', path: `${options.path || 'itemRuntimeStates'}[${index}].instanceId`,
          message: `重复物品实例: ${checked.state.instanceId}` });
      }
      instanceIds.add(checked.state.instanceId);
    }
    states.push(checked.state);
  });
  return { ok: errors.length === 0, states, errors };
}

export function serializeItemRuntimeState(state) {
  const normalized = normalizeItemRuntimeState(state);
  return isItemInstanceState(normalized)
    ? { definitionId: normalized.definitionId, instanceId: normalized.instanceId, mutable: clone(normalized.mutable) }
    : { definitionId: normalized.definitionId, quantity: normalized.quantity };
}

export function getItemRuntimeQuantity(state) {
  return isItemInstanceState(state) ? 1 : positiveQuantity(state?.quantity, 0);
}

export { ALLOWED_MUTABLE_FIELDS };
