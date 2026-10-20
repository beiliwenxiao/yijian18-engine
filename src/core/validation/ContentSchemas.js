/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * ContentSchemas.js
 * 内容配置 Schema 定义。
 *
 * 覆盖成长系统相关配置；其他内容类型可按同样方式追加。
 */

import { FieldType, ContentValidator } from './ContentValidator.js';
import { ValidationCode, makeError } from './ValidationError.js';
import { CANONICAL_SCHEMAS, CANONICAL_SCHEMA_VERSION } from '../../data/schema/CanonicalSchemas.js';
import { ASSET_MANIFEST_SCHEMAS } from '../../data/schema/AssetManifestSchemas.js';
import { PRESENTATION_PROFILE_SCHEMAS } from '../../data/schema/PresentationProfileSchemas.js';

/** 效果 */
export const EFFECT_SCHEMA = {
  id: 'effect',
  fields: {
    type: { type: FieldType.STRING, required: true },
    target: { type: FieldType.STRING, required: true },
    operation: { type: FieldType.STRING },
    value: {},   // 数值、数组或布尔，由领域层进一步校验
    sourceId: { type: FieldType.STRING },
    stackGroup: { type: FieldType.STRING },
    priority: { type: FieldType.NUMBER }
  }
};

/** 技能定义 */
export const SKILL_SCHEMA = {
  id: 'skill',
  fields: {
    id: { type: FieldType.STRING, required: true, minLength: 1 },
    name: { type: FieldType.STRING },
    description: { type: FieldType.STRING },
    category: {
      type: FieldType.STRING,
      enum: ['attack', 'heal', 'buff', 'locomotion', 'utility']
    },
    targeting: {
      type: FieldType.STRING,
      enum: ['self', 'entity', 'position', 'direction', 'area']
    },
    params: { type: FieldType.OBJECT, valueType: FieldType.NUMBER },
    costs: { type: FieldType.OBJECT, valueType: FieldType.NUMBER },
    tags: { type: FieldType.ARRAY, itemType: FieldType.STRING },
    vfx: { type: FieldType.OBJECT },
    variants: { type: FieldType.OBJECT }
  }
};

/** 成长节点 */
export const NODE_SCHEMA = {
  id: 'progressionNode',
  fields: {
    id: { type: FieldType.STRING, required: true, minLength: 1 },
    name: { type: FieldType.STRING },
    description: { type: FieldType.STRING },
    kind: {
      type: FieldType.STRING,
      enum: [
        'activeSkill', 'skillModifier', 'passive', 'specialization',
        'minor', 'notable', 'keystone', 'mastery', 'socket', 'start'
      ]
    },
    maxRank: { type: FieldType.INTEGER, min: 1 },
    costs: { type: FieldType.OBJECT, valueType: FieldType.NUMBER },
    prerequisites: {},   // 数组或 { mode, nodes }，由领域层规范化
    choiceGroup: { type: FieldType.STRING },
    exclusiveWith: { type: FieldType.ARRAY, itemType: FieldType.STRING },
    position: { type: FieldType.OBJECT, valueType: FieldType.NUMBER },
    region: { type: FieldType.STRING },
    gates: { type: FieldType.OBJECT, valueType: FieldType.NUMBER },
    effects: { type: FieldType.ARRAY, itemSchema: 'effect' },
    tags: { type: FieldType.ARRAY, itemType: FieldType.STRING }
  }
};

