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
 * CanonicalSchemas.js
 * 跨内容、存档和集成边界共享的规范业务模型。
 */

import { FieldType } from '../../core/validation/ContentValidator.js';
import { ValidationCode, makeError } from '../../core/validation/ValidationError.js';
import {
  DEFAULT_WORLD_MAP_REGION_TYPE,
  WORLD_MAP_REGION_TYPES
} from '../../core/WorldMapCell.js';

export const CANONICAL_SCHEMA_VERSION = 2;

const idField = () => ({ type: FieldType.STRING, required: true, minLength: 1 });
const versionField = () => ({
  type: FieldType.INTEGER,
  required: true,
  min: 1,
  max: CANONICAL_SCHEMA_VERSION
});
const nonNegativeInteger = (required = false) => ({
  type: FieldType.INTEGER,
  required,
  min: 0
});
const ratioField = (required = false) => ({
  type: FieldType.NUMBER,
  required,
  min: 0,
  max: 1
});

function validateNonNegativeIntegerMap(value, path) {
  const errors = [];
  for (const [key, amount] of Object.entries(value || {})) {
    if (Number.isInteger(amount) && amount >= 0) continue;
    errors.push(makeError(
      ValidationCode.OUT_OF_RANGE,
      `${path}.${key}`,
      '数量必须为非负整数',
      { expected: 'integer >= 0', actual: amount }
    ));
  }
  return errors;
}

export const POSITION_SCHEMA = {
  id: 'position',
  allowUnknown: false,
  fields: {
    x: { type: FieldType.NUMBER, required: true },
    y: { type: FieldType.NUMBER, required: true },
    elevation: { type: FieldType.NUMBER }
  }
};


export const UNIT_SCHEMA = {
  id: 'unit',
  fields: {
    schemaVersion: versionField(),
    id: idField(),
    name: { type: FieldType.STRING, required: true, minLength: 1 },
    unitType: { type: FieldType.STRING, required: true, minLength: 1 },
    factionId: idField(),
    level: { type: FieldType.INTEGER, min: 1 },
    stats: { type: FieldType.OBJECT, valueType: FieldType.NUMBER },
    equipmentIds: { type: FieldType.ARRAY, itemType: FieldType.STRING },
    skillIds: { type: FieldType.ARRAY, itemType: FieldType.STRING },
    tags: { type: FieldType.ARRAY, itemType: FieldType.STRING }
  }
};

export const HERO_SCHEMA = {
  id: 'hero',
  fields: {
    schemaVersion: versionField(),
    id: idField(),
    name: { type: FieldType.STRING, required: true, minLength: 1 },
    unitId: idField(),
    classId: idField(),
    factionId: idField(),
    level: { type: FieldType.INTEGER, min: 1 },
    stats: { type: FieldType.OBJECT, valueType: FieldType.NUMBER },
    skillIds: { type: FieldType.ARRAY, itemType: FieldType.STRING },
    tags: { type: FieldType.ARRAY, itemType: FieldType.STRING }
  }
};

export const FORMATION_SCHEMA = {
  id: 'formation',
  fields: {
    schemaVersion: versionField(),
    id: idField(),
    name: { type: FieldType.STRING, required: true, minLength: 1 },
    unitIds: { type: FieldType.ARRAY, required: true, minItems: 1, itemType: FieldType.STRING },
    leaderHeroId: { type: FieldType.STRING, minLength: 1 },
    rows: { type: FieldType.INTEGER, min: 1 },
    columns: { type: FieldType.INTEGER, min: 1 },
    strategy: { type: FieldType.STRING }
  }
};

export const ARMY_SCHEMA = {
  id: 'army',
  fields: {
    schemaVersion: versionField(),
    id: idField(),
    name: { type: FieldType.STRING, required: true, minLength: 1 },
    factionId: idField(),
    formationIds: { type: FieldType.ARRAY, required: true, minItems: 1, itemType: FieldType.STRING },
    commanderHeroId: { type: FieldType.STRING, minLength: 1 },
    morale: nonNegativeInteger(true),
    resources: { type: FieldType.OBJECT, valueType: FieldType.INTEGER }
  },
  validate(army) {
    const errors = validateNonNegativeIntegerMap(army.resources, 'resources');
    return { ok: errors.length === 0, errors };
  }
};


