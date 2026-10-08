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
 * 收集一个 canonical chunk 真正依赖的稳定图片 ID。
 * imageAssets 只是编辑器路径映射，不作为“全部加载”清单。
 */
import { mergeOverrides } from './PlacementSpawner.js';

const REGISTRY_KEYS = Object.freeze({
  item: 'items',
  equipment: 'equipment',
  enemy: 'enemies',
  npc: 'npcs',
  building: 'buildings',
  vehicle: 'vehicles',
  resourceNode: 'resourceNodes'
});

function isStableAssetField(key) {
  return key === 'imageId' || key === 'assetId' || key === 'atlasId'
    || key.endsWith('ImageId') || key.endsWith('AssetId') || key.endsWith('AtlasId');
}

function collectStableFields(value, output, visited = new Set()) {
  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) collectStableFields(entry, output, visited);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (isStableAssetField(key) && typeof entry === 'string' && entry.trim()) {
      output.add(entry.trim());
    }
    collectStableFields(entry, output, visited);
  }
}

function getRegistryDefinition(registries, placement) {
  const registry = registries?.[REGISTRY_KEYS[placement?.kind]];
  if (!registry || !placement?.ref) return null;
  return typeof registry.get === 'function'
    ? registry.get(placement.ref) || null
    : registry[placement.ref] || null;
}
function collectPlacement(placement, registries, output) {
  collectStableFields(placement, output);
  const definition = getRegistryDefinition(registries, placement);
  if (definition) collectStableFields(mergeOverrides(definition, placement.overrides), output);
}

export function collectSceneAssetIds({ sceneData = null, registries = {} } = {}) {
  const output = new Set();
  if (!sceneData || typeof sceneData !== 'object') return output;

  for (const layer of sceneData.layers || []) {
    if (!layer || layer.visible === false) continue;
    for (const object of layer.objects || []) {
      collectStableFields(object, output);
      if (object?.type === 'ref' || object?.type === 'spawn') {
        collectPlacement(object, registries, output);
      }
    }
  }
  collectStableFields(sceneData.gameplay, output);
  collectStableFields(sceneData.presentation, output);
  return output;
}

export function collectManifestUsageAssetIds(manifestEntries, usages = []) {
  const output = new Set();
  const accepted = new Set((usages || []).filter(Boolean).map(String));
  if (accepted.size === 0 || !manifestEntries?.values) return output;
  // skeleton 模式：loadAsset 支持 type==='skeleton'（JSON 拉取解析），可安全进预载清单
  const PRELOADABLE_MODES = ['image', 'skeleton'];
  for (const entry of new Set(manifestEntries.values())) {
    if (!PRELOADABLE_MODES.includes(entry?.runtime2D?.mode) || !entry.runtime2D.path) continue;
    if (!(entry.usage || []).some(usage => accepted.has(String(usage)))) continue;
    output.add(entry.imageId || entry.assetId);
  }
  return output;
}
