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

import {
  auditTrackedJavaScript,
  compareJavaScriptAuditSnapshots,
  createJavaScriptAuditSnapshot
} from './JavaScriptAuditGate.js';

const DEFAULT_CONTENT_ROOT = 'example/sanguo_zhangjiao/';
const normalizePath = value => String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');

const FORBIDDEN_CONTENT_PATTERNS = Object.freeze([
  ['content-flow-branch', /\b(?:if|switch)\s*\([^)]*\b(?:sceneId|contentId|field(?:Path|Id|Name)?|itemId)\b[^)]*\)/],
  ['content-named-handler', /\b(?:function|class|const|let|var)\s+(?:S\d{2}[A-Za-z0-9_]*|[A-Za-z_$][\w$]*(?:Content|Scene|Item)(?:Handler|Action))\b/],
  ['content-subclass', /\bclass\s+(?:S\d{2}[A-Za-z0-9_]*|[A-Za-z_$][\w$]*(?:Potion|Sword|Item|Content))\s+extends\s+\w+/],
  ['scene-timer', /\b(?:setTimeout|setInterval)\s*\(/],
  ['scene-callback', /\b(?:scene|story|dialogue)\w*callback\b/i],
  ['item-id-special-strategy', /\b(?:if|switch)\s*\([^)]*\bitemId\b[^)]*['"][^'"]+['"][^)]*\)/]
]);

function defaultRegisteredResource(path, registeredResourcePaths) {
  return registeredResourcePaths.has(path);
}

function canonicalJsonPath(path, contentRoot) {
  return path.startsWith(contentRoot) && path.endsWith('.json');
}

function sourceViolations(executableSources = []) {
  return executableSources.flatMap(({ file, source }) => {
    const normalized = normalizePath(file);
    const text = String(source || '');
    return FORBIDDEN_CONTENT_PATTERNS.flatMap(([code, pattern]) => pattern.test(text)
      ? [{ file: normalized, code }]
      : []);
  });
}

/**
 * 为 schema/capability/ActionDescriptor 已可表达的内容变更提供 JSON-only 门禁。
 * 它复用 JavaScriptAuditGate 的审计范围和分类，不建立第二套可执行源扫描范围。
 */
export class ContentExtensionGate {
  constructor({
    root = process.cwd(),
    contentRoot = DEFAULT_CONTENT_ROOT,
    audit = auditTrackedJavaScript,
    registeredResource = defaultRegisteredResource
  } = {}) {
    this.root = root;
    this.contentRoot = normalizePath(contentRoot).replace(/\/?$/, '/');
    this.audit = audit;
    this.registeredResource = registeredResource;
  }

  captureJavaScriptSnapshot(options = {}) {
    return createJavaScriptAuditSnapshot({ root: this.root, ...options });
  }

  inspect({ baseline, after, changedPaths = [], registeredResourcePaths = [], executableSources = [] } = {}) {
    const javascript = compareJavaScriptAuditSnapshots(baseline, after);
    const registered = new Set([...registeredResourcePaths].map(normalizePath));
    const contentPaths = [...new Set(changedPaths.map(normalizePath))].sort();
    const pathViolations = contentPaths.flatMap(file => {
      if (canonicalJsonPath(file, this.contentRoot)) return [];
      if (this.registeredResource(file, registered)) return [];
      return [{ file, code: 'noncanonical-content-change' }];
    });
    const sourcePolicyViolations = sourceViolations(executableSources);
    const violations = [
      ...javascript.changes.map(change => ({ ...change, code: 'executable-javascript-changed' })),
      ...pathViolations,
      ...sourcePolicyViolations
    ];
    return Object.freeze({
      ok: violations.length === 0,
      javascript,
      changedPaths: Object.freeze(contentPaths),
      violations: Object.freeze(violations)
    });
  }

  /** 运行真实 cold-restart harness，并把 canonical、状态、通知、ID 和 projection 的等价结果纳入门禁结论。 */
  async verifyRestart(harness, options = {}) {
    if (!harness || typeof harness.replay !== 'function') throw new TypeError('ContentExtensionGate requires a ColdRestartReplayHarness');
    const replay = await harness.replay(options);
    return Object.freeze({
      ok: replay.equal === true,
      replay
    });
  }
}

export function createContentExtensionGate(options = {}) {
  return new ContentExtensionGate(options);
}

export { FORBIDDEN_CONTENT_PATTERNS };
export default ContentExtensionGate;