export const RESOURCE_NODE_SCHEMA = {
  id: 'resourceNode',
  fields: {
    schemaVersion: versionField(),
    id: idField(),
    resourceType: {
      type: FieldType.STRING,
      required: true,
      enum: ['wood', 'iron', 'food', 'herb', 'stone']
    },
    remaining: nonNegativeInteger(true),
    refreshDays: nonNegativeInteger(true),
    refreshProgressDays: nonNegativeInteger(),
    refreshMode: { type: FieldType.STRING, enum: ['none', 'timed'] },
    refreshIntervalSeconds: { type: FieldType.NUMBER, min: 0 },
    refreshElapsedSeconds: { type: FieldType.NUMBER, min: 0 },
    guardUnitIds: { type: FieldType.ARRAY, required: true, itemType: FieldType.STRING },
    damageRatio: ratioField(true),
    sceneId: { type: FieldType.STRING, minLength: 1 },
    position: { type: FieldType.OBJECT, schema: 'position' }
  }
};

export const RESOURCE_NODE_RISK_EVENT_SCHEMA = {
  id: 'resourceNodeRiskEvent',
  allowUnknown: false,
  fields: {
    id: idField(),
    type: { type: FieldType.STRING, required: true, minLength: 1 },
    chance: ratioField(true),
    message: { type: FieldType.STRING },
    payload: { type: FieldType.OBJECT }
  }
};

export const RESOURCE_NODE_HARVEST_YIELD_RANGE_SCHEMA = {
  id: 'resourceNodeHarvestYieldRange',
  allowUnknown: false,
  fields: {
    min: { type: FieldType.INTEGER, required: true, min: 1 },
    max: { type: FieldType.INTEGER, required: true, min: 1 }
  },
  validate(range) {
    return range.min <= range.max
      ? { ok: true, errors: [] }
      : { ok: false, errors: [makeError(ValidationCode.OUT_OF_RANGE, 'min', 'harvestYieldRange.min 不能大于 max')] };
  }
};

/** 内容库中的资源节点定义；与存档里的动态 resourceNode 状态分离。 */
export const RESOURCE_NODE_DEFINITION_SCHEMA = {
  id: 'resourceNodeDefinition',
  fields: {
    schemaVersion: versionField(),
    id: idField(),
    name: { type: FieldType.STRING, required: true, minLength: 1 },
    resourceType: {
      type: FieldType.STRING,
      required: true,
      enum: ['wood', 'iron', 'food', 'herb', 'stone']
    },
    itemId: idField(),
    remaining: nonNegativeInteger(true),
    maxRemaining: nonNegativeInteger(true),
    yieldPerGather: { type: FieldType.INTEGER, required: true, min: 1 },
    harvestYieldRange: { type: FieldType.OBJECT, schema: 'resourceNodeHarvestYieldRange' },
    gatherDuration: { type: FieldType.NUMBER, required: true, min: Number.MIN_VALUE },
    interactionRadius: { type: FieldType.NUMBER, required: true, min: Number.MIN_VALUE },
    requiredToolType: { nullable: true },
    refreshDays: nonNegativeInteger(true),
    refreshMode: { type: FieldType.STRING, enum: ['none', 'timed'] },
    refreshIntervalSeconds: { type: FieldType.NUMBER, min: 0 },
    guardUnitIds: { type: FieldType.ARRAY, required: true, itemType: FieldType.STRING },
    riskEvents: { type: FieldType.ARRAY, itemSchema: 'resourceNodeRiskEvent' },
    damageRatio: ratioField(true)
  },
  validate(node) {
    const errors = [];
    if (node.remaining > node.maxRemaining) {
      errors.push(makeError(
        ValidationCode.OUT_OF_RANGE,
        'remaining',
        '资源节点 remaining 不能大于 maxRemaining'
      ));
    }
    if (node.requiredToolType != null && (
      typeof node.requiredToolType !== 'string' || !node.requiredToolType.trim()
    )) {
      errors.push(makeError(
        ValidationCode.TYPE_MISMATCH,
        'requiredToolType',
        'requiredToolType 必须为非空字符串或 null'
      ));
    }
    return { ok: errors.length === 0, errors };
  }
};

