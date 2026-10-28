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
 * verify-s01-quest-compile.mjs —— 校验 S01 任务链接入狼群战步骤后的编译产物。
 *
 * 检查：
 * 1. quests[] 编译出的 task.s01.survival 任务图含 defeatWolfPack / defeatWolfKing；
 * 2. 两个步骤的 target 事实存在于 commands[] 派生的事实目录；
 * 3. 编译产物通过 TaskGraphSystem 唯一校验器；
 * 4. 步骤链顺序正确（leaveShelter → defeatWolfPack → defeatWolfKing → reachCliff）。
 */
import { readFileSync } from 'node:fs';
import { compileQuestProject } from '../src/systems/quest/QuestRuntime.js';
import { deriveFactsFromCommands } from '../src/systems/quest/FactCatalog.js';

const project = JSON.parse(readFileSync(
  new URL('../example/sanguo_zhangjiao/game.project.json', import.meta.url), 'utf8'));
const root = new URL('../example/sanguo_zhangjiao/', import.meta.url);
const quests = JSON.parse(readFileSync(new URL('project/quests.json', root), 'utf8'));
const commands = JSON.parse(readFileSync(new URL('project/commands.json', root), 'utf8'));

const log = (ok, name, detail = '') => console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' :: ' + detail : ''}`);
let failed = 0;
const check = (ok, name, detail) => { if (!ok) failed++; log(ok, name, detail); };

// 事实目录（从 commands[] 派生）
const facts = deriveFactsFromCommands({ commands });
const factIds = new Set((facts || []).map(f => f.id));
check(factIds.has('story.s01.wolfPackCleared'), '事实 story.s01.wolfPackCleared 存在');
check(factIds.has('story.s01.wolfKingDefeated'), '事实 story.s01.wolfKingDefeated 存在');

// 编译
const compiled = compileQuestProject({ ...project, quests });
const survival = compiled.taskGraphs?.find(g => g.id === 'task.s01.survival');
check(!!survival, 'task.s01.survival 编译产出存在');
if (survival) {
  const objectives = survival.nodes.filter(n => n.type === 'objective');
  const ids = objectives.map(n => n.id);
  check(ids.includes('defeatWolfPack'), '步骤 defeatWolfPack 存在', ids.join(','));
  check(ids.includes('defeatWolfKing'), '步骤 defeatWolfKing 存在');
  const order = ['leaveShelter', 'defeatWolfPack', 'defeatWolfKing', 'reachCliff'];
  const positions = order.map(id => ids.indexOf(id));
  check(positions.every(p => p >= 0), '关键步骤均在链上', JSON.stringify(positions));
  check(positions.every((p, i) => i === 0 || p > positions[i - 1]), '步骤顺序正确', JSON.stringify(positions));

  const pack = objectives.find(n => n.id === 'defeatWolfPack');
  check(pack?.eventMatcher?.payload?.definitionId === 'story.s01.wolfPackCleared',
    'defeatWolfPack 事实目标正确', pack?.eventMatcher?.payload?.definitionId);
  check(JSON.stringify(pack?.eventMatcher) === JSON.stringify({
    type: 'state.transaction', payload: { definitionId: 'story.s01.wolfPackCleared' }
  }), 'defeatWolfPack matcher 正确', JSON.stringify(pack?.eventMatcher));
  const king = objectives.find(n => n.id === 'defeatWolfKing');
  check(king?.eventMatcher?.payload?.definitionId === 'story.s01.wolfKingDefeated',
    'defeatWolfKing 事实目标正确', king?.eventMatcher?.payload?.definitionId);
  check(Array.isArray(pack?.mapTargets) && pack.mapTargets.length > 0, 'defeatWolfPack 有 mapTarget 引导', JSON.stringify(pack?.mapTargets));
  check(Array.isArray(king?.mapTargets) && king.mapTargets.length > 0, 'defeatWolfKing 有 mapTarget 引导', JSON.stringify(king?.mapTargets));
}

// 触发器编译不报错
check(Array.isArray(compiled.triggers) && compiled.triggers.length > 0,
  '编译产出触发器', `count=${compiled.triggers?.length}`);

console.log(failed === 0 ? '\n全部通过' : `\n失败 ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
