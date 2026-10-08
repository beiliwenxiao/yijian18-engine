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

export const ContentPhase = Object.freeze({
  READ: 'read',
  PARSE: 'parse',
  DEFAULTS: 'defaults',
  SCHEMA: 'schema',
  REFERENCE: 'reference',
  BUSINESS_RULE: 'businessRule',
  CANONICALIZE: 'canonicalize'
});

export const ContentErrorCategory = Object.freeze({
  MISSING: 'missing',
  UNREADABLE: 'unreadable',
  PARSE_FAILED: 'parseFailed',
  SCHEMA_FAILED: 'schemaFailed',
  REFERENCE_FAILED: 'referenceFailed',
  BUSINESS_RULE_FAILED: 'businessRuleFailed',
  CANONICALIZE_FAILED: 'canonicalizeFailed'
});

const CATEGORY_BY_PHASE = Object.freeze({
  [ContentPhase.READ]: ContentErrorCategory.UNREADABLE,
  [ContentPhase.PARSE]: ContentErrorCategory.PARSE_FAILED,
  [ContentPhase.DEFAULTS]: ContentErrorCategory.SCHEMA_FAILED,
  [ContentPhase.SCHEMA]: ContentErrorCategory.SCHEMA_FAILED,
  [ContentPhase.REFERENCE]: ContentErrorCategory.REFERENCE_FAILED,
  [ContentPhase.BUSINESS_RULE]: ContentErrorCategory.BUSINESS_RULE_FAILED,
  [ContentPhase.CANONICALIZE]: ContentErrorCategory.CANONICALIZE_FAILED
});

export function normalizeContentError(error, {
  phase,
  source,
  category = CATEGORY_BY_PHASE[phase],
  fallback = false
} = {}) {
  const value = error && typeof error === 'object' ? error : { message: String(error) };
  return {
    ...value,
    phase: value.phase || phase || null,
    source: value.source || value.resource || source || '<memory>',
    category: value.category || category || null,
    path: typeof value.path === 'string' ? value.path : '',
    line: Number.isInteger(value.line) ? value.line : null,
    column: Number.isInteger(value.column) ? value.column : null,
    fallback: value.fallback === true || fallback === true
  };
}

export function createContentOperationResult({
  ok,
  value = null,
  errors = [],
  phase = null,
  source = '<memory>',
  category = null,
  fallback = false,
  canonical = false,
  saveable = false,
  committed = false
}) {
  const normalizedErrors = errors.map(error => normalizeContentError(error, {
    phase,
    source,
    category,
    fallback
  }));
  const firstError = normalizedErrors[0] || null;
  return {
    ok: Boolean(ok),
    committed: Boolean(committed),
    value,
    errors: normalizedErrors,
    phase: firstError?.phase || phase,
    source: firstError?.source || source,
    category: firstError?.category || category,
    path: firstError?.path || '',
    line: firstError?.line ?? null,
    column: firstError?.column ?? null,
    fallback: Boolean(fallback),
    canonical: Boolean(canonical),
    saveable: Boolean(saveable)
  };
}

export function createBlankCanonicalTemplate(schemaId, schemaVersion) {
  return Object.freeze({
    schemaId,
    schemaVersion,
    canonical: false,
    saveable: false,
    hasProjectContent: false,
    value: null
  });
}