export const ITEM_CAPABILITY_SCHEMA = {
  id: 'itemCapability',
  allowUnknown: false,
  fields: {
    id: { type: FieldType.STRING, minLength: 1 },
    capabilityId: { type: FieldType.STRING, minLength: 1 },
    strategyId: { type: FieldType.STRING, minLength: 1 },
    parameters: { type: FieldType.OBJECT },
    requires: { type: FieldType.ARRAY, itemType: FieldType.STRING },
    conflictsWith: { type: FieldType.ARRAY, itemType: FieldType.STRING }
  },
  validate(capability) {
    const id = capability.id || capability.capabilityId;
    if (typeof id === 'string' && id.trim()) return { ok: true, errors: [] };
    return { ok: false, errors: [makeError(ValidationCode.MISSING_FIELD, 'id', 'capability 需要 id 或 capabilityId')] };
  }
};

export const ITEM_DEFINITION_SCHEMA = {
  id: 'itemDefinition',
  fields: {
    id: idField(),
    name: { type: FieldType.STRING, minLength: 1 },
    description: { type: FieldType.STRING },
    type: { type: FieldType.STRING },
    imageId: { type: FieldType.STRING, minLength: 1 },
    assetId: { type: FieldType.STRING, minLength: 1 },
    capabilities: { type: FieldType.ARRAY, itemSchema: 'itemCapability' },
    tags: { type: FieldType.ARRAY, itemType: FieldType.STRING }
  },
  validate(definition) {
    if (definition.imageId && definition.assetId && definition.imageId !== definition.assetId) {
      return { ok: false, errors: [makeError(ValidationCode.INVALID_REFERENCE, 'assetId', 'assetId 必须与 imageId 使用同一稳定 ID')] };
    }
    return { ok: true, errors: [] };
  }
};

export const ITEM_STACK_SCHEMA = {
  id: 'itemStack',
  allowUnknown: false,
  fields: {
    definitionId: idField(),
    quantity: { type: FieldType.INTEGER, required: true, min: 1 }
  }
};

export const ITEM_INSTANCE_STATE_SCHEMA = {
  id: 'itemInstanceState',
  allowUnknown: false,
  fields: {
    definitionId: idField(),
    instanceId: idField(),
    mutable: { type: FieldType.OBJECT, required: true }
  }
};

export const GROUND_DROP_PROJECTION_SCHEMA = {
  id: 'groundDropProjection',
  allowUnknown: false,
  fields: {
    entityId: idField(),
    definitionId: idField(),
    instanceId: { type: FieldType.STRING, minLength: 1 },
    quantity: { type: FieldType.INTEGER, required: true, min: 1 },
    transform: { type: FieldType.OBJECT, required: true, schema: 'position' },
    pickupState: { type: FieldType.STRING, required: true, enum: ['available', 'reserved', 'picked'] }
  }
};

export const DEATH_DROP_PROJECTION_SCHEMA = {
  id: 'deathDropProjection',
  allowUnknown: false,
  fields: {
    entityId: idField(),
    deathId: idField(),
    stacks: { type: FieldType.ARRAY, required: true },
    transform: { type: FieldType.OBJECT, required: true, schema: 'position' }
  }
};

export const INVENTORY_STACK_SCHEMA = {
  id: 'inventoryStack',
  allowUnknown: false,
  fields: {
    itemId: idField(),
    quantity: nonNegativeInteger(true),
    maxStack: { type: FieldType.INTEGER, required: true, min: 1 },
    instanceIds: { type: FieldType.ARRAY, itemType: FieldType.STRING }
  }
};

export const INVENTORY_SCHEMA = {
  id: 'inventory',
  fields: {
    schemaVersion: versionField(),
    id: idField(),
    capacity: nonNegativeInteger(true),
    stacks: { type: FieldType.ARRAY, required: true, itemSchema: 'inventoryStack' }
  },
  validate(inventory) {
    const errors = [];
    const seen = new Set();
    let used = 0;

    for (const [index, stack] of (inventory.stacks || []).entries()) {
      if (!stack || typeof stack.itemId !== 'string') continue;
      if (seen.has(stack.itemId)) {
        errors.push(makeError(
          ValidationCode.DUPLICATE_ID,
          `stacks[${index}].itemId`,
          `重复的物品堆叠: ${stack.itemId}`
        ));
      }
      seen.add(stack.itemId);
      used += Number.isInteger(stack.quantity) ? stack.quantity : 0;
    }

    if (Number.isInteger(inventory.capacity) && used > inventory.capacity) {
      errors.push(makeError(
        ValidationCode.OUT_OF_RANGE,
        'stacks',
        `物品总量 ${used} 超过背包容量 ${inventory.capacity}`,
        { expected: `<= ${inventory.capacity}`, actual: used }
      ));
    }

    return { ok: errors.length === 0, errors };
  }
};


