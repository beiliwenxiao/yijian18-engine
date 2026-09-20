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

/**
 * ObjectiveTypeRegistry - 任务目标类型注册目录（任务中心制阶段①底座）
 *
 * 目标种类集中登记：事件 matcher 模板、身份字段、进度字段、编辑器展示名。
 * 任务图节点（及后续 Quest v2 的 objective 步骤）只填「目标类型 + 目标身份 + 数量」，
 * eventMatcher 由本目录模板生成，消除策划对原始事件类型的依赖。
 *
 * 目录分层（与 TriggerCatalog.mergeCatalog 同语义）：
 * - 引擎内置 DEFAULT_OBJECTIVE_TYPES（含 custom.event 兜底）；
 * - 项目扩展 project.questCatalog.objectiveTypes 按 type 浅合并覆盖内置条目。
 *
 * 身份字段候选 source 标识（编辑器据此填充下拉候选）：
 * - libraryItems: project.library.items + equipment
 * - commands:     project.commands（state.transaction 定义 ID）
 * - enemyRoles:   内置敌人角色清单
 * - 缺省/未知:    编辑器按字段名走既有候选逻辑（向后兼容）
 */

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.trim() : '';
const STABLE_ID = /^[A-Za-z][A-Za-z0-9._-]*$/;

const CUSTOM_EVENT_TYPE = 'custom.event';

/**
 * 引擎内置目标类型（首批 = S01 任务链所用四类）。
 * - gather.item  采集物品：gathering.completed + itemId，默认按入包份数（progressBy=accepted）累计；
 * - kill.enemy   击杀敌人：击杀事实以 state.transaction 提交（S01 firstWolfKilled），
 *                factHint 供旧数据反推（definitionId 含 kill 字样 → 识别为击杀）；
 * - commit.fact  提交事实：任意 state.transaction 事实成立即完成（幂等，数量恒 1）；
 * - custom.event 自定义事件：完整 eventMatcher 由策划在事件目录中自由选择。
 */
const DEFAULT_OBJECTIVE_TYPES = Object.freeze([
  Object.freeze({
    type: 'gather.item',
    label: '采集物品',
    description: '采集指定物品达到目标份数（按实际入包数量累计）',
    matcherType: 'gathering.completed',
    identityFields: Object.freeze([
      Object.freeze({ name: 'itemId', label: '目标物品', source: 'libraryItems', required: true })
    ]),
    progressBy: 'accepted',
    defaultCount: 3
  }),
  Object.freeze({
    type: 'kill.enemy',
    label: '击杀敌人',
    description: '指定敌人的击杀事实提交后完成（击杀事实由状态事务发布）',
    matcherType: 'state.transaction',
    identityFields: Object.freeze([
      Object.freeze({ name: 'definitionId', label: '击杀事实（状态事务 ID）', source: 'commands', required: true })
    ]),
    progressBy: null,
    defaultCount: 1,
    factHint: /kill/i
  }),
  Object.freeze({
    type: 'commit.fact',
    label: '提交事实',
    description: '指定状态事务提交后完成（幂等事实，目标数量恒为 1）',
    matcherType: 'state.transaction',
    identityFields: Object.freeze([
      Object.freeze({ name: 'definitionId', label: '状态事务 ID', source: 'commands', required: true })
    ]),
    progressBy: null,
    defaultCount: 1
  }),
  Object.freeze({
    type: CUSTOM_EVENT_TYPE,
    label: '自定义事件',
    description: '从事件目录自由选择完成事件与身份限定',
    matcherType: '',
    identityFields: Object.freeze([]),
    progressBy: null,
    defaultCount: 1
  })
]);

