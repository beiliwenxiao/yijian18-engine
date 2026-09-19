/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * @project YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 ************************************************************/

const REGISTRY_KEYS = Object.freeze({
  item: 'items',
  equipment: 'equipment',
  enemy: 'enemies',
  npc: 'npcs',
  building: 'buildings',
  vehicle: 'vehicles',
  resourceNode: 'resourceNodes'
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]));
}

/** 合并顶层字段，并对其直接子对象再合并一层。 */
function mergeOverrides(base, overrides) {
  const output = cloneValue(base || {});
  for (const [key, value] of Object.entries(overrides || {})) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = { ...output[key], ...cloneValue(value) };
    } else {
      output[key] = cloneValue(value);
    }
  }
  return output;
}

function registryGet(registries, kind, ref) {
  const registry = registries?.[REGISTRY_KEYS[kind]];
  if (!registry) return null;
  if (typeof registry.get === 'function') return registry.get(ref) || null;
  return registry[ref] || null;
}

function toStringList(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values
    .flatMap(entry => String(entry ?? '').split(','))
    .map(entry => entry.trim())
    .filter(Boolean))];
}

function normalizeSelector(selector = {}) {
  return {
    placementIds: toStringList(selector.placementIds ?? selector.placementId),
    group: typeof selector.group === 'string' ? selector.group.trim() : '',
    tags: toStringList(selector.tags ?? selector.tag),
    tagMode: selector.tagMode === 'all' ? 'all' : 'any',
    sceneId: typeof selector.sceneId === 'string' ? selector.sceneId.trim() : '',
    kinds: toStringList(selector.kinds ?? selector.kind)
  };
}

function placementMatches(placement, selector) {
  if (!placement || !selector) return false;
  const hasCriterion = selector.placementIds.length || selector.group || selector.tags.length || selector.sceneId || selector.kinds.length;
  if (!hasCriterion) return false;
  if (selector.placementIds.length && !selector.placementIds.includes(placement.id)) return false;
  if (selector.group && placement.group !== selector.group) return false;
  if (selector.sceneId && placement.sceneId !== selector.sceneId) return false;
  if (selector.kinds.length && !selector.kinds.includes(placement.kind)) return false;
  if (selector.tags.length) {
    const placementTags = toStringList(placement.tags);
    const tagMatched = selector.tagMode === 'all'
      ? selector.tags.every(tag => placementTags.includes(tag))
      : selector.tags.some(tag => placementTags.includes(tag));
    if (!tagMatched) return false;
  }
  return true;
}

/**
 * 把带 count 的模板 placement 展开为第 index 个实例（1 基）。
 * `deriveFirst`（count>1 时为 true）：实例 1 使用派生 id `base-1` 且保持模板坐标，
 * 保证旧档 placementStates/ledger 的 `base-1` 键继续命中；index>=2 按黄金角环形散布
 * （2.5D y 压缩 0.6）。坐标只依赖 index 不依赖 count，保证实例位置跨数量变化与跨会话稳定。
 * count<=1 时不展开（返回模板本身），行为与旧数据完全一致。count 不设上限。
 */
function expandPlacement(placement, index, { deriveFirst = false } = {}) {
  if (!placement) return placement;
  if (index <= 1) return deriveFirst ? { ...placement, id: `${placement.id}-1` } : placement;
  const ringIndex = index - 2;
  const angle = ringIndex * 137.508 * Math.PI / 180;
  const radius = 70 + Math.floor(ringIndex / 10) * 55;
  return {
    ...placement,
    id: `${placement.id}-${index}`,
    x: Math.round(((Number(placement.x) || 0) + Math.cos(angle) * radius) * 100) / 100,
    y: Math.round(((Number(placement.y) || 0) + Math.sin(angle) * radius * 0.6) * 100) / 100
  };
}

/** 解析模板 count：数字直接钳制下限；对象经 getConditionRoot 动态读取；缺省/非法回退 1。 */
function resolveInstanceCount(placement, getConditionRoot) {
  const raw = placement?.count;
  if (raw == null) return 1;
  let value = raw;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const root = getConditionRoot?.(raw.blackboardKey || 'storyState');
    value = root;
    for (const segment of String(raw.path || '').split('.').filter(Boolean)) {
      value = value && typeof value === 'object' ? value[segment] : undefined;
    }
  }
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, parsed);
}

/** 派生实例 id 反查：`base-N` → { base, index }；无数字后缀返回 null。 */
function parseDerivedPlacementId(placementId) {
  const match = /^(.*)-(\d+)$/.exec(String(placementId || ''));
  if (!match || !match[1]) return null;
  return { baseId: match[1], index: Number(match[2]) };
}