export const CITY_SCHEMA = {
  id: 'city',
  fields: {
    schemaVersion: versionField(),
    id: idField(),
    name: { type: FieldType.STRING, required: true, minLength: 1 },
    factionId: idField(),
    buildingLevel: nonNegativeInteger(true),
    resources: { type: FieldType.OBJECT, required: true, valueType: FieldType.INTEGER },
    damageRatio: ratioField(true),
    buildingDamage: { type: FieldType.OBJECT },
    morale: nonNegativeInteger(),
    damagePausedUntilDay: nonNegativeInteger()
  },
  validate(city) {
    const errors = validateNonNegativeIntegerMap(city.resources, 'resources');
    for (const [buildingId, ratio] of Object.entries(city.buildingDamage || {})) {
      if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
        errors.push({
          code: 'outOfRange',
          path: `buildingDamage.${buildingId}`,
          message: '建筑损毁比例必须在 [0,1] 范围内',
          actual: ratio
        });
      }
    }
    return { ok: errors.length === 0, errors };
  }
};

export const BATTLE_RESOURCE_TRANSFER_SCHEMA = {
  id: 'battleResourceTransfer',
  allowUnknown: false,
  fields: {
    fromCityId: idField(),
    toCityId: idField(),
    resources: { type: FieldType.OBJECT, required: true, valueType: FieldType.INTEGER }
  },
  validate(transfer) {
    const errors = validateNonNegativeIntegerMap(transfer.resources, 'resources');
    if (transfer.fromCityId === transfer.toCityId) {
      errors.push(makeError(
        ValidationCode.INVALID_REFERENCE,
        'toCityId',
        '资源转出城市与转入城市不能相同'
      ));
    }
    return { ok: errors.length === 0, errors };
  }
};

export const BATTLE_RESULT_SCHEMA = {
  id: 'battleResult',
  fields: {
    schemaVersion: versionField(),
    resultId: idField(),
    responseId: idField(),
    battleId: idField(),
    winnerFactionId: idField(),
    casualties: { type: FieldType.OBJECT, required: true, valueType: FieldType.INTEGER },
    capturedResources: { type: FieldType.OBJECT, required: true, valueType: FieldType.INTEGER },
    resourceTransfer: { type: FieldType.OBJECT, required: true, schema: 'battleResourceTransfer' },
    affectedCityId: idField(),
    cityDamage: ratioField(true),
    damagedResourceNodeIds: { type: FieldType.ARRAY, required: true, itemType: FieldType.STRING },
    completedAt: nonNegativeInteger(true)
  },
  validate(result) {
    const errors = [
      ...validateNonNegativeIntegerMap(result.casualties, 'casualties'),
      ...validateNonNegativeIntegerMap(result.capturedResources, 'capturedResources')
    ];
    const captured = result.capturedResources || {};
    const transferred = result.resourceTransfer?.resources || {};
    const resourceKeys = new Set([...Object.keys(captured), ...Object.keys(transferred)]);
    for (const resource of resourceKeys) {
      if ((captured[resource] || 0) !== (transferred[resource] || 0)) {
        errors.push(makeError(
          ValidationCode.OUT_OF_RANGE,
          `resourceTransfer.resources.${resource}`,
          '资源转移数量必须与 capturedResources 一致',
          { expected: captured[resource] || 0, actual: transferred[resource] || 0 }
        ));
      }
    }
    return { ok: errors.length === 0, errors };
  }
};

export const TOOL_STATE_SCHEMA = {
  id: 'checkpointTool',
  allowUnknown: false,
  fields: {
    instanceId: idField(),
    itemId: idField(),
    durability: nonNegativeInteger(true),
    maxDurability: nonNegativeInteger(true)
  },
  validate(tool) {
    if (tool.durability <= tool.maxDurability) return { ok: true, errors: [] };
    return {
      ok: false,
      errors: [makeError(
        ValidationCode.OUT_OF_RANGE,
        'durability',
        '当前耐久不得大于最大耐久',
        { expected: `<= ${tool.maxDurability}`, actual: tool.durability }
      )]
    };
  }
};