/** 目标类型扩展登记的统一校验器；编辑器保存与运行时装配应复用。 */
export function validateObjectiveTypeDefinition(raw) {
  const errors = [];
  const path = 'objectiveTypes[]';
  if (!isObject(raw)) return [`${path} 必须是对象`];
  if (!text(raw.type)) errors.push(`${path}.type 不能为空`);
  else if (!STABLE_ID.test(raw.type.trim())) errors.push(`${path}.type 只能使用字母开头的字母、数字、点、下划线和短横线`);
  if (!text(raw.label)) errors.push(`${path}.label 不能为空`);
  if (typeof raw.matcherType !== 'string' || (raw.type !== CUSTOM_EVENT_TYPE && !text(raw.matcherType))) {
    errors.push(`${path}.matcherType 必须是非空事件类型（custom.event 可为空字符串）`);
  }
  if (raw.identityFields !== undefined) {
    if (!Array.isArray(raw.identityFields)) {
      errors.push(`${path}.identityFields 必须是数组`);
    } else {
      raw.identityFields.forEach((field, index) => {
        const fieldPath = `${path}.identityFields[${index}]`;
        if (!isObject(field)) { errors.push(`${fieldPath} 必须是对象`); return; }
        if (!text(field.name)) errors.push(`${fieldPath}.name 不能为空`);
        if (!text(field.label)) errors.push(`${fieldPath}.label 不能为空`);
      });
    }
  }
  if (raw.progressBy !== undefined && raw.progressBy !== null && !text(raw.progressBy)) {
    errors.push(`${path}.progressBy 必须为非空的事件数量字段名或 null`);
  }
  if (raw.defaultCount !== undefined && (!Number.isInteger(raw.defaultCount) || raw.defaultCount < 1)) {
    errors.push(`${path}.defaultCount 必须为正整数`);
  }
  return errors;
}

/** 规范化目标类型描述符（缺省字段补齐；非法输入返回 null）。 */
export function normalizeObjectiveTypeDefinition(raw) {
  if (!isObject(raw) || !text(raw.type)) return null;
  const identityFields = Array.isArray(raw.identityFields)
    ? raw.identityFields
      .filter(field => isObject(field) && text(field.name) && text(field.label))
      .map(field => Object.freeze({
        name: text(field.name),
        label: text(field.label),
        ...(text(field.source) ? { source: text(field.source) } : {}),
        ...(field.required === true ? { required: true } : {})
      }))
    : [];
  return Object.freeze({
    type: text(raw.type),
    label: text(raw.label) || text(raw.type),
    ...(text(raw.description) ? { description: text(raw.description) } : {}),
    matcherType: typeof raw.matcherType === 'string' ? raw.matcherType.trim() : '',
    identityFields,
    progressBy: text(raw.progressBy) || null,
    ...(Number.isInteger(raw.defaultCount) && raw.defaultCount >= 1 ? { defaultCount: raw.defaultCount } : {}),
    ...(raw.factHint instanceof RegExp ? { factHint: raw.factHint } : {})
  });
}

function mergeObjectiveTypes(base, extra = []) {
  const merged = new Map(base.map(item => [item.type, item]));
  for (const raw of extra || []) {
    const normalized = normalizeObjectiveTypeDefinition(raw);
    if (!normalized) continue;
    const previous = merged.get(normalized.type);
    if (!previous) { merged.set(normalized.type, normalized); continue; }
    // 项目条目允许只写需要覆盖的字段：未提供的语义字段保留内置值
    merged.set(normalized.type, Object.freeze({
      ...previous,
      ...normalized,
      matcherType: normalized.matcherType || previous.matcherType || '',
      identityFields: normalized.identityFields.length ? normalized.identityFields : previous.identityFields,
      progressBy: normalized.progressBy ?? previous.progressBy ?? null
    }));
  }
  return Object.freeze([...merged.values()]);
}

/** 内置 + 项目扩展合并后的目标类型目录（project 可省略）。 */
export function getObjectiveTypes(project = null) {
  const extra = project?.questCatalog?.objectiveTypes;
  if (!Array.isArray(extra) || extra.length === 0) return DEFAULT_OBJECTIVE_TYPES;
  return mergeObjectiveTypes(DEFAULT_OBJECTIVE_TYPES, extra);
}

