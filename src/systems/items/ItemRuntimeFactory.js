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

import { Entity } from '../../ecs/Entity.js';
import { TransformComponent } from '../../ecs/components/TransformComponent.js';
import { SpriteComponent } from '../../ecs/components/SpriteComponent.js';
import { NameComponent } from '../../ecs/components/NameComponent.js';
import { ItemProjectionComponent } from '../../ecs/components/ItemProjectionComponent.js';
import { DeathDropComponent } from '../../ecs/components/DeathDropComponent.js';
import { createStandardCapabilityStrategyRegistry } from './CapabilityStrategyRegistry.js';
import {
  normalizeItemRuntimeState,
  validateItemRuntimeState,
  validateItemRuntimeStates
} from './ItemRuntimeState.js';

const stablePresentationId = value => {
  const imageId = typeof value?.imageId === 'string' ? value.imageId : null;
  const assetId = typeof value?.assetId === 'string' ? value.assetId : null;
  if (imageId && assetId && imageId !== assetId) throw new Error('assetId/imageId must be identical');
  return imageId || assetId || null;
};

/** Definition + minimal runtime state 到 ECS/表现的唯一正式物品 Factory。 */
export class ItemRuntimeFactory {
  constructor({ definitionRepository = null, getDefinitionRepository = null,
    capabilityStrategyRegistry = null } = {}) {
    this.definitionRepository = definitionRepository;
    this.getDefinitionRepository = typeof getDefinitionRepository === 'function'
      ? getDefinitionRepository : () => this.definitionRepository;
    this.capabilityStrategyRegistry = capabilityStrategyRegistry || createStandardCapabilityStrategyRegistry();
  }

  _repository() {
    const repository = this.getDefinitionRepository();
    if (!repository?.get) throw new Error('ItemRuntimeFactory requires DefinitionRepository');
    return repository;
  }

  resolveDefinition(definitionId) {
    const repository = this._repository();
    return repository.get('items', definitionId) || repository.get('equipment', definitionId) || null;
  }

  _hasDefinition = definitionId => Boolean(this.resolveDefinition(definitionId));

  validateRuntimeState(state, path = 'itemRuntimeState') {
    return validateItemRuntimeState(state, { hasDefinition: this._hasDefinition, path });
  }

  validateRuntimeStates(states, path = 'itemRuntimeStates') {
    return validateItemRuntimeStates(states, { hasDefinition: this._hasDefinition, path });
  }

  projectPresentation(definition, override = {}) {
    const overrideId = stablePresentationId(override);
    const definitionId = stablePresentationId(definition);
    const assetId = overrideId || definitionId;
    return Object.freeze({
      assetId,
      imageId: assetId,
      width: Number(override.width ?? definition?.sprite?.width ?? definition?.width) || 32,
      height: Number(override.height ?? definition?.sprite?.height ?? definition?.height) || 32,
      scale: Number(override.scale ?? definition?.sprite?.scale) || 1
    });
  }

  createGroundDropProjection({ entityId, runtimeState, transform = {}, pickupState = 'available', presentation = {} } = {}) {
    const checked = this.validateRuntimeState(runtimeState, 'groundDrop.runtimeState');
    if (!checked.ok) throw this._validationError(checked.errors);
    const definition = this.resolveDefinition(checked.state.definitionId);
    const projected = this.projectPresentation(definition, presentation);
    const entity = new Entity(entityId || `ground-drop-${checked.state.instanceId || checked.state.definitionId}`, 'loot');
    entity.addComponent(new TransformComponent(Number(transform.x) || 0, Number(transform.y) || 0));
    entity.addComponent(new ItemProjectionComponent({
      projectionKind: 'groundDrop', runtimeState: checked.state, pickupState,
      capabilityState: this.capabilityStrategyRegistry.project(definition, checked.state)
    }));
    this._addPresentation(entity, definition?.name || checked.state.definitionId, projected, presentation);
    entity.tags = ['loot', 'groundDrop'];
    return entity;
  }