/** 将分组放置点与内容注册表定义组合为运行时对象。 */
export class PlacementSpawner {
  constructor({
    entityFactory = null,
    entityStore = null,
    aiSystem = null,
    assetManager = null,
    onEntityImageError = null,
    onNpcImageError = null,
    onSpawn = null,
    shouldSpawn = null,
    getConditionRoot = null
  } = {}) {
    this.entityFactory = entityFactory;
    this.entityStore = entityStore;
    this.aiSystem = aiSystem;
    this.assetManager = assetManager;
    this.onEntityImageError = typeof onEntityImageError === 'function' ? onEntityImageError : null;
    this.onNpcImageError = onNpcImageError;
    this.onSpawn = onSpawn;
    this.shouldSpawn = typeof shouldSpawn === 'function' ? shouldSpawn : null;
    this.getConditionRoot = typeof getConditionRoot === 'function' ? getConditionRoot : null;
    this.spawnedPlacementIds = new Set();
  }

  forgetPlacements(ids = []) {
    let removed = 0;
    for (const id of ids || []) {
      if (id && this.spawnedPlacementIds.delete(id)) removed++;
    }
    return removed;
  }

  rememberPlacements(ids = []) {
    let added = 0;
    for (const id of ids || []) {
      if (!id || this.spawnedPlacementIds.has(id)) continue;
      this.spawnedPlacementIds.add(id);
      added++;
    }
    return added;
  }

  /**
   * 兼容旧触发器：按组名生成放置点。
   * @param {Object} options
   * @returns {Object}
   */
  spawnGroup({ group, placements = [], registries = {} } = {}) {
    return this.spawnMatching({ placements, registries, selector: { group } });
  }

  /**
   * 按放置点 ID、组名、标签、场景或类型筛选并生成。
   * 各筛选条件同时存在时取交集；未给任何条件时不生成任何对象。
   * @param {Object} options
   * @param {Array<Object>} options.placements
   * @param {Object} options.registries
   * @param {Object} options.selector
   * @returns {{selector:Object, matchedPlacements:Array<Object>, counts:Object, entities:Array, errors:Array, outcomes:Array<Object>, skipped:Array<Object>}}
   */
  spawnMatching({ placements = [], registries = {}, selector = {} } = {}) {
    const normalized = normalizeSelector(selector);
    const counts = { item: 0, equipment: 0, enemy: 0, npc: 0, building: 0, vehicle: 0, resourceNode: 0, total: 0 };
    const entities = [];
    const errors = [];
    const outcomes = [];
    const matchedPlacements = (placements || []).filter(placement => placementMatches(placement, normalized));
    const recordOutcome = (placement, status, reason = null) => {
      const outcome = {
        placementId: placement?.id || null,
        kind: placement?.kind || null,
        ref: placement?.ref || null,
        status
      };
      if (reason) outcome.reason = reason;
      outcomes.push(outcome);
      return outcome;
    };
    const recordError = (placement, reason, error = null) => {
      const entry = {
        kind: placement?.kind || null,
        ref: placement?.ref || null,
        placement,
        reason
      };
      if (error) entry.error = error;
      errors.push(entry);
      return entry;
    };

    for (const placement of matchedPlacements) {
      const kind = placement.kind;
      if (placement.type && placement.type !== 'ref') {
        recordOutcome(placement, 'nonRef');
        continue;
      }
      if (!REGISTRY_KEYS[kind]) {
        recordError(placement, 'unsupportedKind');
        recordOutcome(placement, 'unsupportedKind', 'unsupportedKind');
        continue;
      }
      // count 展开：一个模板按数量派生 `id-N` 实例；幂等键/状态/tombstone 都绑定派生 id。
      // count 缺省或为 1 时不展开，实例即模板本身，行为与旧数据完全一致。
      const instanceCount = resolveInstanceCount(placement, this.getConditionRoot);
      const definition = registryGet(registries, kind, placement.ref);
      if (!definition) {
        recordError(placement, 'definitionNotFound');
        recordOutcome(placement, 'failed', 'definitionNotFound');
        continue;
      }
      for (let index = 1; index <= instanceCount; index += 1) {
        const instance = expandPlacement(placement, index, { deriveFirst: instanceCount > 1 });
        if (instance.id && this.spawnedPlacementIds.has(instance.id)) {
          recordOutcome(instance, 'alreadySpawned');
          continue;
        }
        if (this.shouldSpawn) {
          try {
            if (this.shouldSpawn({ placement: instance, selector: normalized }) === false) {
              recordOutcome(instance, 'conditionFalse');
              continue;
            }
          } catch (error) {
            recordError(instance, 'spawnConditionFailed', error);
            recordOutcome(instance, 'failed', 'spawnConditionFailed');
            continue;
          }
        }

        try {
          const data = mergeOverrides(definition, instance.overrides);
          if (kind === 'enemy' && data.corpse?.resourceNodeRef) {
            const resourceNode = registryGet(registries, 'resourceNode', data.corpse.resourceNodeRef);
            if (!resourceNode) {
              recordError(instance, 'corpseResourceNodeNotFound');
              recordOutcome(instance, 'failed', 'corpseResourceNodeNotFound');
              continue;
            }
            data.corpse = {
              ...data.corpse,
              resourceNode: mergeOverrides(resourceNode, data.corpse.resourceNode)
            };
          }
          data.position = { x: Number(instance.x) || 0, y: Number(instance.y) || 0 };
          const entity = this._spawn(kind, data, instance);
          if (!entity) {
            recordError(instance, 'factoryUnavailable');
            recordOutcome(instance, 'failed', 'factoryUnavailable');
            continue;
          }
          if (!entity.placementId && instance.id) entity.placementId = instance.id;
          // 地面可拾取物与装备同样可以声明稳定 imageId，需要一起预载图片。
          if (['npc', 'enemy', 'resourceNode', 'item', 'equipment'].includes(kind)) {
            this._preloadEntityImage(kind, data, entity, instance);
          }
          if (typeof this.onSpawn === 'function') {
            try {
              this.onSpawn({ entity, kind, group: instance.group || normalized.group || null, placement: instance, definition: data });
            } catch (error) {
              this.aiSystem?.unregisterAI?.(entity);
              this.entityStore?.remove?.(entity);
              try { entity?.destroy?.(); } catch (destroyError) { /* best-effort rollback */ }
              recordError(instance, 'onSpawnFailed', error);
              recordOutcome(instance, 'failed', 'onSpawnFailed');
              continue;
            }
          }
          entities.push(entity);
          if (instance.id) this.spawnedPlacementIds.add(instance.id);
          counts[kind]++;
          counts.total++;
          recordOutcome(instance, 'spawned');
        } catch (error) {
          recordError(instance, 'spawnFailed', error);
          recordOutcome(instance, 'failed', 'spawnFailed');
        }
      }
    }

    const skipped = outcomes.filter(outcome => (
      outcome.status === 'alreadySpawned'
      || outcome.status === 'conditionFalse'
      || outcome.status === 'nonRef'
    ));
    return { selector: normalized, matchedPlacements, counts, entities, errors, outcomes, skipped };
  }