/** 成长图 */
export const GRAPH_SCHEMA = {
  id: 'progressionGraph',
  fields: {
    id: { type: FieldType.STRING, required: true, minLength: 1 },
    mode: {
      type: FieldType.STRING,
      required: true,
      enum: ['classSkill', 'classTalent', 'unitTalent', 'passiveBoard']
    },
    version: { type: FieldType.INTEGER, min: 1 },
    pointPool: { type: FieldType.STRING },
    startNodes: { type: FieldType.ARRAY, itemType: FieldType.STRING },
    rules: { type: FieldType.OBJECT },
    nodes: { type: FieldType.ARRAY, required: true, minItems: 1, itemSchema: 'progressionNode' },
    edges: { type: FieldType.ARRAY }
  },

  /**
   * 跨字段规则：
   *   - 节点 id 唯一
   *   - 连线与前置引用必须指向已定义节点
   *   - 天赋盘必须有可用起点
   */
  validate(graph) {
    const errors = [];
    const ids = new Set();

    for (const [index, node] of (graph.nodes || []).entries()) {
      if (!node || typeof node.id !== 'string') continue;
      if (ids.has(node.id)) {
        errors.push(makeError(ValidationCode.DUPLICATE_ID, `nodes[${index}].id`, `重复的节点 id: ${node.id}`));
      }
      ids.add(node.id);
    }

    for (const [index, node] of (graph.nodes || []).entries()) {
      if (!node) continue;

      const prereq = Array.isArray(node.prerequisites)
        ? node.prerequisites
        : (node.prerequisites && Array.isArray(node.prerequisites.nodes) ? node.prerequisites.nodes : []);

      for (const ref of prereq) {
        if (!ids.has(ref)) {
          errors.push(makeError(
            ValidationCode.INVALID_REFERENCE,
            `nodes[${index}].prerequisites`,
            `前置节点不存在: ${ref}`
          ));
        }
      }

      for (const ref of node.exclusiveWith || []) {
        if (!ids.has(ref)) {
          errors.push(makeError(
            ValidationCode.INVALID_REFERENCE,
            `nodes[${index}].exclusiveWith`,
            `互斥节点不存在: ${ref}`
          ));
        }
      }
    }

    for (const [index, edge] of (graph.edges || []).entries()) {
      if (!Array.isArray(edge) || edge.length !== 2) {
        errors.push(makeError(ValidationCode.TYPE_MISMATCH, `edges[${index}]`, '连线必须为两个节点 id 的数组'));
        continue;
      }
      for (const ref of edge) {
        if (!ids.has(ref)) {
          errors.push(makeError(ValidationCode.INVALID_REFERENCE, `edges[${index}]`, `连线引用了不存在的节点: ${ref}`));
        }
      }
    }

    if (graph.mode === 'passiveBoard') {
      const declared = Array.isArray(graph.startNodes) ? graph.startNodes : [];
      const implicit = (graph.nodes || []).filter(n => n && n.kind === 'start').map(n => n.id);
      const starts = declared.length > 0 ? declared : implicit;

      if (starts.length === 0) {
        errors.push(makeError(ValidationCode.MISSING_FIELD, 'startNodes', '天赋盘必须定义起点节点'));
      }
      for (const ref of declared) {
        if (!ids.has(ref)) {
          errors.push(makeError(ValidationCode.INVALID_REFERENCE, 'startNodes', `起点节点不存在: ${ref}`));
        }
      }
    }

    return { ok: errors.length === 0, errors };
  }
};

