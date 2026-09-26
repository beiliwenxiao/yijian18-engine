import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const RESPONSIBILITIES = new Set(['assembly', 'businessLogic', 'presentation', 'editorInteraction', 'platformInfra']);
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs']);
const BLOCKED_SEGMENTS = [
  'node_modules', 'test', 'tests', 'fixture', 'fixtures', 'vendor', 'third_party',
  'third-party', 'generated', 'dist', 'build', 'desktop', 'mobile', 'assets', 'saves'
];
const runtimeRoots = ['src/', 'editor/', 'example/sanguo_zhangjiao/', 'weapp/', 'scripts/'];
const toolRoots = new Set(['index.html', 'vite.config.js', 'example/sanguo_zhangjiao/vite.config.js', 'weapp/build.js']);
const join = (...parts) => parts.join('');
const expression = parts => new RegExp(join(...parts), 'g');

function normalizePath(file) {
  return file.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function countPhysicalLines(source) {
  return source.split(/\r\n|\r|\n/).length;
}

function sourceHash(source) {
  return crypto.createHash('sha256').update(source).digest('hex');
}

function lineAt(source, index) {
  return countPhysicalLines(source.slice(0, index));
}

function trackedPaths(root) {
  const result = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'buffer' });
  if (result.status !== 0) {
    throw new Error(`Unable to enumerate tracked files: ${result.stderr?.toString('utf8').trim() || 'git ls-files failed'}`);
  }
  return result.stdout.toString('utf8').split('\0').filter(Boolean).map(normalizePath);
}

export function exclusionReason(file) {
  const normalized = normalizePath(file);
  const lower = normalized.toLowerCase();
  if (normalized.startsWith('.git/')) return 'git metadata';
  if (normalized.startsWith('src/dev/')) return 'dev tooling source';
  if (lower.endsWith('.test.js') || lower.endsWith('.spec.js')) return 'test source';
  if (lower.endsWith('.json')) return 'JSON/data configuration';
  if (!SOURCE_EXTENSIONS.has(path.posix.extname(lower)) && !lower.endsWith('.html')) return 'not a JavaScript, MJS, or HTML file';
  if (BLOCKED_SEGMENTS.some(segment => lower.split('/').includes(segment))) return 'excluded test, fixture, third-party, generated, build, desktop, mobile, or data artifact';
  if (lower.includes('/data/') || lower.includes('/config/')) return 'data/configuration source';
  if (!runtimeRoots.some(root => normalized.startsWith(root)) && !toolRoots.has(normalized)) return 'outside runtime/editor/dev-release execution roots';
  return null;
}

/**
 * 引擎平台基础设施判定：与真实环境（DOM/挂钟/网络/存储）打交道的边界层。
 * 这些模块对 DOM 与挂钟的使用是其职责本身，不适用业务边界规则。
 */
function isPlatformInfrastructure(normalized, basename) {
  if (normalized.startsWith('src/network/')) return true;
  if (normalized.startsWith('src/core/input/')) return true;
  if (normalized.startsWith('src/core/snapshot/')) return true;
  if (normalized.startsWith('weapp/adapter/')) return true;
  return normalized.startsWith('src/core/')
    && /^(?:Audio|Gamepad|Input|Logger|Error|Performance|Debug|CanvasDisplay|EventJournal|Asset|Placeholder|Platform|Presentation|IndexedDB|GameEngine|RNG)/.test(basename);
}