export const CHECKPOINT_PLAYER_SCHEMA = {
  id: 'checkpointPlayer',
  fields: {
    entityId: idField(),
    position: { type: FieldType.OBJECT, required: true, schema: 'position' },
    classId: idField(),
    health: nonNegativeInteger(true),
    maxHealth: nonNegativeInteger(true),
    inventory: { type: FieldType.OBJECT, required: true, schema: 'inventory' },
    tools: { type: FieldType.ARRAY, required: true, itemSchema: 'checkpointTool' }
  },
  validate(player) {
    if (player.health <= player.maxHealth) return { ok: true, errors: [] };
    return {
      ok: false,
      errors: [makeError(
        ValidationCode.OUT_OF_RANGE,
        'health',
        '当前生命不得大于最大生命',
        { expected: `<= ${player.maxHealth}`, actual: player.health }
      )]
    };
  }
};


export const CHECKPOINT_SCHEMA = {
  id: 'checkpoint',
  fields: {
    schemaVersion: versionField(),
    checkpointId: idField(),
    campaignId: idField(),
    createdAt: nonNegativeInteger(true),
    currentSceneId: {
      type: FieldType.STRING,
      required: true,
      minLength: 3
    },
    player: { type: FieldType.OBJECT, required: true, schema: 'checkpointPlayer' },
    storyState: { type: FieldType.OBJECT, required: true },
    sceneDynamicState: { type: FieldType.OBJECT, required: true },
    resourceNodes: { type: FieldType.ARRAY, required: true, itemSchema: 'resourceNode' },
    fieldStructures: { type: FieldType.ARRAY, required: true },
    vehicles: { type: FieldType.ARRAY, required: true },
    cityStates: { type: FieldType.ARRAY, required: true, itemSchema: 'city' },
    warState: { type: FieldType.OBJECT, required: true },
    progressionState: { type: FieldType.OBJECT, required: true },
    appliedBattleResultIds: { type: FieldType.ARRAY, required: true, itemType: FieldType.STRING },
    endingState: { type: FieldType.OBJECT, required: true }
  },
  validate(checkpoint) {
    if (/^S(?:0[1-9]|1[0-4])(?:-C\d{2})?$/.test(checkpoint.currentSceneId)) {
      return { ok: true, errors: [] };
    }
    return {
      ok: false,
      errors: [makeError(
        ValidationCode.OUT_OF_RANGE,
        'currentSceneId',
        '场景 ID 必须为 S01-S14 或对应的 SXX-CNN 附属 chunk',
        { expected: 'S01-S14 or SXX-CNN', actual: checkpoint.currentSceneId }
      )]
    };
  }
};

export const TUTORIAL_STEP_SCHEMA = {
  id: 'tutorialStep',
  fields: {
    id: { type: FieldType.STRING },
    text: { type: FieldType.STRING, required: true, minLength: 1 },
    image: { type: FieldType.STRING, nullable: true },
    target: { type: FieldType.STRING, nullable: true },
    highlightTarget: { type: FieldType.BOOLEAN },
    position: { type: FieldType.STRING },
    arrow: { type: FieldType.STRING, nullable: true }
  }
};

export const TUTORIAL_SIGNAL_CONDITION_SCHEMA = {
  id: 'tutorialSignalCondition',
  fields: {
    field: { type: FieldType.STRING, required: true, minLength: 1 },
    operator: { type: FieldType.STRING, required: true, enum: ['equals', 'notEquals', 'exists', 'gte', 'lte'] },
    value: {}
  }
};

export const TUTORIAL_SIGNAL_RULE_SCHEMA = {
  id: 'tutorialSignalRule',
  fields: {
    id: { type: FieldType.STRING },
    signal: { type: FieldType.STRING, required: true, minLength: 1 },
    threshold: { type: FieldType.INTEGER, min: 1 },
    conditions: { type: FieldType.ARRAY, itemSchema: 'tutorialSignalCondition' }
  }
};

export const TUTORIAL_MOVEMENT_RULE_SCHEMA = {
  id: 'tutorialMovementRule',
  fields: {
    mode: { type: FieldType.STRING, enum: ['distance', 'anyMovement'] },
    threshold: { type: FieldType.NUMBER, required: true, min: 0 },
    epsilon: { type: FieldType.NUMBER, min: 0 }
  }
};