export function getObjectiveTypeDescriptor(type, project = null) {
  const key = text(type);
  if (!key) return null;
  return getObjectiveTypes(project).find(item => item.type === key) || null;
}

/** 编辑器下拉选项 [{value,label}]。 */
export function objectiveTypeOptions(project = null) {
  return getObjectiveTypes(project).map(item => ({ value: item.type, label: item.label }));
}

/**
 * 由目标类型描述符 + 身份字段值 + 保留字段生成完整 eventMatcher。
 * 空身份值剔除；identityValues 优先于 extraPayload；payload 全空时输出 {}。
 */
export function buildEventMatcher(descriptor, identityValues = {}, extraPayload = {}) {
  const payload = { ...(isObject(extraPayload) ? extraPayload : {}) };
  const values = isObject(identityValues) ? identityValues : {};
  for (const field of descriptor?.identityFields || []) {
    const value = values[field.name];
    if (value === undefined || value === null || text(String(value)) === '') delete payload[field.name];
    else payload[field.name] = value;
  }
  const matcherType = descriptor?.matcherType || '';
  return Object.freeze({ type: matcherType, payload: Object.freeze(payload) });
}

function identityValuesOf(descriptor, payload = {}) {
  const values = {};
  for (const field of descriptor?.identityFields || []) {
    const value = payload?.[field.name];
    values[field.name] = value === undefined || value === null ? '' : String(value);
  }
  return values;
}

function extraPayloadOf(descriptor, payload = {}) {
  const identityNames = new Set((descriptor?.identityFields || []).map(field => field.name));
  const extra = {};
  for (const [key, value] of Object.entries(isObject(payload) ? payload : {})) {
    if (!identityNames.has(key)) extra[key] = value;
  }
  return extra;
}

/**
 * 由现有 eventMatcher 反推目标类型（旧数据无 objectiveType 字段时的回显路径）。
 * 命中规则：matcherType 相同且全部 required 身份字段存在于 payload；
 * 多候选时优先 factHint 匹配者（如 definitionId 含 kill → kill.enemy）。
 * 无命中时回退 custom.event（extraPayload 保留全部 payload）。
 */
export function matchObjectiveType(eventMatcher, project = null) {
  const type = text(eventMatcher?.type);
  const payload = isObject(eventMatcher?.payload) ? eventMatcher.payload : {};
  const types = getObjectiveTypes(project);
  const candidates = types.filter(item => item.type !== CUSTOM_EVENT_TYPE && item.matcherType === type
    && (item.identityFields || []).every(field => field.required !== true || payload[field.name] !== undefined))
    .map(item => ({ item, values: identityValuesOf(item, payload) }));
  // 带 factHint 的类型（kill.enemy）仅在启发式命中身份值时可选；无 hint 类型（commit.fact）总可选
  const eligible = candidates.filter(entry => !(entry.item.factHint instanceof RegExp)
    || entry.item.factHint.test(Object.values(entry.values).join(' ')));
  const selected = eligible[0]?.item || null;
  if (selected) {
    const values = eligible[0].values;
    return { type: selected.type, descriptor: selected, identityValues: values, extraPayload: extraPayloadOf(selected, payload) };
  }
  const custom = types.find(item => item.type === CUSTOM_EVENT_TYPE) || null;
  return { type: custom?.type || CUSTOM_EVENT_TYPE, descriptor: custom, identityValues: {}, extraPayload: { ...payload } };
}

/** 目标节点的数量累计字段：节点显式 progressBy 优先，否则目录默认。 */
export function progressFieldFor(node, descriptor) {
  if (text(node?.progressBy)) return text(node.progressBy);
  return descriptor?.progressBy || null;
}

export default {
  validateObjectiveTypeDefinition,
  normalizeObjectiveTypeDefinition,
  getObjectiveTypes,
  getObjectiveTypeDescriptor,
  objectiveTypeOptions,
  buildEventMatcher,
  matchObjectiveType,
  progressFieldFor
};
