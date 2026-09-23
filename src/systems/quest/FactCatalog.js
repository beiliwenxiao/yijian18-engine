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
 * FactCatalog - 事实目录（任务中心制底座，解决事实表述六轨并行）
 *
 * 统一登记「事实」：任务接取条件、目标达成、OnboardingUI 显示条件等共用一份目录，
 * 策划在所有消费点看到同一个事实名。
 *
 * 事实来源分两类：
 * - transaction：由 commands[] 的 state.transaction 定义自动派生（writes target:'story'
 *   的 path 即事实字段），与 reconcileTaskFacts 的推导逻辑同源（阶段③场景层对账迁移的共享底座）；
 * - event：项目在 questCatalog.facts 手工登记的事件型事实（eventType + identityPayload）。
 *
 * 项目扩展 project.questCatalog.facts 按 id 合并：可覆盖自动派生条目的 label，
 * 或登记事件型事实。合并语义与 ObjectiveTypeRegistry 一致（未提供的字段保留先前值）。
 */

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.trim() : '';

/** 从 commands[] 的 state.transaction 定义派生事实清单（reconcileTaskFacts 同源推导）。 */
export function deriveFactsFromCommands(project = null) {
  const facts = [];
  for (const command of Array.isArray(project?.commands) ? project.commands : []) {
    if (command?.commandType !== 'state.transaction' || !text(command.id)) continue;
    const writes = Array.isArray(command.transaction?.writes) ? command.transaction.writes : [];
    const paths = writes
      .filter(write => write?.target === 'story' && text(write.path))
      .map(write => text(write.path));
    facts.push({
      id: text(command.id),
      label: text(command.name) || tailLabel(command.id),
      source: 'transaction',
      paths
    });
  }
  return facts;
}

function tailLabel(id) {
  const segments = text(id).split('.').filter(Boolean);
  return segments[segments.length - 1] || text(id);
}

/**
 * 完整事实目录：commands 自动派生 + project.questCatalog.facts 合并。
 * 项目条目按 id 覆盖/新增；覆盖时未提供的字段保留先前值。
 */
export function buildFactCatalog(project = null) {
  const merged = new Map(deriveFactsFromCommands(project).map(fact => [fact.id, fact]));
  for (const raw of Array.isArray(project?.questCatalog?.facts) ? project.questCatalog.facts : []) {
    const normalized = normalizeFactDefinition(raw);
    if (!normalized) continue;
    const previous = merged.get(normalized.id);
    merged.set(normalized.id, previous ? { ...previous, ...normalized } : normalized);
  }
  return [...merged.values()];
}

/** 规范化事实登记（非法输入返回 null）。 */
export function normalizeFactDefinition(raw) {
  if (!isObject(raw) || !text(raw.id)) return null;
  const source = text(raw.source) || (text(raw.eventType) ? 'event' : 'transaction');
  const fact = {
    id: text(raw.id),
    label: text(raw.label) || tailLabel(raw.id),
    source
  };
  if (Array.isArray(raw.paths)) fact.paths = raw.paths.map(text).filter(Boolean);
  if (text(raw.eventType)) fact.eventType = text(raw.eventType);
  if (isObject(raw.identityPayload)) fact.identityPayload = { ...raw.identityPayload };
  return fact;
}

/** 编辑器下拉选项 [{value,label}]——label 为「中文名（ID）」，便于策划对照引用。 */
export function getFactOptions(project = null) {
  return buildFactCatalog(project).map(fact => ({ value: fact.id, label: `${fact.label}（${fact.id}）` }));
}

/**
 * 按事实 ID 查询定义（accept 条件编译、对账共享逻辑使用）。
 * 未登记的 transaction 来源 ID 仍可通过 commands 直查——此处只查目录。
 */
export function getFactDefinition(factId, project = null) {
  const key = text(factId);
  if (!key) return null;
  return buildFactCatalog(project).find(fact => fact.id === key) || null;
}

/** definitionId → story 事实字段路径清单（reconcile 对账共享推导，阶段③场景层迁移用）。 */
export function factPathsByDefinitionId(project = null) {
  const map = new Map();
  for (const fact of deriveFactsFromCommands(project)) {
    if (fact.paths.length) map.set(fact.id, fact.paths);
  }
  return map;
}

export default {
  deriveFactsFromCommands,
  buildFactCatalog,
  normalizeFactDefinition,
  getFactOptions,
  getFactDefinition,
  factPathsByDefinitionId
};