  validateDeathDropProjection({ entityId, deathId, stacks, transform } = {}, path = 'deathDrop') {
    const errors = [];
    if (typeof entityId !== 'string' || !entityId) errors.push({ code: 'missingField', path: `${path}.entityId`, message: '缺少 entityId' });
    if (typeof deathId !== 'string' || !deathId) errors.push({ code: 'missingField', path: `${path}.deathId`, message: '缺少 deathId' });
    if (!Number.isFinite(transform?.x) || !Number.isFinite(transform?.y)) {
      errors.push({ code: 'typeMismatch', path: `${path}.transform`, message: 'transform 必须包含有限数值 x/y' });
    }
    const states = (stacks || []).map(stack => stack?.runtimeState || stack);
    const checked = this.validateRuntimeStates(states, `${path}.stacks`);
    errors.push(...checked.errors);
    return { ok: errors.length === 0, states: checked.states, errors };
  }

  createDeathDropProjection({ entityId, id, deathId, stacks = [], transform = null,
    position = null, presentation = {}, ...legacyPresentation } = {}) {
    const actualEntityId = entityId || id;
    const actualTransform = transform || position || {};
    const actualPresentation = { ...legacyPresentation, ...presentation };
    const checked = this.validateDeathDropProjection({
      entityId: actualEntityId, deathId, stacks, transform: actualTransform
    });
    if (!checked.ok) throw this._validationError(checked.errors);
    const entity = new Entity(actualEntityId, 'loot');
    entity.addComponent(new TransformComponent(actualTransform.x, actualTransform.y));
    entity.addComponent(new DeathDropComponent({
      deathId,
      stacks: stacks.map((stack, index) => ({
        id: stack?.id || `${checked.states[index].definitionId}-${index}`,
        runtimeState: checked.states[index]
      })),
      definitionResolver: definitionId => this.resolveDefinition(definitionId)
    }));
    const assetId = stablePresentationId(actualPresentation);
    const projected = Object.freeze({
      assetId,
      imageId: assetId,
      width: Number(actualPresentation.width ?? actualPresentation.sprite?.width) || 40,
      height: Number(actualPresentation.height ?? actualPresentation.sprite?.height) || 36,
      scale: Number(actualPresentation.scale ?? actualPresentation.sprite?.scale) || 1
    });
    this._addPresentation(entity, actualPresentation.name || '遗失物资', projected, actualPresentation);
    entity.itemData = { id: 'death-drop', type: 'death_drop', name: actualPresentation.name || '遗失物资', imageId: assetId, assetId };
    entity.imageId = assetId;
    entity.assetId = assetId;
    entity.name = actualPresentation.name || '遗失物资';
    entity.x = actualTransform.x;
    entity.y = actualTransform.y;
    entity.tags = ['loot', 'deathDrop'];
    return entity;
  }

  _addPresentation(entity, name, projected, config) {
    const sprite = new SpriteComponent(projected.assetId || '', {
      width: projected.width,
      height: projected.height,
      visible: config.sprite?.visible !== false && config.visible !== false,
      defaultAnimation: 'idle',
      isStatic: Boolean(projected.assetId)
    });
    sprite.scale = projected.scale;
    sprite.addAnimation('idle', { frames: [0], frameRate: 1, loop: true });
    entity.addComponent(sprite);
    entity.addComponent(new NameComponent(name, {
      color: config.nameStyle?.color || '#ffd36a',
      fontSize: config.nameStyle?.fontSize || 14,
      offsetY: config.nameStyle?.offsetY ?? -22,
      visible: config.nameStyle?.visible !== false
    }));
  }

  _validationError(errors) {
    const error = new Error(errors.map(entry => `${entry.path}: ${entry.message}`).join('\n'));
    error.name = 'ItemRuntimeValidationError';
    error.errors = errors;
    return error;
  }
}

export { normalizeItemRuntimeState };
export default ItemRuntimeFactory;