/** @deprecated 使用 FLOW_GROUP_SCOPE_SCHEMA */
export const SCENE_EVENT_SCOPE_SCHEMA = {
  id: 'sceneEventScope',
  fields: {
    sceneIds: { type: FieldType.ARRAY, required: true, minItems: 1, itemType: FieldType.STRING }
  }
};

/** @deprecated 使用 FLOW_GROUP_DEFINITION_SCHEMA */
export const SCENE_EVENT_DEFINITION_SCHEMA = {
  id: 'sceneEventDefinition',
  fields: {
    id: idField(),
    name: { type: FieldType.STRING, required: true, minLength: 1 },
    description: { type: FieldType.STRING },
    scope: { type: FieldType.OBJECT, required: true, schema: 'sceneEventScope' },
    order: { type: FieldType.INTEGER, required: true, min: 0 },
    dependsOn: { type: FieldType.ARRAY, itemType: FieldType.STRING },
    activeWhen: { type: FieldType.OBJECT },
    completionWhen: { type: FieldType.OBJECT }
  }
};

export const FLOW_GROUP_SCOPE_SCHEMA = {
  id: 'flowGroupScope',
  fields: {
    sceneIds: { type: FieldType.ARRAY, required: true, minItems: 1, itemType: FieldType.STRING }
  }
};

export const FLOW_GROUP_CONTROL_SCHEMA = {
  id: 'flowGroupControl',
  fields: {
    autoActivate: { type: FieldType.BOOLEAN },
    autoComplete: { type: FieldType.BOOLEAN },
    repeatable: { type: FieldType.BOOLEAN },
    maxProgress: { type: FieldType.INTEGER, min: 0 },
    notifyProgressEvery: { type: FieldType.INTEGER, min: 1 }
  }
};

export const FLOW_GROUP_DEFINITION_SCHEMA = {
  id: 'flowGroupDefinition',
  fields: {
    id: idField(),
    name: { type: FieldType.STRING, required: true, minLength: 1 },
    description: { type: FieldType.STRING },
    scope: { type: FieldType.OBJECT, required: true, schema: 'flowGroupScope' },
    order: { type: FieldType.INTEGER, required: true, min: 0 },
    dependsOn: { type: FieldType.ARRAY, itemType: FieldType.STRING },
    activeWhen: { type: FieldType.OBJECT },
    completionWhen: { type: FieldType.OBJECT },
    control: { type: FieldType.OBJECT, schema: 'flowGroupControl' },
    // 兼容旧名：允许 sceneEvent 项目载入后双读（normalizeProject 后写入 flowGroups）
    sceneEventId: { type: FieldType.STRING, deprecated: true, description: '兼容旧字段别名，写入后即视为 flowGroupId' }
  }
};

export const TUTORIAL_SCOPE_SCHEMA = {
  id: 'tutorialScope',
  fields: {
    sceneIds: { type: FieldType.ARRAY, minItems: 1, itemType: FieldType.STRING }
  }
};

export const TUTORIAL_DEFINITION_SCHEMA = {
  id: 'tutorialDefinition',
  fields: {
    id: idField(),
    title: { type: FieldType.STRING, required: true, minLength: 1 },
    description: { type: FieldType.STRING },
    category: { type: FieldType.STRING, required: true, minLength: 1 },
    flowGroupId: { type: FieldType.STRING, minLength: 1 },
    sceneEventId: { type: FieldType.STRING, minLength: 1, deprecated: true, description: '已弃用，使用 flowGroupId' },
    scope: { type: FieldType.OBJECT, schema: 'tutorialScope' },
    // 已迁移 Tutorial 继承 FlowGroup.order；旧定义仍可保留 order 作为兼容回退。
    order: { type: FieldType.INTEGER, min: 0 },
    steps: { type: FieldType.ARRAY, required: true, minItems: 1, itemSchema: 'tutorialStep' },
    signalRules: { type: FieldType.ARRAY, itemSchema: 'tutorialSignalRule' },
    movementRule: { type: FieldType.OBJECT, schema: 'tutorialMovementRule' },
    completionPolicy: { type: FieldType.STRING, required: true, enum: ['allSteps', 'signal', 'manual'] },
    pauseGame: { type: FieldType.BOOLEAN },
    canSkip: { type: FieldType.BOOLEAN },
    autoTrigger: { type: FieldType.BOOLEAN },
    autoAdvance: { type: FieldType.BOOLEAN },
    priority: { type: FieldType.INTEGER }
  }
};

