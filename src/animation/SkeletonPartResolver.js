/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @date      2026-10-09
 ************************************************************/

/**
 * SkeletonPartResolver - 骨骼部件解析器
 *
 * 从内容库 DefinitionRepository 解析 skeletonParts 定义，
 * 为骨骼编辑器、运行时槽位联动、物品投影提供统一的部件查询。
 */

/**
 * 读取物品的武器标识（面向装备槽位联动）。
 * 优先级：skeletonPart.weaponKey > item.weaponKey > item.toolType
 * @param {Object} item
 * @returns {string|null}
 */
export function weaponKeyOf(item) {
  return item?.skeletonPart?.weaponKey || item?.weaponKey || item?.toolType || null;
}

/**
 * 读取物品对应的部件 ID（面向编辑器绑定）。
 * 优先级：skeletonPart.partId > 从 weaponKey/toolType 推测
 * @param {Object} item
 * @returns {string|null}
 */
export function partIdOfItem(item) {
  return item?.skeletonPart?.partId || null;
}

/**
 * 从 skeletonPart 定义集合解析单个 part。
 * @param {string} partId
 * @param {Map|Object} partRegistry - skeletonPart 注册表（编辑器: Map，运行时: DefinitionRepository）
 * @returns {Object|null} { id, category, assetId, width, height, weaponKey, direction, tags, pivot }
 */
export function resolvePart(partId, partRegistry) {
  if (!partId) return null;
  const part = partRegistry?.get?.(partId) ?? partRegistry?.[partId] ?? null;
  if (!part) return null;
  return {
    id: part.id,
    category: part.category || '',
    assetId: part.assetId || '',
    width: Number(part.width) || 0,
    height: Number(part.height) || 0,
    weaponKey: part.weaponKey || null,
    direction: part.direction || '',
    tags: Array.isArray(part.tags) ? part.tags : [],
    pivot: part.pivot || null
  };
}

/**
 * 从装备定义解析部件绑定配置。
 * @param {Object} item
 * @param {Map|Object} partRegistry
 * @returns {Object|null} { part, bone, slotId, weaponKey, offset:{x,y,rot} }
 */
export function resolveItemPart(item, partRegistry) {
  if (!item?.skeletonPart) return null;
  const sp = item.skeletonPart;
  const part = resolvePart(sp.partId, partRegistry);
  if (!part) return null;
  const offset = sp.offset || {};
  return {
    part,
    bone: sp.bone || '',
    slotId: sp.slotId || '',
    weaponKey: sp.weaponKey || part.weaponKey || '',
    offset: { x: Number(offset.x) || 0, y: Number(offset.y) || 0, rot: Number(offset.rot) || 0 }
  };
}

/**
 * 将内容库 library.json 的 skeletonParts 数组构建为可查询注册表。
 * @param {Array} list - library.json 中的 skeletonParts 数组
 * @returns {Map<string, Object>}
 */
export function buildPartRegistry(list) {
  const registry = new Map();
  for (const part of list || []) {
    if (part?.id) registry.set(part.id, part);
  }
  return registry;
}

/**
 * 读取装备的部件视觉（面向防具槽位换图覆盖：穿脱时把装备部件图写进槽位）。
 * 优先级：skeletonPart.assetId（物品自带图，画布约定 64×64、图片中心=挂点）
 *        > skeletonPart.partId → 部件库 assetId（需传入 partRegistry）。
 * @param {Object} item - 装备物品定义/实例（skeletonPart 绑定块）
 * @param {Map|Object} [partRegistry] - skeletonPart 注册表（可选；partId 路径需要）
 * @returns {{assetId:string, width:number, height:number, directionOffsets:Object|null}|null}
 *          无绑定或解析不到图返回 null（调用方恢复槽位隐藏）
 */
export function resolveItemVisual(item, partRegistry = null) {
  const sp = item?.skeletonPart;
  if (!sp) return null;
  let assetId = typeof sp.assetId === 'string' ? sp.assetId.trim() : '';
  let width = Number(sp.width) || 0;
  let height = Number(sp.height) || 0;
  if (!assetId && sp.partId) {
    const part = resolvePart(sp.partId, partRegistry);
    if (!part?.assetId) return null;
    assetId = part.assetId;
    width = width || part.width;
    height = height || part.height;
  }
  if (!assetId) return null;
  return {
    assetId,
    width,
    height,
    directionOffsets: (sp.directionOffsets && typeof sp.directionOffsets === 'object')
      ? sp.directionOffsets
      : null
  };
}
