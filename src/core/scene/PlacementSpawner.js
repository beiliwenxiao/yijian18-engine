/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * @project YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 ************************************************************/

import { SquadMemberComponent } from '../../ecs/components/SquadMemberComponent.js';
import { CommandStateComponent } from '../../ecs/components/CommandStateComponent.js';

const REGISTRY_KEYS = Object.freeze({
  item: 'items',
  equipment: 'equipment',
  enemy: 'enemies',
  soldier: 'enemies',
  army: 'armies',
  npc: 'npcs',
  building: 'buildings',
  vehicle: 'vehicles',
  resourceNode: 'resourceNodes'
});

/**
 * 单条 placement 的实例数上限。
 * 依据：引擎同屏实体预算 2000；一个刷怪点最多占 10%（200）——既覆盖大波次需求
 * （常见 5~50），又避免单个点挤占整屏预算导致帧率塌陷。超出按上限钳制。
 */
export const MAX_PLACEMENT_INSTANCE_COUNT = 200;

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

/** 散布参数：黄金角环形（2.5D 椭圆，y 压缩 0.6）。与编辑器画布散布圈（半径 70）同源。 */
const GOLDEN_ANGLE_RAD = 137.508 * Math.PI / 180;
const SPREAD_BASE_RADIUS = 70;
const SPREAD_RADIUS_STEP = 55;
const SPREAD_RING_SIZE = 10;
const SPREAD_CANDIDATE_RADIUS_STEP = 28;
const SPREAD_CANDIDATE_SLOTS = 8;
const SPREAD_MAX_ATTEMPTS = 16;
/** 同组实例最小中心间距（px）：约两个角色身位，避免叠在一起。 */
export const DEFAULT_INSTANCE_SPACING = 40;

