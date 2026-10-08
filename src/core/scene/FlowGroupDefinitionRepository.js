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

import { cloneCanonicalValue, deepFreeze } from '../CanonicalSnapshot.js';

const asList = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value.trim() : '';

/**
 * 规范化一条 FlowGroup 定义。
 * 兼容旧 SceneEvent 格式（所有字段 1:1 映射，扩展新增 control 字段默认值）。
 */
function normalizeDefinition(input, index) {
  const id = text(input?.id);
  if (!id) throw new TypeError(`FlowGroupDefinition[${index}].id 必须是非空字符串`);
  const rawSceneIds = asList(input?.scope?.sceneIds ?? input?.sceneIds);
  const sceneIds = [...new Set(rawSceneIds.map(text).filter(Boolean))];
  if (sceneIds.length === 0) {
    throw new TypeError(`FlowGroupDefinition ${id}.scope.sceneIds 必须包含场景`);
  }
  const order = Number(input?.order);
  if (!Number.isInteger(order) || order < 0) {
    throw new TypeError(`FlowGroupDefinition ${id}.order 必须是非负整数`);
  }
  const rawControl = input?.control && typeof input.control === 'object' ? input.control : {};
  const control = deepFreeze({
    autoActivate: rawControl.autoActivate !== false,
    autoComplete: rawControl.autoComplete !== false,
    repeatable: rawControl.repeatable === true,
    maxProgress: Number.isFinite(rawControl.maxProgress) ? Number(rawControl.maxProgress) : null,
    notifyProgressEvery: Number.isInteger(rawControl.notifyProgressEvery) && rawControl.notifyProgressEvery > 0
      ? rawControl.notifyProgressEvery
      : 10
  });

  // activeWhen / completionWhen 保留原样，在 Coordinator 层做兼容归一化
  const normalized = {
    ...cloneCanonicalValue(input),
    id,
    name: text(input.name) || id,
    description: text(input.description),
    scope: { sceneIds },
    order,
    dependsOn: [...new Set(asList(input.dependsOn ?? input?.dependsOn).map(text).filter(Boolean))],
    control
  };
  if (input?.activeWhen && typeof input.activeWhen === 'object') normalized.activeWhen = cloneCanonicalValue(input.activeWhen);
  if (input?.completionWhen && typeof input.completionWhen === 'object') normalized.completionWhen = cloneCanonicalValue(input.completionWhen);
  return deepFreeze(normalized);
}

/**
 * FlowGroup 的不可变定义索引。
 * - 管理宏观流程身份、依赖（DAG 无环校验）、场景 scope、order 排序
 * - 运行时状态不归此处管理，见 FlowGroupInstanceRepository + FlowGroupCoordinator
 *
 * 兼容：本类是旧 SceneEventDefinitionRepository 的继任者；字段名双轨兼容期内
 * `sceneEvent` 相关命名在旧代码中通过 alias 包装。
 */
export class FlowGroupDefinitionRepository {
  constructor(definitions = []) {
    this._definitions = new Map();
    this._definitionIndexes = new Map();
    this._byScene = new Map();

    asList(definitions).forEach((input, index) => {
      const definition = normalizeDefinition(input, index);
      if (this._definitions.has(definition.id)) {
        throw new TypeError(`重复 FlowGroupDefinition: ${definition.id}`);
      }
      this._definitions.set(definition.id, definition);
      this._definitionIndexes.set(definition.id, index);
      for (const sceneId of definition.scope.sceneIds) {
        const entries = this._byScene.get(sceneId) || [];
        if (entries.some(entry => entry.order === definition.order)) {
          throw new TypeError(`场景 ${sceneId} 存在重复 FlowGroup.order: ${definition.order}`);
        }
        entries.push(definition);
        this._byScene.set(sceneId, entries);
      }
    });

    // dependsOn DAG 无环校验
    for (const definition of this._definitions.values()) {
      for (const dependencyId of definition.dependsOn) {
        if (dependencyId === definition.id || !this._definitions.has(dependencyId)) {
          throw new TypeError(`FlowGroupDefinition ${definition.id} 依赖不存在或依赖自身: ${dependencyId}`);
        }
      }
    }
    this._assertAcyclic();

    for (const [sceneId, entries] of this._byScene) {
      entries.sort((left, right) => this.compareIds(left.id, right.id));
      this._byScene.set(sceneId, Object.freeze([...entries]));
    }
    Object.freeze(this);
  }

  static from(value = []) {
    return value instanceof FlowGroupDefinitionRepository
      ? value
      : new FlowGroupDefinitionRepository(value);
  }

  static empty() {
    return new FlowGroupDefinitionRepository();
  }

  get size() { return this._definitions.size; }
  has(id) { return this._definitions.has(text(id)); }
  get(id) { return this._definitions.get(text(id)) || null; }
  values() { return this._definitions.values(); }
  all() { return Object.freeze([...this._definitions.values()]); }
  getForScene(sceneId) { return this._byScene.get(text(sceneId)) || Object.freeze([]); }
  getOrder(id) { return this.get(id)?.order ?? null; }

  compareIds(leftId, rightId) {
    if (leftId === rightId) return 0;
    const left = this.get(leftId);
    const right = this.get(rightId);
    if (!left && !right) return String(leftId).localeCompare(String(rightId));
    if (!left) return 1;
    if (!right) return -1;
    return left.order - right.order
      || (this._definitionIndexes.get(left.id) ?? 0) - (this._definitionIndexes.get(right.id) ?? 0)
      || left.id.localeCompare(right.id);
  }

  _assertAcyclic() {
    const visiting = new Set();
    const visited = new Set();
    const visit = id => {
      if (visiting.has(id)) throw new TypeError(`FlowGroupDefinition 依赖形成循环: ${id}`);
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dependencyId of this.get(id)?.dependsOn || []) visit(dependencyId);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of this._definitions.keys()) visit(id);
  }
}

/**
 * @deprecated 请使用 FlowGroupDefinitionRepository。SceneEvent 重命名为 FlowGroup；
 *             本类作为兼容别名，保留一个大版本后删除。
 */
export const SceneEventDefinitionRepository = FlowGroupDefinitionRepository;

export default FlowGroupDefinitionRepository;
