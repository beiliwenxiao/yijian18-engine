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
 * verify-triggers-branch-validation.mjs —— triggers branch 校验修复的离线验证。
 *
 * 场景：M1/M3.5 触发器用 branch 分支容器（{branch:[{do:[...]}], when}），
 * CandidateRuleValidator 旧版把容器当普通条目要求 action → 启动即炸 12 个
 * missingField。修复后容器跳过 action 必填、递归校验分支内条目。
 *
 * 用法：node scripts/verify-triggers-branch-validation.mjs
 * （读工作区 project/triggers.json + 最小合法工程壳，直接跑 CandidateRuleValidator）
 */
import { createRequire } from 'module';

const require = createRequire('C:/Users/alex/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/package.json');
// 引擎 src 是纯 ESM，直接 import
const { createContentValidator } = await import('../src/core/validation/ContentSchemas.js');
const { CandidateRuleValidator } = await import('../src/core/validation/CandidateRuleValidator.js');
const { readFileSync } = await import('fs');
const { pathToFileURL } = await import('url');

const rootURL = new URL('../example/sanguo_zhangjiao/', import.meta.url);
// 解析 $ref 引用（与 CanonicalCandidatePipeline.test.js 的 loadResolvedDemoProject 同款）
const resolveRefs = value => {
  if (Array.isArray(value)) return value.map(resolveRefs);
  if (!value || typeof value !== 'object') return value;
  if (typeof value.$ref === 'string') {
    return resolveRefs(JSON.parse(readFileSync(new URL(value.$ref, rootURL), 'utf8')));
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveRefs(child)]));
};

const mainProject = JSON.parse(readFileSync(new URL('game.project.json', rootURL), 'utf8'));
const candidate = resolveRefs(mainProject);
for (const [shardField, shardPath] of Object.entries(mainProject.shards || {})) {
  candidate[shardField] = resolveRefs(JSON.parse(readFileSync(new URL(shardPath, rootURL), 'utf8')));
}

const contentValidator = createContentValidator();
const ruleValidator = new CandidateRuleValidator({ contentValidator });
let errors;
try {
  // 三阶段全跑（对齐 CanonicalCandidatePipeline.process / GameLoader 装配链）
  // —— branch 容器的 action/stepId/await 校验在 validateBusinessRules 阶段
  errors = [
    ...ruleValidator.validateSchema(candidate, 'gameProject'),
    ...ruleValidator.validateReferences(candidate),
    ...ruleValidator.validateBusinessRules(candidate, {})
  ];
} catch (error) {
  console.log('[FATAL] validation threw:', String(error).slice(0, 400));
  process.exit(1);
}

const actionErrors = errors.filter(e => /do\[\d+\]\.action/.test(String(e.path || e.field || '')));
const actionEmpty = errors.filter(e => String(e.message || '').includes('action 必须是非空字符串'));
console.log(`[RESULT] total errors=${errors.length}, do[].action errors=${actionErrors.length}, "action 必须是非空字符串"=${actionEmpty.length}`);
for (const e of actionEmpty.slice(0, 20)) console.log('  -', e.path || e.field, '::', e.message);
if (errors.length > 0) {
  console.log('[DETAIL] 其余错误（非 action 类）:');
  for (const e of errors.filter(x => !actionEmpty.includes(x)).slice(0, 30)) {
    console.log('  -', e.path || e.field, '::', String(e.message).slice(0, 120));
  }
}
console.log('[VERDICT]', actionEmpty.length === 0 ? 'PASS —— branch 容器不再被误报 action 缺失' : 'FAIL —— 仍有 action 误报');