export const GAME_PROJECT_META_SCHEMA = {
  id: 'gameProjectMeta',
  fields: {
    id: idField(),
    name: { type: FieldType.STRING, required: true, minLength: 1 },
    version: { type: FieldType.INTEGER, required: true, min: 1 },
    schema: { type: FieldType.INTEGER, required: true, min: 1 },
    campaignId: idField()
  }
};

export const BATTLE_INTEGRATION_SCHEMA = {
  id: 'battleIntegration',
  allowUnknown: false,
  fields: {
    resultSource: {
      type: FieldType.STRING,
      required: true,
      enum: ['localMock', 'external']
    },
    localMock: { type: FieldType.OBJECT },
    external: { type: FieldType.OBJECT }
  },
  validate(config) {
    const selected = config[config.resultSource];
    if (selected && typeof selected === 'object') return { ok: true, errors: [] };
    return {
      ok: false,
      errors: [makeError(
        ValidationCode.MISSING_FIELD,
        config.resultSource,
        `结果源 ${config.resultSource} 缺少对应配置`
      )]
    };
  }
};

export const GAME_PROJECT_INTEGRATION_SCHEMA = {
  id: 'gameProjectIntegration',
  allowUnknown: false,
  fields: {
    battle: { type: FieldType.OBJECT, required: true, schema: 'battleIntegration' }
  }
};

export const GAME_PROJECT_LIBRARY_SCHEMA = {
  id: 'gameProjectLibrary',
  fields: {
    items: { type: FieldType.ARRAY, itemSchema: 'itemDefinition' },
    equipment: { type: FieldType.ARRAY },
    enemies: { type: FieldType.ARRAY },
    npcs: { type: FieldType.ARRAY },
    shops: { type: FieldType.ARRAY },
    classes: { type: FieldType.ARRAY },
    skills: { type: FieldType.ARRAY },
    vehicles: { type: FieldType.ARRAY },
    buildings: { type: FieldType.ARRAY },
    resourceNodes: { type: FieldType.ARRAY, itemSchema: 'resourceNodeDefinition' }
  }
};

/** Region 级地图契约；几何、footprint 与跨 Region 唯一性仍由 ProjectWorldIndex 校验。 */
export const GAME_PROJECT_WORLD_MAP_REGION_SCHEMA = {
  id: 'gameProjectWorldMapRegion',
  fields: {
    id: idField(),
    name: { type: FieldType.STRING },
    mapType: {
      type: FieldType.STRING,
      enum: WORLD_MAP_REGION_TYPES,
      default: DEFAULT_WORLD_MAP_REGION_TYPE
    },
    previewOnly: { type: FieldType.BOOLEAN },
    rows: { type: FieldType.INTEGER, required: true, min: 1 },
    cols: { type: FieldType.INTEGER, required: true, min: 1 },
    chunkWidth: { type: FieldType.NUMBER, required: true, min: Number.MIN_VALUE },
    chunkHeight: { type: FieldType.NUMBER, required: true, min: Number.MIN_VALUE },
    grid: { type: FieldType.ARRAY, required: true, minItems: 1, itemType: FieldType.ARRAY }
  }
};

export const GAME_PROJECT_WORLD_MAP_SCHEMA = {
  id: 'gameProjectWorldMap',
  fields: {
    entrySceneId: { type: FieldType.STRING, required: true, minLength: 1 },
    regions: {
      type: FieldType.ARRAY,
      required: true,
      minItems: 1,
      itemSchema: 'gameProjectWorldMapRegion'
    }
  }
};