  _spawn(kind, data, placement) {
    const factory = this.entityFactory;
    const store = this.entityStore;
    if (kind === 'item') {
      if (data.worldProp) {
        const entity = factory?.createProp?.(data);
        if (entity) {
          entity.placementId = placement.id || entity.placementId || null;
          store?.add?.(entity);
        }
        return entity;
      }
      const item = { ...data, placementId: placement.id, x: data.position.x, y: data.position.y, picked: false };
      store?.addPickup?.(item);
      return item;
    }
    if (kind === 'equipment') {
      const equipment = { ...data, placementId: placement.id, x: data.position.x, y: data.position.y, picked: false };
      store?.addEquipmentItem?.(equipment);
      return equipment;
    }
    if (kind === 'enemy') {
      const entity = factory?.createEnemy?.({
        ...data,
        id: placement.id || data.id,
        contentId: data.id,
        templateId: data.templateId || placement.ref
      });
      if (!entity) return null;
      if (typeof store?.addEnemy === 'function') store.addEnemy(entity);
      else store?.add?.(entity);
      const aiType = data.aiType || 'aggressive';
      if (data.aiActive === false) this.aiSystem?.deactivateAI?.(entity, aiType);
      else this.aiSystem?.registerAI?.(entity, aiType);
      return entity;
    }
    if (kind === 'resourceNode') {
      const entity = factory?.createResourceNode?.({ ...data, id: placement.id });
      if (entity) store?.add?.(entity);
      return entity;
    }
    const methods = { npc: 'createNPC', building: 'createBuilding', vehicle: 'createVehicle' };
    const entityData = {
      ...data,
      id: placement.id || data.id,
      contentId: data.id,
      ...(kind === 'npc' ? { npcId: data.npcId || data.id } : {})
    };
    const entity = factory?.[methods[kind]]?.(entityData);
    if (entity) store?.add?.(entity);
    return entity;
  }

  _preloadEntityImage(kind, data, entity, placement) {
    const sprite = data.sprite || {};
    const stableId = data.imageId || data.assetId || sprite.imageId || sprite.assetId || null;
    const legacyKey = sprite.sheet || sprite.src || data.spriteSheet || null;
    const resolved = stableId
      ? this.assetManager?.resolveManifestAsset?.(stableId, '2d')
      : null;
    const key = resolved?.key || stableId || legacyKey;
    const source = resolved?.url || sprite.url || sprite.src || sprite.sheet || data.spriteSheet;
    if (!key || !source || typeof this.assetManager?.loadImage !== 'function') return;

    const present = typeof this.assetManager.hasImage === 'function'
      ? this.assetManager.hasImage(key)
      : this.assetManager.getAsset?.(key);
    if (present) return;
    const url = resolved?.url || (typeof this.assetManager.resolveAssetPath === 'function'
      ? this.assetManager.resolveAssetPath(source)
      : source);
    Promise.resolve(this.assetManager.loadImage(key, url)).catch(error => {
      const detail = { error, kind, key, url, entity, placement, definition: data };
      if (this.onEntityImageError) this.onEntityImageError(detail);
      if (kind === 'npc' && typeof this.onNpcImageError === 'function') {
        this.onNpcImageError(detail);
      }
    });
  }

  // 保留旧私有入口，供尚未迁移的扩展调用。
  _preloadNpcImage(data, entity, placement) {
    return this._preloadEntityImage('npc', data, entity, placement);
  }
}

export { mergeOverrides, expandPlacement, parseDerivedPlacementId, resolveInstanceCount };
export default PlacementSpawner;