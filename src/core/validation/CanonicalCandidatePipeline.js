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
import { CanonicalSnapshot } from '../CanonicalSnapshot.js';
import { DefinitionRepository, DefinitionRepositoryValidationError } from '../DefinitionRepository.js';
import { CandidateRuleValidator } from './CandidateRuleValidator.js';
import {
  ContentErrorCategory,
  ContentPhase,
  createBlankCanonicalTemplate,
  createContentOperationResult,
  normalizeContentError
} from './ContentOperationResult.js';

function uniqueErrors(errors) {
  const seen = new Set();
  return errors.filter(error => {
    const key = `${error.phase}|${error.code}|${error.path}|${error.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Canonical 候选固定管线：read → parse → defaults clone → schema → reference
 * → businessRule → canonicalize。管线不发布状态，调用方只可在 ok 后提交结果。
 */
export class CanonicalCandidatePipeline {
  constructor({ contentValidator, ruleValidator = null } = {}) {
    if (!contentValidator) throw new TypeError('CanonicalCandidatePipeline requires contentValidator');
    this.contentValidator = contentValidator;
    this.ruleValidator = ruleValidator || new CandidateRuleValidator({ contentValidator });
  }

  createBlankTemplate(schemaId = 'gameProject') {
    return createBlankCanonicalTemplate(schemaId, CANONICAL_SCHEMA_VERSION);
  }

  processToSnapshot(input, {
    revision = 1,
    lastSuccessfulSnapshot = null,
    buildShadow = null,
    repositoryOptions = {},
    ...pipelineOptions
  } = {}) {
    const result = this.process(input, {
      ...pipelineOptions,
      lastSuccessfulValue: lastSuccessfulSnapshot?.project || pipelineOptions.lastSuccessfulValue || null
    });
    if (!result.ok) {
      return {
        ...result,
        value: lastSuccessfulSnapshot,
        snapshot: lastSuccessfulSnapshot,
        repository: null,
        runtimeConfig: lastSuccessfulSnapshot?.runtimeConfig || null,
        draft: null
      };
    }

    try {
      const snapshot = CanonicalSnapshot.fromProject(result.value, { revision });
      const repository = DefinitionRepository.fromSnapshot(snapshot, repositoryOptions);
      const draft = typeof buildShadow === 'function'
        ? buildShadow({ snapshot, repository, runtimeConfig: snapshot.runtimeConfig })
        : null;
      return {
        ...result,
        value: snapshot,
        project: snapshot.project,
        snapshot,
        repository,
        runtimeConfig: snapshot.runtimeConfig,
        draft
      };
    } catch (error) {
      const errors = error instanceof DefinitionRepositoryValidationError
        ? error.errors
        : (Array.isArray(error?.errors) && error.errors.length > 0
          ? error.errors
          : [{ code: 'shadowBuildFailed', path: '', message: String(error?.message || error) }]);
      return createContentOperationResult({
        ok: false,
        value: lastSuccessfulSnapshot,
        errors,
        phase: ContentPhase.BUSINESS_RULE,
        source: pipelineOptions.source || '<memory>',
        category: ContentErrorCategory.BUSINESS_RULE_FAILED
      });
    }
  }

  process(input, {
    schemaId = 'gameProject',
    source = '<memory>',
    reader = null,
    lastSuccessfulValue = null,
    context = {},
    trace = null
  } = {}) {
    const record = (phase, detail = {}) => trace?.({ phase, ...detail });
    let raw;

    record(ContentPhase.READ, { status: 'start' });
    try {
      raw = typeof reader === 'function' ? reader(input) : input;
      if (raw === undefined || raw === null) {
        const error = normalizeContentError({
          code: 'missing',
          path: '',
          message: `canonical 来源不存在: ${source}`
        }, {
          phase: ContentPhase.READ,
          source,
          category: ContentErrorCategory.MISSING
        });
        record(ContentPhase.READ, { status: 'failed' });
        return createContentOperationResult({
          ok: false,
          value: lastSuccessfulValue,
          errors: [error],
          phase: ContentPhase.READ,
          source,
          category: ContentErrorCategory.MISSING
        });
      }
      record(ContentPhase.READ, { status: 'complete' });
    } catch (error) {
      record(ContentPhase.READ, { status: 'failed' });
      return createContentOperationResult({
        ok: false,
        value: lastSuccessfulValue,
        errors: [{ code: 'unreadable', path: '', message: String(error?.message || error) }],
        phase: ContentPhase.READ,
        source,
        category: ContentErrorCategory.UNREADABLE
      });
    }

    record(ContentPhase.PARSE, { status: 'start' });
    let parsed = raw;
    if (typeof raw === 'string') {
      const result = this.contentValidator.parseJson(raw);
      if (!result.ok) {
        record(ContentPhase.PARSE, { status: 'failed' });
        return createContentOperationResult({
          ok: false,
          value: lastSuccessfulValue,
          errors: result.errors,
          phase: ContentPhase.PARSE,
          source,
          category: ContentErrorCategory.PARSE_FAILED
        });
      }
      parsed = result.value;
    }
    record(ContentPhase.PARSE, { status: 'complete' });

    record(ContentPhase.DEFAULTS, { status: 'start' });
    let candidate;
    try {
      candidate = this.contentValidator.applyDefaults(parsed, schemaId);
      record(ContentPhase.DEFAULTS, { status: 'complete' });
    } catch (error) {
      record(ContentPhase.DEFAULTS, { status: 'failed' });
      return createContentOperationResult({
        ok: false,
        value: lastSuccessfulValue,
        errors: [{ code: 'defaultsFailed', path: '', message: String(error?.message || error) }],
        phase: ContentPhase.DEFAULTS,
        source,
        category: ContentErrorCategory.SCHEMA_FAILED
      });
    }

    const errors = [];
    const collect = (phase, category, validator) => {
      record(phase, { status: 'start' });
      try {
        const phaseErrors = validator() || [];
        errors.push(...phaseErrors.map(error => normalizeContentError(error, { phase, source, category })));
        record(phase, { status: phaseErrors.length > 0 ? 'failed' : 'complete', errorCount: phaseErrors.length });
      } catch (error) {
        errors.push(normalizeContentError({ code: `${phase}ValidationFailed`, path: '', message: String(error?.message || error) }, { phase, source, category }));
        record(phase, { status: 'failed', errorCount: 1 });
      }
    };

    collect(ContentPhase.SCHEMA, ContentErrorCategory.SCHEMA_FAILED,
      () => this.ruleValidator.validateSchema(candidate, schemaId));
    collect(ContentPhase.REFERENCE, ContentErrorCategory.REFERENCE_FAILED,
      () => this.ruleValidator.validateReferences(candidate));
    collect(ContentPhase.BUSINESS_RULE, ContentErrorCategory.BUSINESS_RULE_FAILED,
      () => this.ruleValidator.validateBusinessRules(candidate, context));

    const allErrors = uniqueErrors(errors);
    if (allErrors.length > 0) {
      return createContentOperationResult({
        ok: false,
        value: lastSuccessfulValue,
        errors: allErrors,
        source
      });
    }

    record(ContentPhase.CANONICALIZE, { status: 'start' });
    try {
      const value = this.contentValidator.canonicalize(candidate, schemaId);
      record(ContentPhase.CANONICALIZE, { status: 'complete' });
      return createContentOperationResult({
        ok: true,
        value,
        errors: [],
        phase: ContentPhase.CANONICALIZE,
        source,
        canonical: true,
        saveable: true
      });
    } catch (error) {
      record(ContentPhase.CANONICALIZE, { status: 'failed' });
      return createContentOperationResult({
        ok: false,
        value: lastSuccessfulValue,
        errors: [{ code: 'canonicalizeFailed', path: '', message: String(error?.message || error) }],
        phase: ContentPhase.CANONICALIZE,
        source,
        category: ContentErrorCategory.CANONICALIZE_FAILED
      });
    }
  }
}

export default CanonicalCandidatePipeline;