/** 点是否落在阻挡碰撞多边形内（世界坐标，points 支持 [x,y] / {x,y}）。 */
export function isPointBlockedByShapes(x, y, shapes = []) {
  for (const shape of shapes || []) {
    const points = Array.isArray(shape?.points) ? shape.points : null;
    if (!points || points.length < 3) continue;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const xi = Number(points[i]?.[0] ?? points[i]?.x);
      const yi = Number(points[i]?.[1] ?? points[i]?.y);
      const xj = Number(points[j]?.[0] ?? points[j]?.x);
      const yj = Number(points[j]?.[1] ?? points[j]?.y);
      if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
      const intersects = ((yi > y) !== (yj > y))
        && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
      if (intersects) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

/** 第 index 个实例的第 attempt 个候选坐标：attempt=0 即旧版黄金角环形位置。 */
function spreadCandidate(placement, index, attempt = 0) {
  const ringIndex = index - 2;
  const baseRadius = SPREAD_BASE_RADIUS + Math.floor(ringIndex / SPREAD_RING_SIZE) * SPREAD_RADIUS_STEP;
  const baseAngle = ringIndex * GOLDEN_ANGLE_RAD;
  const ring = attempt === 0 ? 0 : Math.ceil(attempt / SPREAD_CANDIDATE_SLOTS);
  const slot = attempt === 0 ? 0 : attempt % SPREAD_CANDIDATE_SLOTS;
  const radius = baseRadius + ring * SPREAD_CANDIDATE_RADIUS_STEP;
  const angle = baseAngle + slot * (Math.PI * 2 / SPREAD_CANDIDATE_SLOTS);
  return {
    x: Math.round(((Number(placement.x) || 0) + Math.cos(angle) * radius) * 100) / 100,
    y: Math.round(((Number(placement.y) || 0) + Math.sin(angle) * radius * 0.6) * 100) / 100
  };
}

/**
 * 计算派生实例坐标：环形散布 + 避碰撞 + 最小间距。
 * - occupied：同模板先前实例坐标（数组），用于间距校验；
 * - isBlocked(x,y)：阻挡探测（运行时注入地形碰撞多边形判定）；
 * - 坐标只依赖 index 与 occupied，同一份场景数据下跨会话稳定（读档/重建一致）；
 * - 候选全部失败时回退旧版环形位置，绝不丢刷怪位。
 */
export function resolveDerivedPosition(placement, index, {
  occupied = [],
  isBlocked = null,
  minSpacing = DEFAULT_INSTANCE_SPACING
} = {}) {
  const spacing = Number(minSpacing) > 0 ? Number(minSpacing) : 0;
  for (let attempt = 0; attempt < SPREAD_MAX_ATTEMPTS; attempt += 1) {
    const candidate = spreadCandidate(placement, index, attempt);
    const blocked = typeof isBlocked === 'function' && isBlocked(candidate.x, candidate.y) === true;
    if (blocked) continue;
    const tooClose = spacing > 0 && (occupied || []).some(entry => (
      Math.hypot(Number(entry?.x) - candidate.x, Number(entry?.y) - candidate.y) < spacing
    ));
    if (tooClose) continue;
    return candidate;
  }
  return spreadCandidate(placement, index, 0);
}

/**
 * 把带 count 的模板 placement 展开为第 index 个实例（1 基）。
 * `deriveFirst`（count>1 时为 true）：实例 1 使用派生 id `base-1` 且保持模板坐标，
 * 保证旧档 placementStates/ledger 的 `base-1` 键继续命中；index>=2 按黄金角环形散布
 * （2.5D y 压缩 0.6），并可按注入的阻挡探测/最小间距避障（见 resolveDerivedPosition）。
 * count<=1 时不展开（返回模板本身），行为与旧数据完全一致。
 */
function expandPlacement(placement, index, {
  deriveFirst = false,
  occupied = [],
  isBlocked = null,
  minSpacing = DEFAULT_INSTANCE_SPACING
} = {}) {
  if (!placement) return placement;
  if (index <= 1) return deriveFirst ? { ...placement, id: `${placement.id}-1` } : placement;
  const position = resolveDerivedPosition(placement, index, { occupied, isBlocked, minSpacing });
  return {
    ...placement,
    id: `${placement.id}-${index}`,
    x: position.x,
    y: position.y
  };
}

/** 解析模板 count：数字直接钳制到 [1, MAX_PLACEMENT_INSTANCE_COUNT]；对象经 getConditionRoot 动态读取；缺省/非法回退 1。 */
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
  return Math.min(MAX_PLACEMENT_INSTANCE_COUNT, Math.max(1, parsed));
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
    getConditionRoot = null,
    isSpawnPointBlocked = null,
    minInstanceSpacing = DEFAULT_INSTANCE_SPACING
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
    this.isSpawnPointBlocked = typeof isSpawnPointBlocked === 'function' ? isSpawnPointBlocked : null;
    this.minInstanceSpacing = Number(minInstanceSpacing) > 0 ? Number(minInstanceSpacing) : DEFAULT_INSTANCE_SPACING;
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
    const counts = { item: 0, equipment: 0, enemy: 0, soldier: 0, npc: 0, building: 0, vehicle: 0, resourceNode: 0, total: 0 };
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
      // army 编制展开：placement 引用 army 定义 → 按 squads×units 展开为 soldier 虚拟
      // placement 逐个生成（数量构成单一来源归 armies 定义，placement 不携带数量）。
      if (kind === 'army') {
        const soldierPlacements = this._expandArmyPlacement(placement, registries, recordError, recordOutcome);
        for (const soldierPlacement of soldierPlacements) {
          this._spawnPlacementInstance(soldierPlacement, 'soldier', registries, normalized, counts, entities, recordError, recordOutcome);
        }
        continue;
      }
      this._spawnPlacementInstance(placement, kind, registries, normalized, counts, entities, recordError, recordOutcome);
    }

    const skipped = outcomes.filter(outcome => (
      outcome.status === 'alreadySpawned'
      || outcome.status === 'conditionFalse'
      || outcome.status === 'nonRef'
    ));
    return { selector: normalized, matchedPlacements, counts, entities, errors, outcomes, skipped };
  }

  /**
   * army 编制展开：读 army 注册表定义，按 squads×units 展开为 soldier 虚拟 placement 数组。
   * - 虚拟 id `{placementId}-{squadId}-{n}` 稳定派生，spawnedPlacementIds 借此幂等去重；
   * - 坐标全员以出兵点为心环形散布（首兵原位，黄金角 + 半径 70 起步），避免多兵重叠；
   * - spawnWhen/faction/group/tags 从 army placement 继承到每个虚拟实例；
   * - placement 上携带的 count 无效（编制数量单一来源归 armies 定义）。
   * @private
   */
  _expandArmyPlacement(placement, registries, recordError, recordOutcome) {
    const army = registryGet(registries, 'army', placement.ref);
    if (!army) {
      recordError(placement, 'definitionNotFound');
      recordOutcome(placement, 'failed', 'definitionNotFound');
      return [];
    }
    const baseX = Number(placement.x) || 0;
    const baseY = Number(placement.y) || 0;
    const armyId = placement.armyId || army.id || 'army.default';
    const virtual = [];
    let globalIndex = 0;
    for (const squad of Array.isArray(army.squads) ? army.squads : []) {
      if (!squad?.id) continue;
      let formationIndex = 0;
      for (const unit of Array.isArray(squad.units) ? squad.units : []) {
        const count = Math.max(0, Math.floor(Number(unit?.count) || 0));
        for (let i = 0; i < count; i += 1) {
          const ringIndex = globalIndex; // 0 = 出兵点原位，其余环形散布
          const angle = ringIndex * 137.508 * Math.PI / 180;
          const radius = ringIndex === 0 ? 0 : 70 + Math.floor((ringIndex - 1) / 10) * 55;
          formationIndex += 1;
          globalIndex += 1;
          virtual.push({
            ...placement,
            kind: 'soldier',
            ref: unit.ref,
            id: `${placement.id}-${squad.id}-${formationIndex}`,
            armyId,
            squadId: squad.id,
            formationIndex: formationIndex - 1,
            overrides: unit.overrides,
            count: undefined,
            x: Math.round((baseX + Math.cos(angle) * radius) * 100) / 100,
            y: Math.round((baseY + Math.sin(angle) * radius * 0.6) * 100) / 100
          });
        }
      }
    }
    return virtual;
  }

  /**
   * army placement 展开的公开包装（重建范围/校验用）：返回按 squads×units 派生的
   * soldier 虚拟 placement 数组（id `{placementId}-{squadId}-{n}`）。定义缺失或空编制
   * 返回 []，由调用方回退校验原 placement（失败结果记录在原 id 上）。
   */
  expandArmyPlacement(placement, registries) {
    return this._expandArmyPlacement(placement, registries, () => {}, () => {});
  }

  /**
   * 生成单条 placement 实例（count 展开 + 定义合并 + 工厂生成 + 预载 + onSpawn 回调）。
   * army 展开的 soldier 虚拟 placement 也走此路径（count 已被清除，不二次展开）。
   * @private
   */
  _spawnPlacementInstance(placement, kind, registries, normalized, counts, entities, recordError, recordOutcome) {
    // count 展开：声明了 count 的模板（含 count=1）一律派生 `id-N` 实例 id——
    // 调用方（如首狼流程）以 `base-1` 寻址，count=1 时不派生会导致实体 id 与寻址不一致。
    // 未声明 count 的旧数据不展开，行为与旧版完全一致。
    const hasCount = placement.count != null;
    const instanceCount = resolveInstanceCount(placement, this.getConditionRoot);
    const definition = registryGet(registries, kind, placement.ref);
    if (!definition) {
      recordError(placement, 'definitionNotFound');
      recordOutcome(placement, 'failed', 'definitionNotFound');
      return;
    }
    // 同模板已占位坐标：逐个实例累计，用于最小间距校验（坐标只依赖 index 与占位，
    // 与 ScenePlacementRuntime 的派生寻址/重算保持同构）。
    const occupiedPositions = [];
    for (let index = 1; index <= instanceCount; index += 1) {
      const instance = hasCount
        ? expandPlacement(placement, index, {
          deriveFirst: true,
          occupied: occupiedPositions,
          isBlocked: this.isSpawnPointBlocked,
          minSpacing: this.minInstanceSpacing
        })
        : placement;
      occupiedPositions.push({ x: Number(instance.x) || 0, y: Number(instance.y) || 0 });
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
        // 阴影配置（库定义/场景 overrides 的 shadow 块，mergeOverrides 已合成）：
        // { ground: true, long: true }——ground=false 无任何阴影，long=false 无点光长影
        if (data.shadow && typeof data.shadow === 'object') {
          entity.shadowProfile = { ...data.shadow };
        }
        // 发光配置（库定义/场景 overrides 的 glow 块，mergeOverrides 已合成）：
        // { color, radius, intensity, flicker, yOffset }——radius>0 才发光；
        // SceneRenderPipeline 据此注入阴影点光源并绘制光晕（LightGlowRenderer）
        if (data.glow && typeof data.glow === 'object') {
          entity.glowProfile = { ...data.glow };
        }
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
    if (kind === 'soldier') {
      // 军团士兵（友军 ally：狼群 AI 会将其视为敌对目标，可被攻击/还击）：
      // 复用敌人实体管线但注入 SquadMember/CommandState 组件、不注册敌对 AI——
      // 行为由 ArmyCommandSystem 姿态机驱动；编组注册由 SceneArmyCommandFlow 扫描完成。
      const entity = factory?.createEnemy?.({
        ...data,
        id: placement.id || data.id,
        contentId: data.id,
        templateId: data.templateId || placement.ref,
        faction: placement.faction || data.faction || 'ally'
      });
      if (!entity) return null;
      entity.faction = placement.faction || data.faction || 'ally';
      entity.addComponent?.(new SquadMemberComponent({
        armyId: placement.armyId || data.armyId || 'army.default',
        squadId: placement.squadId || data.squadId || 'zhong',
        formationIndex: placement.formationIndex ?? data.formationIndex
      }));
      // 初始姿态用组件默认 hold：escort（跟随武将）是 ArmyCommandSystem 选择槽语义，
      // 不是 CommandStateComponent 的 6 姿态枚举值，传 'escort' 会被静默回退。
      entity.addComponent?.(new CommandStateComponent());
      if (typeof store?.addEnemy === 'function') store.addEnemy(entity);
      else store?.add?.(entity);
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