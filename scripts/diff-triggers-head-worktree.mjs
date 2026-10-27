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
 * diff-triggers-head-worktree.mjs —— HEAD vs 工作区 triggers.json 差异分析
 * （定位「action 必须是非空字符串」校验失败的改动来源：branch 分支容器引入点）。
 *
 * 用法：node scripts/diff-triggers-head-worktree.mjs
 */
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const FILE = 'example/sanguo_zhangjiao/project/triggers.json';
const stripBom = s => s.replace(/^\uFEFF/, '');
const head = JSON.parse(stripBom(execSync(`git show HEAD:${FILE}`, { maxBuffer: 64 * 1024 * 1024 }).toString('utf8')));
const work = JSON.parse(stripBom(readFileSync(FILE, 'utf8')));
const hl = head.triggers || head, wl = work.triggers || work;

const hmap = new Map(hl.map(t => [t.id, t]));
const wmap = new Map(wl.map(t => [t.id, t]));
const countBranch = t => (t.do || []).filter(d => Array.isArray(d.branch)).length;

const added = [], removed = [], changed = [];
for (const [id, t] of wmap) {
  if (!hmap.has(id)) added.push(id);
  else if (JSON.stringify(t) !== JSON.stringify(hmap.get(id))) changed.push(id);
}
for (const id of hmap.keys()) if (!wmap.has(id)) removed.push(id);

console.log(`HEAD triggers: ${hl.length} -> work: ${wl.length}`);
console.log(`added(${added.length}): ${added.join(', ')}`);
console.log(`removed(${removed.length}): ${removed.join(', ')}`);
console.log(`changed(${changed.length}): ${changed.join(', ')}`);

const hb = hl.reduce((s, t) => s + countBranch(t), 0);
const wb = wl.reduce((s, t) => s + countBranch(t), 0);
console.log(`\nbranch 容器条目总数: HEAD=${hb} -> work=${wb}`);
console.log('--- work 中含 branch 的触发器（校验失败候选） ---');
wl.forEach(t => {
  const n = countBranch(t);
  if (n > 0) {
    const origin = hmap.has(t.id)
      ? (hmap.get(t.id) === t ? '未改' : `改（HEAD 已有 branch x${countBranch(hmap.get(t.id))}）`)
      : '新增触发器';
    console.log(`  ${t.id}: branch x${n} —— ${origin}`);
  }
});
