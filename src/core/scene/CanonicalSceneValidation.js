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

import { CANONICAL_SCHEMA_VERSION } from '../../data/schema/CanonicalSchemas.js';
import { CanonicalCandidatePipeline } from '../validation/CanonicalCandidatePipeline.js';
import { ContentValidator, FieldType } from '../validation/ContentValidator.js';
import {
  ContentErrorCategory,
  ContentPhase,
  createContentOperationResult
} from '../validation/ContentOperationResult.js';

const PROJECT_META_SCHEMA = 'canonicalSceneProjectMetadata';
const PROJECT_SCENE_SCHEMA = 'canonicalSceneProjectEntry';
const PROJECT_META_DETAIL_SCHEMA = 'canonicalSceneProjectMetaDetail';
const SCENE_ORDER_SCHEMA = 'canonicalSceneOrder';
const SCENE_SCHEMA = 'canonicalSceneDocument';

function failure({ source, category, phase, code, path, message, value = null }) {
  return createContentOperationResult({
    ok: false, value, source, category, phase,
    errors: [{ code, path, message }]
  });
}

/** 为场景仓库提供统一 parse/schema/canonicalize 管线与跨文档约束。 */
export class CanonicalSceneValidator {
  constructor({ pipeline = null, fingerprint = null } = {}) {
    this.pipeline = pipeline || createPipeline();
    this.fingerprint = fingerprint || `canonical-scene-v1-schema-${CANONICAL_SCHEMA_VERSION}`;
  }

  validateProject(input, { source = '<project>' } = {}) {
    return this.pipeline.process(input, { schemaId: PROJECT_META_SCHEMA, source });
  }

  validateSceneOrder(input, { source = '<scene-order>', project = null } = {}) {
    const result = this.pipeline.process(input, { schemaId: SCENE_ORDER_SCHEMA, source });
    if (!result.ok) return result;
    const projectId = project?.meta?.id;
    if (projectId && result.value.gameId !== projectId) {
      return failure({
        source, category: ContentErrorCategory.REFERENCE_FAILED, phase: ContentPhase.REFERENCE,
        code: 'projectSceneOrderMismatch', path: 'gameId',
        message: `场景列表 gameId ${result.value.gameId} 与项目 ${projectId} 不一致`
      });
    }
    return result;
  }

  validateScene(input, { source = '<scene>', sceneId } = {}) {
    const result = this.pipeline.process(input, { schemaId: SCENE_SCHEMA, source });
    if (!result.ok) return result;
    if (result.value.id !== sceneId) {
      return failure({
        source, category: ContentErrorCategory.REFERENCE_FAILED, phase: ContentPhase.REFERENCE,
        code: 'sceneIdMismatch', path: 'id',
        message: `场景文件 ID ${result.value.id} 与列表 ID ${sceneId} 不一致`
      });
    }
    return result;
  }
}
function createRepositoryRuleValidator(contentValidator) {
  return {
    validateSchema(candidate, schemaId) {
      return [
        ...contentValidator.validateVersion(candidate).errors,
        ...contentValidator.validate(candidate, schemaId).errors
      ];
    },
    validateReferences() { return []; },
    validateBusinessRules() { return []; }
  };
}

function createPipeline() {
  const contentValidator = new ContentValidator({ supportedVersion: CANONICAL_SCHEMA_VERSION });
  contentValidator.registerSchemas([
    {
      id: PROJECT_META_DETAIL_SCHEMA,
      fields: {
        id: { type: FieldType.STRING, required: true, minLength: 1 },
        version: { type: FieldType.INTEGER, required: true, min: 1 },
        schema: { type: FieldType.INTEGER, required: true, min: 1 }
      }
    },
    {
      id: PROJECT_SCENE_SCHEMA,
      fields: { id: { type: FieldType.STRING, required: true, minLength: 1 } }
    },
    {
      id: PROJECT_META_SCHEMA,
      fields: {
        schemaVersion: { type: FieldType.INTEGER, required: true, min: 1 },
        meta: { type: FieldType.OBJECT, required: true, schema: PROJECT_META_DETAIL_SCHEMA },
        scenes: { type: FieldType.ARRAY, required: true, itemSchema: PROJECT_SCENE_SCHEMA }
      }
    },
    {
      id: SCENE_ORDER_SCHEMA,
      fields: {
        gameId: { type: FieldType.STRING, required: true, minLength: 1 },
        order: { type: FieldType.ARRAY, required: true, itemType: FieldType.STRING },
        scenes: { type: FieldType.OBJECT, required: true }
      },
      validate(value) {
        const errors = [];
        const sceneIds = Object.keys(value.scenes || {});
        const seen = new Set();
        value.order?.forEach((sceneId, index) => {
          if (seen.has(sceneId)) errors.push({ code: 'duplicateSceneId', path: `order[${index}]`, message: `场景列表重复 ID: ${sceneId}` });
          seen.add(sceneId);
          if (!Object.prototype.hasOwnProperty.call(value.scenes || {}, sceneId)) {
            errors.push({ code: 'unknownSceneId', path: `order[${index}]`, message: `order 中的 ID 未在 scenes 登记: ${sceneId}` });
          }
        });
        sceneIds.forEach(sceneId => {
          const descriptor = value.scenes[sceneId];
          if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
            errors.push({ code: 'invalidSceneDescriptor', path: `scenes.${sceneId}`, message: '场景描述必须是对象' });
          }
        });
        return { ok: errors.length === 0, errors };
      }
    },
    {
      id: SCENE_SCHEMA,
      fields: {
        id: { type: FieldType.STRING, required: true, minLength: 1 },
        layers: { type: FieldType.ARRAY, required: true }
      },
      validate(value) {
        const errors = [];
        const legacyRoots = ['objects', 'placements', 'effectZones'];
        for (const field of legacyRoots) {
          if (Object.prototype.hasOwnProperty.call(value, field)) {
            errors.push({
              code: 'legacySceneObjectRoot',
              path: field,
              message: `canonical 场景禁止顶层 ${field}；对象只能存放在 layers[].objects[]`
            });
          }
        }
        return { ok: errors.length === 0, errors };
      }
    }
  ]);
  return new CanonicalCandidatePipeline({
    contentValidator,
    ruleValidator: createRepositoryRuleValidator(contentValidator)
  });
}

export default CanonicalSceneValidator;
