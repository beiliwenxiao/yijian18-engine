/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 ************************************************************/

import { DefinitionRepository } from './DefinitionRepository.js';

/**
 * 兼容只读 Registry Facade。
 * 定义权威只存在于 DefinitionRepository；Facade 不持有 Map，也不允许逐项写入。
 */
export class Registry {
  constructor(name = 'registry', idKey = 'id', repository = DefinitionRepository.empty()) {
    this.name = name;
    this.idKey = idKey;
    this.repository = repository;
    this.definitionRevision = repository.definitionRevision;
    Object.freeze(this);
  }

  get(id) { return this.repository.get(this.name, id); }
  has(id) { return this.repository.has(this.name, id); }
  all() { return this.repository.all(this.name); }
  ids() { return this.repository.ids(this.name); }
  get size() { return this.repository.size(this.name); }

  register() { throw this._readonlyError('register'); }
  registerAll() { throw this._readonlyError('registerAll'); }
  remove() { throw this._readonlyError('remove'); }
  clear() { throw this._readonlyError('clear'); }

  _readonlyError(operation) {
    const error = new TypeError(`Registry(${this.name}) is read-only; ${operation} definitions through CanonicalSnapshot publication`);
    error.code = 'readOnlyDefinitionRegistry';
    return error;
  }

  /** 存档只记录 revision/ID 引用，不复制完整定义。 */
  serialize() {
    return Object.freeze({
      kind: this.name,
      definitionRevision: this.definitionRevision,
      ids: this.ids()
    });
  }
}

export const STANDARD_REGISTRY_KINDS = Object.freeze([
  'npcs', 'enemies', 'items', 'equipment', 'shops', 'classes', 'skills',
  'vehicles', 'buildings', 'resourceNodes', 'armies',
  // M0 底座：生产/兵种/阵法/武将/官职五类内容库（纯数据，M1~M5 消费）
  'recipes', 'unitTypes', 'formations', 'heroes', 'ranks',
  // M2：押运队模板（装配时绑定载具/护卫/容量）
  'convoys'
]);

/** 创建委托同一只读 repository revision 的标准 Registry Facade。 */
export function createStandardRegistries(repository = DefinitionRepository.empty()) {
  return Object.freeze(Object.fromEntries(
    STANDARD_REGISTRY_KINDS.map(kind => [kind, new Registry(kind, 'id', repository)])
  ));
}

export default Registry;
