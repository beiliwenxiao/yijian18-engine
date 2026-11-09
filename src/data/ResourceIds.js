/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://github.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * ResourceIds.js
 * 资源键常量（单一来源）。
 *
 * 资源键同时用于：采集节点 resourceType、城池 resources 整数表、军团/建筑成本表。
 * `coin` 是城池金库与招募成本口径的资源键，但**不是采矿产出**，故不进入
 * `RESOURCE_NODE_TYPES`——避免"铜钱矿点"成为合法采集数据。
 */

/** 全部资源键（含 coin）。 */
export const RESOURCE_IDS = Object.freeze(['wood', 'iron', 'food', 'herb', 'stone', 'coin']);

/** 可由采集节点产出的资源键（不含 coin）。 */
export const RESOURCE_NODE_TYPES = Object.freeze(RESOURCE_IDS.filter(key => key !== 'coin'));

const RESOURCE_ID_SET = new Set(RESOURCE_IDS);
const RESOURCE_NODE_TYPE_SET = new Set(RESOURCE_NODE_TYPES);

/** 是否为合法资源键（含 coin）。 */
export function isResourceId(value) {
  return typeof value === 'string' && RESOURCE_ID_SET.has(value);
}

/** 是否为可采集资源键（不含 coin）。 */
export function isResourceNodeType(value) {
  return typeof value === 'string' && RESOURCE_NODE_TYPE_SET.has(value);
}

export default RESOURCE_IDS;