function responsibilityFor(file) {
  const normalized = normalizePath(file);
  const basename = path.posix.basename(normalized);
  if (normalized.startsWith('editor/')) {
    return { responsibility: 'editorInteraction', evidence: 'editor interaction path' };
  }
  if (normalized.startsWith('src/ui/') || normalized.startsWith('src/rendering/') || basename === 'BaseGameSceneSetup.js' || /(?:Renderer|Render|View|Hud|Presenter|Updater|Panel|Tooltip|Overlay|Feedback|Canvas|Presentation|Layout)\.js$/.test(basename)) {
    return { responsibility: 'presentation', evidence: basename === 'BaseGameSceneSetup.js'
      ? 'scene canvas/presentation setup filename'
      : 'presentation path or rendering/view filename' };
  }
  if (normalized.endsWith('.html')) return { responsibility: 'assembly', evidence: 'HTML entrypoint script' };
  if (isPlatformInfrastructure(normalized, basename)) {
    return { responsibility: 'platformInfra', evidence: 'engine platform infrastructure (DOM/clock/network/storage boundary)' };
  }
  if (normalized.endsWith('vite.config.js') || normalized.startsWith('scripts/') || normalized === 'src/main.js' || /(?:Assembler|Container|Runtime|Pipeline|Context|Lifecycle)\.js$/.test(basename)) {
    return { responsibility: 'assembly', evidence: 'entrypoint, tool, or lifecycle composition filename' };
  }
  return { responsibility: 'businessLogic', evidence: 'runtime domain/default module path' };
}

function inlineScriptUnits(file, html) {
  const units = [];
  const externalScripts = [];
  const tagPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  let index = 0;
  while ((match = tagPattern.exec(html))) {
    index += 1;
    const attributes = match[1] || '';
    const source = match[2] || '';
    const startLine = lineAt(html, match.index) + 1;
    if (/\bsrc\s*=/.test(attributes)) {
      externalScripts.push({ script: index, reason: 'external script executes its separately audited JS/MJS module' });
      continue;
    }
    if (!source.trim()) {
      externalScripts.push({ script: index, reason: 'empty inline script has no executable unit' });
      continue;
    }
    units.push({
      file: `${file}#script:${index}`,
      parentFile: file,
      source,
      physicalLines: countPhysicalLines(source),
      sourceHash: sourceHash(source),
      startLine,
      ...responsibilityFor(file)
    });
  }
  return { units, externalScripts };
}

function makeViolation(unit, code, message, source, match) {
  return {
    file: unit.file,
    responsibility: unit.responsibility,
    code,
    message,
    line: match ? unit.startLine + lineAt(source, match.index) - 1 : null
  };
}

/**
 * 剥离注释但保留换行结构：行号映射不变，注释里的示例代码不再触发规则。
 * 启发式：行注释要求前一个字符不是引号/冒号/反斜杠，避免吞掉字符串里的 URL。
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (match, lead) => lead + ' '.repeat(match.length - lead.length));
}

/** 时钟/RNG 的"值位置"判定：作为注入默认值或兜底表达式（=>、||、??、三元）出现时不计违规。 */
function isInValuePosition(source, index) {
  const lineStart = source.lastIndexOf('\n', index) + 1;
  const prefix = source.slice(lineStart, index);
  return /(?:=>|\|\||\?\?)\s*$/.test(prefix) || /\?[^?\n]*:\s*$/.test(prefix);
}

function policyPatterns() {
  const scene = join('scene', 'Id');
  const content = join('con', 'tent');
  const date = join('Da', 'te');
  const mathRandom = join('Math', '\\.', 'random');
  return {
    contentHandler: expression(['\\b(?:function|class|const|let|var)\\s+(?:(?:S\\d{2})\\w*|(?:', scene, '|', content, ')\\w*(?:Handler|Action))\\b']),
    contentBranchIf: expression(['\\bif\\s*\\([^)]*(?:', scene, '|\\bstage\\b|', content, 'Id\\b)[^)]*(?:===|!==|==|!=)\\s*[\'"`]']),
    contentBranchSwitch: expression(['\\bswitch\\s*\\([^)]*(?:', scene, '|\\bstage\\b|', content, 'Id\\b)[^)]*\\)\\s*\\{[\\s\\S]{0,300}?\\bcase\\s*[\'"`]']),
    timer: expression(['\\b(?:set', 'Timeout|set', 'Interval)\\s*\\(']),
    callback: expression(['\\b(?:story|dialogue|scene)\\w*[^\\n]{0,80}\\bcallback\\b']),
    dynamicModule: expression(['(?<![\\w$.])(?:import|require)\\s*\\(\\s*[^\\s\"\'`][^)]*\\)(?!\\s*\\{)']),
    onlineBranch: expression(['\\bif\\s*\\(\\s*online\\s*\\)']),
    directClockOrRandom: expression(['\\b(?:', date, '\\s*\\.\\s*now|new\\s+', date, '|', mathRandom, ')']),
    domOrCanvas: expression(['\\b(?:docu', 'ment|window|HTMLCanvasElement|OffscreenCanvas)\\b|\\.getContext\\s*\\(']),
    stateWrite: expression(['\\b(?:inventory|quest|story|stats|equipment|serviceState|runtimeState)\\s*(?:\\.[A-Za-z_$][\\w$]*|\\[[^\\]]+\\])\\s*(?:=|\\+=|-=|\\+\\+|--)']),
    singleton: expression(['\\b(?:Singleton|Service', 'Locator)\\b|\\bgetInstance\\s*\\(\\s*\\)']),
    clientStateSubmit: expression(['\\b(?:submit|send|sync|commit)\\w*\\s*\\([^)]*(?:clientState|fullState|wholeState|stateSnapshot)'])
  };
}