/** 熟练度配置：独立于成长点池，阈值从 0 开始并严格递增。 */
export const PROFICIENCY_CONFIG_SCHEMA = {
  id: 'proficiencyConfig',
  fields: {
    schemaVersion: { type: FieldType.INTEGER, required: true, min: 1, max: 1 },
    maxCompletedOperations: { type: FieldType.INTEGER, min: 1 },
    types: { type: FieldType.OBJECT, required: true }
  },
  validate(config) {
    const errors = [];
    const entries = Object.entries(config.types || {});
    if (entries.length === 0) {
      errors.push(makeError(ValidationCode.MISSING_FIELD, 'types', '至少需要一种熟练度定义'));
    }
    for (const [type, definition] of entries) {
      const path = `types.${type}`;
      const thresholds = definition?.thresholds;
      const maxLevel = definition?.maxLevel;
      const validThresholds = Array.isArray(thresholds)
        && thresholds.length > 0
        && thresholds[0] === 0
        && thresholds.every((value, index) => Number.isInteger(value) && value >= 0
          && (index === 0 || value > thresholds[index - 1]));
      if (!validThresholds) {
        errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${path}.thresholds`, '阈值必须从 0 开始并严格递增'));
      }
      if (!Number.isInteger(maxLevel) || !Array.isArray(thresholds) || maxLevel !== thresholds.length) {
        errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${path}.maxLevel`, 'maxLevel 必须等于 thresholds 长度'));
      }
      if (definition?.experiencePerUnit !== undefined
        && (!Number.isFinite(definition.experiencePerUnit) || definition.experiencePerUnit <= 0)) {
        errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${path}.experiencePerUnit`, '单位经验必须大于 0'));
      }
    }
    return { ok: errors.length === 0, errors };
  }
};

/** 升级发成长点配置：池名必须是项目已启用的逻辑池，数量为正。 */
export const LEVEL_UP_POINTS_SCHEMA = {
  id: 'levelUpPointsConfig',
  fields: {
    pool: { type: FieldType.STRING, enum: ['skill', 'talent', 'unit', 'passive'], required: true },
    amount: { type: FieldType.NUMBER, required: true, min: 1 }
  }
};

/** 成长 Profile */
export const PROGRESSION_CONFIG_SCHEMA = {
  id: 'progressionConfig',
  fields: {
    profile: { type: FieldType.STRING, enum: ['classicRpg', 'arpg', 'poeLike', 'roguelite'] },
    primary: {
      type: FieldType.STRING,
      enum: ['skillTree', 'talentTree', 'unitTalent', 'passiveBoard']
    },
    enabled: { type: FieldType.ARRAY, itemType: FieldType.STRING },
    secondary: { type: FieldType.ARRAY, itemType: FieldType.STRING },
    pointPools: { type: FieldType.OBJECT, valueType: FieldType.STRING },
    unlock: { type: FieldType.OBJECT, valueType: FieldType.STRING },
    graphIds: { type: FieldType.OBJECT, valueType: FieldType.STRING },
    graphs: { type: FieldType.ARRAY },
    skills: {},
    proficiency: { type: FieldType.OBJECT, schema: 'proficiencyConfig' },
    levelUpPoints: { type: FieldType.OBJECT, schema: 'levelUpPointsConfig' },
    battleRewards: { type: FieldType.OBJECT }
  },

  /** primary 必须在 enabled 内 */
  validate(config) {
    if (!config.primary || !Array.isArray(config.enabled)) return { ok: true, errors: [] };
    if (config.enabled.includes(config.primary)) return { ok: true, errors: [] };

    return {
      ok: false,
      errors: [makeError(
        ValidationCode.INVALID_REFERENCE,
        'primary',
        `主要成长结构 ${config.primary} 未出现在 enabled 中`
      )]
    };
  }
};

/** 通用救援阶段；人物、场景与历史事实只通过稳定引用进入内容定义。 */
export const RESCUE_STAGE_SCHEMA = {
  id: 'rescueStage',
  fields: {
    id: { type: FieldType.STRING, required: true, minLength: 1 },
    objective: { type: FieldType.STRING, required: true, minLength: 1 }
  },
  validate(stage) {
    const errors = [];
    if (typeof stage.id === 'string' && !stage.id.trim()) {
      errors.push(makeError(ValidationCode.MISSING_FIELD, 'id', '救援阶段 id 不能为空'));
    }
    if (typeof stage.objective === 'string' && !stage.objective.trim()) {
      errors.push(makeError(ValidationCode.MISSING_FIELD, 'objective', '救援阶段目标不能为空'));
    }
    return { ok: errors.length === 0, errors };
  }
};

/** 通用限时救援定义；运行时只解释模式、时限、阶段、成本和稳定引用。 */
export const RESCUE_DEFINITION_SCHEMA = {
  id: 'rescueDefinition',
  fields: {
    schemaVersion: { type: FieldType.INTEGER, required: true, min: 1, max: 1 },
    id: { type: FieldType.STRING, required: true, minLength: 1 },
    battleId: { type: FieldType.STRING, required: true, minLength: 1 },
    duration: { type: FieldType.NUMBER, required: true, min: Number.MIN_VALUE },
    allowedModes: {
      type: FieldType.ARRAY,
      required: true,
      minItems: 1,
      itemType: FieldType.STRING
    },
    targetEntityId: { type: FieldType.STRING, minLength: 1 },
    evacuationRef: { type: FieldType.STRING, minLength: 1 },
    stages: {
      type: FieldType.ARRAY,
      required: true,
      minItems: 1,
      itemSchema: 'rescueStage'
    },
    costs: { type: FieldType.OBJECT, valueType: FieldType.NUMBER }
  },
  validate(definition) {
    const errors = [];
    if (typeof definition.id === 'string' && !definition.id.trim()) {
      errors.push(makeError(ValidationCode.MISSING_FIELD, 'id', '救援定义 id 不能为空'));
    }
    if (typeof definition.battleId === 'string' && !definition.battleId.trim()) {
      errors.push(makeError(ValidationCode.MISSING_FIELD, 'battleId', '救援 battleId 不能为空'));
    }
    for (const [index, mode] of (definition.allowedModes || []).entries()) {
      if (mode === 'observe' || mode === 'intervene') continue;
      errors.push(makeError(
        ValidationCode.OUT_OF_RANGE,
        `allowedModes[${index}]`,
        '救援模式必须为 observe 或 intervene'
      ));
    }
    const stageIds = new Set();
    for (const [index, stage] of (definition.stages || []).entries()) {
      if (!stage?.id || stageIds.has(stage.id)) {
        if (stageIds.has(stage?.id)) {
          errors.push(makeError(
            ValidationCode.DUPLICATE_ID,
            `stages[${index}].id`,
            `重复的救援阶段 id: ${stage.id}`
          ));
        }
        continue;
      }
      stageIds.add(stage.id);
    }
    for (const [resource, amount] of Object.entries(definition.costs || {})) {
      if (amount >= 0) continue;
      errors.push(makeError(
        ValidationCode.OUT_OF_RANGE,
        `costs.${resource}`,
        '救援成本不得为负数'
      ));
    }
    return { ok: errors.length === 0, errors };
  }
};

/** 军团编制定义；分队 id 对齐选择槽循环（qian/zuo/zhong/you/hou），兵种引用 enemies 注册表。 */
export const ARMY_SCHEMA = {
  id: 'armyDefinition',
  fields: {
    id: { type: FieldType.STRING, required: true, minLength: 1 },
    name: { type: FieldType.STRING, required: true, minLength: 1 },
    commander: { type: FieldType.OBJECT },
    defaultStance: { type: FieldType.STRING, minLength: 1 },
    squads: { type: FieldType.ARRAY, required: true, minItems: 1, maxItems: 5, itemSchema: 'armySquad' }
  },
  validate(definition) {
    const errors = [];
    const squadIds = new Set();
    for (const [index, squad] of (definition.squads || []).entries()) {
      if (squad?.id && squadIds.has(squad.id)) {
        errors.push(makeError(
          ValidationCode.DUPLICATE_ID,
          `squads[${index}].id`,
          `重复的分队 id: ${squad.id}`
        ));
      }
      if (squad?.id) squadIds.add(squad.id);
      const KNOWN_SQUADS = new Set(['qian', 'zuo', 'zhong', 'you', 'hou']);
      if (squad?.id && !KNOWN_SQUADS.has(squad.id)) {
        errors.push(makeError(
          ValidationCode.OUT_OF_RANGE,
          `squads[${index}].id`,
          `分队 id 必须对齐选择槽循环（qian/zuo/zhong/you/hou）: ${squad.id}`
        ));
      }
      for (const [unitIndex, unit] of (squad?.units || []).entries()) {
        if (!unit?.ref || typeof unit.ref !== 'string') {
          errors.push(makeError(
            ValidationCode.MISSING_FIELD,
            `squads[${index}].units[${unitIndex}].ref`,
            '兵种单位必须引用 enemies 注册表 id'
          ));
        }
        const count = Number(unit?.count);
        if (!Number.isFinite(count) || count < 0) {
          errors.push(makeError(
            ValidationCode.OUT_OF_RANGE,
            `squads[${index}].units[${unitIndex}].count`,
            '单位数量必须为非负数字（0 = 占编组槽不出兵）'
          ));
        }
      }
    }
    return { ok: errors.length === 0, errors };
  }
};

/** 军团编制分队；数量构成（units[].count）是编制数量的单一来源。 */
export const ARMY_SQUAD_SCHEMA = {
  id: 'armySquad',
  fields: {
    id: { type: FieldType.STRING, required: true, minLength: 1 },
    name: { type: FieldType.STRING, required: true, minLength: 1 },
    units: { type: FieldType.ARRAY, required: true, minItems: 1, itemSchema: 'armyUnit' }
  }
};

/** 军团单位构成行；overrides 复用 placement 同款合并语义。 */
export const ARMY_UNIT_SCHEMA = {
  id: 'armyUnit',
  fields: {
    ref: { type: FieldType.STRING, required: true, minLength: 1 },
    count: { type: FieldType.NUMBER, required: true, min: 0 },
    overrides: { type: FieldType.OBJECT }
  }
};

/** 全部内置 Schema：成长配置、救援定义 + Canonical 业务模型 */
export const CONTENT_SCHEMAS = [
  EFFECT_SCHEMA,
  SKILL_SCHEMA,
  NODE_SCHEMA,
  GRAPH_SCHEMA,
  PROFICIENCY_CONFIG_SCHEMA,
  LEVEL_UP_POINTS_SCHEMA,
  PROGRESSION_CONFIG_SCHEMA,
  RESCUE_STAGE_SCHEMA,
  RESCUE_DEFINITION_SCHEMA,
  ARMY_SCHEMA,
  ARMY_SQUAD_SCHEMA,
  ARMY_UNIT_SCHEMA,
  ...CANONICAL_SCHEMAS,
  ...ASSET_MANIFEST_SCHEMAS,
  ...PRESENTATION_PROFILE_SCHEMAS
];

/**
 * 创建预置全部 Schema 的校验器
 * @param {Object} [config]
 * @returns {ContentValidator}
 */
export function createContentValidator(config = {}) {
  const validator = new ContentValidator({ supportedVersion: CANONICAL_SCHEMA_VERSION, ...config });
  validator.registerSchemas(CONTENT_SCHEMAS);
  return validator;
}
