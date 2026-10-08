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

/**
 * FlowGroup 条件求值器（P1）。
 *
 * 求值 FlowGroup.activeWhen / completionWhen 的 CompositeCondition：
 *   { operator: 'AND'|'OR', children: [ { type: 'leaf', conditionType: 'variable', config } ] }
 * 兼容旧 SceneEvent 编辑器手写的叶子格式（无 operator/children 包装）：
 *   { blackboardKey, path, equals | notEquals | gte | lte | in | exists | value, operator }
 *
 * 数据源为 Blackboard（有 get() 方法）或普通对象（按 key 取属性）。
 * 约定：condition 为空（null/undefined）视为「无门控」恒真。
 */

const text = v => typeof v === 'string' ? v.trim() : '';
const numeric = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/** 宽松相等：严格相等，或双方均可数值化且非布尔时按数值比较（黑板里 "3" 与 3 视为相等）。 */
function looseEquals(actual, expected) {
  if (actual === expected) return true;
  if (actual == null || expected == null) return false;
  if (typeof actual === 'boolean' || typeof expected === 'boolean') return false;
  const a = numeric(actual);
  const b = numeric(expected);
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

function normalizeOperator(op) {
  switch (text(op).toLowerCase()) {
    case '': case 'equals': case 'eq': case '==': return 'equals';
    case 'notequals': case 'ne': case '!=': return 'notEquals';
    case 'gt': case '>': return 'gt';
    case 'gte': case '>=': return 'gte';
    case 'lt': case '<': return 'lt';
    case 'lte': case '<=': return 'lte';
    case 'in': return 'in';
    case 'notexists': return 'notExists';
    case 'exists': return 'exists';
    default: return 'equals';
  }
}

/** 读取黑板上 blackboardKey 对象内的点路径（'a.b.c'）。空路径返回根对象。 */
function readPath(root, path) {
  const segments = text(path).split('.').map(s => s.trim()).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[segment];
  }
  return current;
}

/** 从 Blackboard 实例或普通对象读取变量根。 */
function readRoot(blackboard, key) {
  if (blackboard == null) return undefined;
  if (typeof blackboard.get === 'function') return blackboard.get(key);
  return blackboard[key];
}

function resolveLeafConfig(raw) {
  if (raw.config && typeof raw.config === 'object') return raw.config;
  return raw;
}

/** 旧格式叶子：操作符由键名表达（equals/gte/lte/in/exists…），统一解析为 operator+value。 */
function resolveOperatorAndValue(config) {
  if (text(config.operator)) {
    return {
      operator: normalizeOperator(config.operator),
      value: config.value !== undefined ? config.value : (config.equals !== undefined ? config.equals : true)
    };
  }
  // 旧键名优先级与 SceneEventToFlowGroupMigrator.normalizeLegacyCondition 保持一致
  if ('equals' in config) return { operator: 'equals', value: config.equals };
  if ('notEquals' in config) return { operator: 'notEquals', value: config.notEquals };
  if ('gte' in config) return { operator: 'gte', value: config.gte };
  if ('lte' in config) return { operator: 'lte', value: config.lte };
  if ('gt' in config) return { operator: 'gt', value: config.gt };
  if ('lt' in config) return { operator: 'lt', value: config.lt };
  if ('in' in config) return { operator: 'in', value: config.in };
  if ('notExists' in config) return { operator: 'notExists', value: config.notExists };
  if ('exists' in config) return { operator: 'exists', value: config.exists };
  if ('value' in config) return { operator: 'equals', value: config.value };
  return { operator: 'equals', value: true };
}

function evaluateLeaf(raw, blackboard) {
  const config = resolveLeafConfig(raw);
  const key = text(config.blackboardKey) || 'storyState';
  const root = readRoot(blackboard, key);
  const actual = readPath(root, config.path);
  const { operator, value: expected } = resolveOperatorAndValue(config);
  switch (operator) {
    case 'equals': return looseEquals(actual, expected);
    case 'notEquals': return !looseEquals(actual, expected);
    case 'in': return Array.isArray(expected) && expected.some(entry => looseEquals(actual, entry));
    case 'exists': {
      const exists = actual !== undefined && actual !== null;
      return expected === false ? !exists : exists;
    }
    case 'notExists': return actual === undefined || actual === null;
    case 'gt': case 'gte': case 'lt': case 'lte': {
      const a = numeric(actual);
      const b = numeric(expected);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      if (operator === 'gt') return a > b;
      if (operator === 'gte') return a >= b;
      if (operator === 'lt') return a < b;
      return a <= b;
    }
    default: return false;
  }
}

/**
 * 求值 CompositeCondition（或兼容的旧格式叶子）。
 * @param {Object|null} condition
 * @param {Blackboard|Object|null} blackboard
 * @returns {boolean}
 */
export function evaluateCompositeCondition(condition, blackboard) {
  if (condition == null) return true;
  if (typeof condition !== 'object') return Boolean(condition);
  if (Array.isArray(condition.children) && text(condition.operator)) {
    const operator = text(condition.operator).toUpperCase();
    if (operator === 'OR' || operator === 'ANY' || operator === 'SOME') {
      return condition.children.some(child => evaluateCompositeCondition(child, blackboard));
    }
    // AND / ALL / EVERY（默认）
    return condition.children.every(child => evaluateCompositeCondition(child, blackboard));
  }
  return evaluateLeaf(condition, blackboard);
}

export default { evaluateCompositeCondition };