function applyPolicy(unit) {
  const source = stripComments(unit.source);
  const patterns = policyPatterns();
  const findings = [];
  const isBusinessLogic = unit.responsibility === 'businessLogic';
  // 首个"通过谓词"的命中（而非无条件首个命中）：避免前文误报屏蔽同文件后文的真违规
  const check = (pattern, code, message, predicate = () => true) => {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      if (predicate(match)) {
        findings.push(makeViolation(unit, code, message, source, match));
        return;
      }
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
    }
  };

  check(patterns.contentHandler, 'content-named-handler', 'Content- or SXX-named handlers are forbidden.');
  // typeof 守卫（typeof sceneId !== 'string'）是类型检查而非内容分支，剔除
  check(patterns.contentBranchIf, 'content-flow-branch', 'scene/stage/content control-flow branches are forbidden.', match => (
    isBusinessLogic && !/\btypeof\b/.test(match[0])
  ));
  check(patterns.contentBranchSwitch, 'content-flow-branch', 'scene/stage/content control-flow branches are forbidden.', () => isBusinessLogic);
  check(patterns.timer, 'story-timer', 'Direct timers are forbidden in audited execution units.', match => (
    isBusinessLogic && source.slice(0, match.index).trimEnd().at(-1) !== '.'
  ));
  check(patterns.callback, 'story-callback', 'Story, dialogue, or scene callbacks are forbidden.');
  check(patterns.dynamicModule, 'arbitrary-module-path', 'Dynamic module paths must not be executable content.');
  check(patterns.onlineBranch, 'business-online-branch', 'Business code must not branch on online state.');
  check(patterns.singleton, 'singleton-or-service-locator', 'Singleton and service locator access are forbidden.');
  check(patterns.clientStateSubmit, 'whole-client-state-submit', 'Whole client-state submission is forbidden.');
  check(patterns.directClockOrRandom, 'direct-business-clock-or-random', 'Business logic must use injected clocks and authority RNG.', match => (
    isBusinessLogic && !isInValuePosition(source, match.index)
  ));

  if (unit.responsibility === 'assembly') {
    check(patterns.domOrCanvas, 'assembly-presentation-overreach', 'Assembly may not access DOM or Canvas APIs.');
    check(patterns.stateWrite, 'assembly-business-overreach', 'Assembly may not mutate service-owned business state.');
  }
  if (unit.responsibility === 'businessLogic') {
    check(patterns.domOrCanvas, 'business-dom-or-canvas-access', 'Business logic may not access DOM or Canvas APIs.');
  }
  if (unit.responsibility === 'presentation') {
    check(patterns.stateWrite, 'presentation-business-state-write', 'Presentation may not write service-owned business state.');
  }
  if (unit.responsibility === 'editorInteraction') {
    check(patterns.stateWrite, 'editor-business-state-write', 'Editor interaction may not write service-owned state.');
    const directSave = /\bfetch\s*\(\s*['"][^'"]*\/api\/canonical[^'"]*['"]/.exec(source)
      || (() => {
        const match = /\bfetch\s*\(\s*['"][^'"]*\/api\/save-file[^'"]*['"]/.exec(source);
        // 唯一允许的 interaction 直写是编辑器自身模板；canonical 项目/场景永远经 command service。
        return match && !source.slice(match.index, match.index + 600).includes("editor/config/scene-templates.json")
          ? match
          : null;
      })();
    if (directSave) findings.push(makeViolation(unit, 'editor-command-service-bypass', 'Editor interaction must delegate canonical persistence through a command service.', source, directSave));
  }
  return findings;
}

function normalizedExceptions(manifest) {
  if (!manifest) return [];
  if (!Array.isArray(manifest.exceptions)) throw new Error('Audit exception manifest must contain an exceptions array.');
  return manifest.exceptions;
}

function validateException(unit, exception) {
  const required = ['evidence', 'lines', 'responsibility', 'owner', 'date', 'contentHash'];
  const missing = required.filter(key => exception[key] === undefined || exception[key] === null || exception[key] === '');
  const validResponsibility = RESPONSIBILITIES.has(exception.responsibility);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(exception.date || '');
  const exactLines = exception.lines === unit.physicalLines;
  const exactHash = exception.contentHash === unit.sourceHash;
  const responsibilityMatches = exception.responsibility === unit.responsibility;
  // codes 可选：列出本例外豁免的违规代码；未提供时仅豁免行数超限（向后兼容）
  const validCodes = exception.codes === undefined
    || (Array.isArray(exception.codes) && exception.codes.every(code => typeof code === 'string' && code));
  const valid = missing.length === 0 && validResponsibility && validDate && exactLines && exactHash && responsibilityMatches && validCodes;
  return {
    status: valid ? 'valid' : 'invalid',
    valid,
    evidence: exception.evidence || null,
    owner: exception.owner || null,
    date: exception.date || null,
    declaredLines: exception.lines ?? null,
    declaredResponsibility: exception.responsibility || null,
    declaredHash: exception.contentHash || null,
    declaredCodes: exception.codes ?? null,
    reasons: [
      ...(missing.length ? [`missing fields: ${missing.join(', ')}`] : []),
      ...(!validResponsibility ? ['responsibility is not one of the four permitted values'] : []),
      ...(!validDate ? ['date must use YYYY-MM-DD'] : []),
      ...(!exactLines ? ['physical line count changed; exception requires reapproval'] : []),
      ...(!exactHash ? ['content hash changed; exception requires reapproval'] : []),
      ...(!responsibilityMatches ? ['declared responsibility differs from audited responsibility'] : []),
      ...(!validCodes ? ['codes must be an array of non-empty violation code strings'] : [])
    ]
  };
}

export function auditTrackedJavaScript({ root = process.cwd(), paths, readFile, exceptionManifest } = {}) {
  const candidates = (paths || trackedPaths(root)).map(normalizePath).sort();
  const read = readFile || (file => fs.readFileSync(path.join(root, file), 'utf8'));
  const exceptions = normalizedExceptions(exceptionManifest);
  const included = [];
  const excluded = [];
  const unreadable = [];
  const units = [];

  for (const file of candidates) {
    const reason = exclusionReason(file);
    if (reason) {
      excluded.push({ file, reason });
      continue;
    }
    let source;
    try {
      source = read(file);
    } catch (error) {
      const responsibility = responsibilityFor(file);
      included.push({ file, reason: 'tracked executable source is unavailable in the working tree' });
      unreadable.push({
        file,
        responsibility: responsibility.responsibility,
        code: 'tracked-executable-unreadable',
        message: `Tracked executable source could not be read: ${error.code || error.message}`,
        line: null
      });
      continue;
    }
    if (file.toLowerCase().endsWith('.html')) {
      const scripts = inlineScriptUnits(file, source);
      included.push({ file, reason: 'tracked HTML entrypoint; inline scripts are executable units', externalScripts: scripts.externalScripts });
      units.push(...scripts.units);
      continue;
    }
    const responsibility = responsibilityFor(file);
    const unit = {
      file,
      source,
      physicalLines: countPhysicalLines(source),
      sourceHash: sourceHash(source),
      startLine: 1,
      ...responsibility
    };
    included.push({ file, reason: 'tracked runtime/editor/dev-release executable source' });
    units.push(unit);
  }

  const violations = [...unreadable];
  const reportUnits = units.map(unit => {
    const exception = exceptions.find(entry => normalizePath(entry.file || '') === unit.file);
    const exceptionStatus = exception ? validateException(unit, exception) : { status: 'none', valid: false, reasons: [] };
    const findings = applyPolicy(unit);
    // codes 语义：有效例外列出 codes 时按码豁免（findings+行数）；未列 codes 时仅豁免行数超限
    const exemptCodes = exceptionStatus.valid && Array.isArray(exception?.codes)
      ? new Set(exception.codes)
      : null;
    const lineLimitExempt = exceptionStatus.valid && (!exemptCodes || exemptCodes.has('line-limit-or-invalid-exception'));
    if (unit.physicalLines < 1) violations.push(makeViolation(unit, 'empty-executable-unit', 'Executable units must contain 1–1000 physical lines.', unit.source));
    if (unit.physicalLines > 1000 && !lineLimitExempt) {
      violations.push(makeViolation(unit, 'line-limit-or-invalid-exception', 'Units over 1000 lines require a valid external-contract exception.', unit.source));
    }
    violations.push(...(exemptCodes
      ? findings.filter(finding => !exemptCodes.has(finding.code))
      : findings));
    return {
      file: unit.file,
      parentFile: unit.parentFile || null,
      physicalLines: unit.physicalLines,
      responsibility: unit.responsibility,
      responsibilityEvidence: unit.evidence,
      contentHash: unit.sourceHash,
      exception: exceptionStatus,
      violations: findings
    };
  });

  return {
    policyVersion: 2,
    trackedPathCount: candidates.length,
    included,
    excluded,
    units: reportUnits,
    violations,
    ok: violations.length === 0
  };
}

/** 创建审计范围内每个可执行单元的稳定内容哈希快照。 */
export function createJavaScriptAuditSnapshot(options = {}) {
  const report = auditTrackedJavaScript(options);
  const hashes = Object.fromEntries(report.units
    .map(unit => [unit.file, unit.contentHash])
    .sort(([left], [right]) => left.localeCompare(right)));
  return Object.freeze({
    policyVersion: report.policyVersion,
    hashes: Object.freeze(hashes),
    unitCount: report.units.length,
    auditOk: report.ok
  });
}

/** 比较两个审计快照；新增、删除和内容变更均计为可执行 JavaScript 差异。 */
export function compareJavaScriptAuditSnapshots(before, after) {
  if (!before?.hashes || !after?.hashes) throw new TypeError('JavaScript audit snapshots require hashes');
  const files = [...new Set([...Object.keys(before.hashes), ...Object.keys(after.hashes)])].sort();
  const changes = files.flatMap(file => {
    const beforeHash = before.hashes[file] || null;
    const afterHash = after.hashes[file] || null;
    if (beforeHash === afterHash) return [];
    return [{
      file,
      kind: beforeHash === null ? 'added' : (afterHash === null ? 'removed' : 'changed'),
      beforeHash,
      afterHash
    }];
  });
  return Object.freeze({
    beforeUnitCount: before.unitCount,
    afterUnitCount: after.unitCount,
    changes: Object.freeze(changes),
    changeCount: changes.length,
    equal: changes.length === 0
  });
}

export function readExceptionManifest(root, manifestPath = 'src/dev/javascript-audit-exceptions.json') {
  const absolutePath = path.join(root, manifestPath);
  if (!fs.existsSync(absolutePath)) return { exceptions: [] };
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}
