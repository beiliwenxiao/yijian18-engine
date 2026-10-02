import { ResourceNodeComponent } from '../../ecs/components/ResourceNodeComponent.js';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value || 'corpse')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function resolveYieldRange(value) {
  const min = Math.max(1, Math.floor(Number(value?.min) || 0));
  const max = Math.max(min, Math.floor(Number(value?.max) || min));
  return { min, max };
}

/**
 * 将死亡敌对实体原地转换为非战斗尸体，并维护可保存的尸体衰减状态。
 * 资源节点继续由 GatheringSystem 结算；实体删除始终委托 ScenePlacementRuntime。
 */
export class SceneCorpseRuntime {
  constructor({ entityStore, aiSystem = null, retirePlacement = null } = {}) {
    if (!entityStore) throw new TypeError('SceneCorpseRuntime requires entityStore');
    this.entityStore = entityStore;
    this.aiSystem = aiSystem;
    this.retirePlacement = typeof retirePlacement === 'function' ? retirePlacement : null;
    this.disposed = false;
  }

  retain(entity, state = null) {
    if (this.disposed || !entity || entity.type === 'player') return false;
    if (entity.isCorpse === true) {
      this._applyState(entity, state);
      return true;
    }
    if (entity.type !== 'enemy') return false;

    const definition = entity.corpseDefinition || {};
    this.aiSystem?.unregisterAI?.(entity);
    this.entityStore.reclassifyAsCorpse?.(entity);

    entity.type = 'corpse';
    entity.isCorpse = true;
    entity.isDead = true;
    entity.isDying = true;
    entity.active = true;
    entity.corpseSource = Object.freeze({
      entityId: entity.id || null,
      placementId: entity.placementId || null,
      definitionId: entity.contentId || entity.definitionId || entity.templateId || null
    });
    entity.tags = [...new Set((entity.tags || []).filter(tag => tag !== 'enemy').concat('corpse'))];

    const movement = entity.getComponent?.('movement');
    if (movement) {
      movement.enabled = false;
      if (movement.velocity) {
        movement.velocity.x = 0;
        movement.velocity.y = 0;
      }
      if (Array.isArray(movement.path)) movement.path.length = 0;
    }
    entity.getComponent?.('combat')?.clearTarget?.();

    const name = entity.getComponent?.('name');
    if (name) {
      name.name = definition.name || `${entity.name || name.name || '怪物'}尸体`;
      name.visible = false;
    }
    entity.name = definition.name || `${entity.name || '怪物'}尸体`;

    if (definition.resourceNode && !entity.getComponent?.('resourceNode')) {
      entity.addComponent?.(new ResourceNodeComponent(clone(definition.resourceNode)));
    }
    this._initializeHarvestYield(entity, definition, state);
    this._applyState(entity, state);
    return true;
  }

  /** 仅在首次死亡转尸体时按稳定 ID 确定一次采集总量，恢复时只应用已保存状态。 */
  _initializeHarvestYield(entity, definition, state) {
    if (state?.resourceNode || !definition?.resourceNode?.harvestYieldRange) return;
    const node = entity.getComponent?.('resourceNode');
    if (!node) return;
    const range = resolveYieldRange(definition.resourceNode.harvestYieldRange);
    const amount = range.min + (stableHash(entity.placementId || entity.id || definition.resourceNode.id) % (range.max - range.min + 1));
    node.remaining = amount;
    node.maxRemaining = amount;
    node.yieldPerGather = amount;
    node.depleted = false;
  }

  /** 在已经完成并耗尽尸体资源节点的操作后启动衰减；同 operationId 可安全重放。 */
  startDecay(entity, { durationSeconds, operationId = null } = {}) {
    if (this.disposed || entity?.isCorpse !== true || !entity?.placementId) {
      return { ok: false, code: 'corpseUnavailable' };
    }
    const node = entity.getComponent?.('resourceNode');
    if (!node?.depleted && Number(node?.remaining) > 0) return { ok: false, code: 'corpseNotDepleted' };
    const seconds = Math.max(0.1, Number(durationSeconds) || 0);
    const current = entity.corpseDecay;
    if (current?.startedByOperationId === operationId) return { ok: true, idempotent: true };
    if (current?.remainingSeconds > 0) return { ok: true, active: true };
    entity.corpseDecay = Object.freeze({
      remainingSeconds: seconds,
      startedByOperationId: operationId || null
    });
    return { ok: true };
  }

  /** 由既有帧管线调用，禁止为尸体创建独立计时器。 */
  update(deltaTime) {
    if (this.disposed || !this.retirePlacement) return 0;
    const elapsed = Math.max(0, Number(deltaTime) || 0);
    let retired = 0;
    for (const entity of [...(this.entityStore?.all || [])]) {
      const decay = entity?.corpseDecay;
      if (entity?.isCorpse !== true || !decay || !(decay.remainingSeconds > 0)) continue;
      const remainingSeconds = Math.max(0, decay.remainingSeconds - elapsed);
      entity.corpseDecay = Object.freeze({ ...decay, remainingSeconds });
      if (remainingSeconds > 0) continue;
      const result = this.retirePlacement(entity, {
        kind: 'corpse',
        removed: true,
        decayExpired: true,
        decayStartedByOperationId: decay.startedByOperationId || null
      });
      if (result?.ok === true) retired += 1;
    }
    return retired;
  }

  _applyState(entity, state = null) {
    if (!state || typeof state !== 'object') return;
    const transform = entity.getComponent?.('transform');
    if (transform && Number.isFinite(state.position?.x) && Number.isFinite(state.position?.y)) {
      transform.position.x = state.position.x;
      transform.position.y = state.position.y;
    }
    if (state.harvested === true) entity.corpseHarvested = true;
    const node = entity.getComponent?.('resourceNode');
    if (node && state.resourceNode) node.deserialize?.(state.resourceNode);
    const decay = state.decay;
    if (decay && Number.isFinite(decay.remainingSeconds) && decay.remainingSeconds > 0) {
      entity.corpseDecay = Object.freeze({
        remainingSeconds: decay.remainingSeconds,
        startedByOperationId: decay.startedByOperationId || null
      });
    }
  }

  capture(entity) {
    if (!entity?.isCorpse) return null;
    const position = entity.getComponent?.('transform')?.position;
    const resourceNode = entity.getComponent?.('resourceNode');
    const decay = entity.corpseDecay;
    return {
      kind: 'corpse',
      removed: false,
      position: position ? { x: Number(position.x) || 0, y: Number(position.y) || 0 } : null,
      ...(entity.corpseHarvested === true ? { harvested: true } : {}),
      ...(resourceNode?.serialize ? { resourceNode: resourceNode.serialize() } : {}),
      ...(decay?.remainingSeconds > 0 ? { decay: clone(decay) } : {})
    };
  }

  dispose() {
    this.disposed = true;
    this.entityStore = null;
    this.aiSystem = null;
    this.retirePlacement = null;
  }
}

export default SceneCorpseRuntime;