export const GAME_PROJECT_SCHEMA = {
  id: 'gameProject',
  fields: {
    schemaVersion: versionField(),
    meta: { type: FieldType.OBJECT, required: true, schema: 'gameProjectMeta' },
    assetManifest: { type: FieldType.OBJECT, required: true },
    presentation: { type: FieldType.OBJECT, required: true },
    // 游戏专属的纯数据扩展；复杂事务仍由具体游戏 coordinator/system 消费。
    extensions: { type: FieldType.OBJECT },
    // 可选消费契约只声明需被证明的通用 schema path；不承载运行态或函数。
    consumptionRequirements: { type: FieldType.OBJECT },
    system: { type: FieldType.OBJECT },
    progression: { type: FieldType.OBJECT, schema: 'progressionConfig' },
    construction: { type: FieldType.OBJECT },
    battles: { type: FieldType.ARRAY },
    rescues: { type: FieldType.ARRAY },
    scenarios: { type: FieldType.ARRAY },
    capabilityCatalog: { type: FieldType.ARRAY },
    strategyCatalog: { type: FieldType.ARRAY },
    variables: { type: FieldType.OBJECT, required: true },
    worldMap: { type: FieldType.OBJECT, required: true, schema: 'gameProjectWorldMap' },
    scenes: { type: FieldType.ARRAY, required: true },
    dialogues: { type: FieldType.ARRAY, required: true },
    quests: { type: FieldType.ARRAY, required: true },
    // 剧情流程分组（新名）：作为统一宏观流程身份标识；未迁移场景仍可暂不声明。
    flowGroups: { type: FieldType.ARRAY, itemSchema: 'flowGroupDefinition' },
    // 增量接入（旧名，已弃用）：保留一个版本兼容，内部 normalizeProjectForRuntime 自动迁移为 flowGroups
    sceneEvents: { type: FieldType.ARRAY, itemSchema: 'sceneEventDefinition', deprecated: true, description: '已弃用，使用 flowGroups' },
    triggerCatalog: { type: FieldType.OBJECT },
    triggers: { type: FieldType.ARRAY, required: true },
    tutorials: { type: FieldType.ARRAY, required: true, itemSchema: 'tutorialDefinition' },
    library: { type: FieldType.OBJECT, required: true, schema: 'gameProjectLibrary' },
    integration: { type: FieldType.OBJECT, required: true, schema: 'gameProjectIntegration' }
  }
};

export const CANONICAL_SCHEMAS = [
  POSITION_SCHEMA,
  UNIT_SCHEMA,
  HERO_SCHEMA,
  FORMATION_SCHEMA,
  ARMY_SCHEMA,
  RESOURCE_NODE_SCHEMA,
  RESOURCE_NODE_RISK_EVENT_SCHEMA,
  RESOURCE_NODE_HARVEST_YIELD_RANGE_SCHEMA,
  RESOURCE_NODE_DEFINITION_SCHEMA,
  ITEM_CAPABILITY_SCHEMA,
  ITEM_DEFINITION_SCHEMA,
  ITEM_STACK_SCHEMA,
  ITEM_INSTANCE_STATE_SCHEMA,
  GROUND_DROP_PROJECTION_SCHEMA,
  DEATH_DROP_PROJECTION_SCHEMA,
  INVENTORY_STACK_SCHEMA,
  INVENTORY_SCHEMA,
  CITY_SCHEMA,
  BATTLE_RESOURCE_TRANSFER_SCHEMA,
  BATTLE_RESULT_SCHEMA,
  TOOL_STATE_SCHEMA,
  CHECKPOINT_PLAYER_SCHEMA,
  CHECKPOINT_SCHEMA,
  TUTORIAL_STEP_SCHEMA,
  TUTORIAL_SIGNAL_CONDITION_SCHEMA,
  TUTORIAL_SIGNAL_RULE_SCHEMA,
  TUTORIAL_MOVEMENT_RULE_SCHEMA,
  SCENE_EVENT_SCOPE_SCHEMA,
  SCENE_EVENT_DEFINITION_SCHEMA,
  FLOW_GROUP_SCOPE_SCHEMA,
  FLOW_GROUP_CONTROL_SCHEMA,
  FLOW_GROUP_DEFINITION_SCHEMA,
  TUTORIAL_SCOPE_SCHEMA,
  TUTORIAL_DEFINITION_SCHEMA,
  GAME_PROJECT_META_SCHEMA,
  BATTLE_INTEGRATION_SCHEMA,
  GAME_PROJECT_INTEGRATION_SCHEMA,
  GAME_PROJECT_LIBRARY_SCHEMA,
  GAME_PROJECT_WORLD_MAP_REGION_SCHEMA,
  GAME_PROJECT_WORLD_MAP_SCHEMA,
  GAME_PROJECT_SCHEMA
];

export default CANONICAL_SCHEMAS;