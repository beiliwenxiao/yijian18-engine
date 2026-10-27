/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-10-27
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

/**
 * S02 M3.5 数据审计：
 * 1) 七件 JSON + assets.json 合法性
 * 2) S02 placement ref → library 注册表（enemies/npcs/items/armies）
 * 3) S02 imageId → assets.json manifest
 * 4) triggers 引用完整性（事务/对话/教程/场景组）
 * 5) quests 目标 → commands 事务
 *
 * 用法：node scripts/audit-s02-m35.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..', 'example', 'sanguo_zhangjiao', 'project');
const SCENES = path.resolve(__dirname, '..', 'example', 'sanguo_zhangjiao', 'assets', 'scenes');
const MANIFESTS = path.resolve(__dirname, '..', 'example', 'sanguo_zhangjiao', 'assets', 'manifests');

const errors = [];
const notes = [];
const load = (dir, name) => {
    try {
        return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch (error) {
        errors.push(`JSON 解析失败: ${name}: ${error.message}`);
        return null;
    }
};

const library = load(PROJECT, 'library.json');
const triggers = load(PROJECT, 'triggers.json');
const commands = load(PROJECT, 'commands.json');
const dialogues = load(PROJECT, 'dialogues.json');
const quests = load(PROJECT, 'quests.json');
const tutorials = load(PROJECT, 'tutorials.json');
const s02 = load(SCENES, 'S02.json');
const assets = load(MANIFESTS, 'assets.json');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}

// ---- 注册表 ----
const registry = {};
for (const [key, list] of Object.entries(library)) {
    if (Array.isArray(list)) for (const def of list) if (def?.id) (registry[key] ||= new Set()).add(def.id);
}
const assetIds = new Set((assets.assets || []).map(entry => entry?.assetId).filter(Boolean));

// ---- 1) S02 placement ref 完整性 ----
const s02Groups = new Set();
const kindKey = { enemy: 'enemies', npc: 'npcs', item: 'items', soldier: 'enemies', army: 'armies' };
for (const layer of s02.layers) {
    for (const obj of layer.objects || []) {
        if (obj.group) s02Groups.add(obj.group);
        if (obj.type !== 'ref' && obj.type !== 'spawn') continue;
        if (obj.type === 'spawn') continue;
        const regKey = kindKey[obj.kind];
        if (!regKey) { errors.push(`S02 placement ${obj.id}: 未知 kind ${obj.kind}`); continue; }
        if (!registry[regKey]?.has(obj.ref)) errors.push(`S02 placement ${obj.id}: ref ${obj.ref} 不在 library.${regKey}`);
        for (const imageId of collectImageIds(obj)) {
            if (!assetIds.has(imageId)) errors.push(`S02 ${obj.id}: imageId ${imageId} 不在 manifest`);
        }
    }
}
for (const imageId of collectImageIds(s02)) {
    if (!assetIds.has(imageId)) errors.push(`S02 场景: imageId ${imageId} 不在 manifest`);
}

function collectImageIds(node, out = []) {
    if (!node || typeof node !== 'object') return out;
    if (typeof node.imageId === 'string') out.push(node.imageId);
    for (const value of Object.values(node)) if (value && typeof value === 'object') collectImageIds(value, out);
    return out;
}

// ---- 2) triggers 引用完整性 ----
const commandIds = new Set(commands.map(cmd => cmd.id));
const dialogueIds = new Set(dialogues.map(d => d.id));
const tutorialIds = new Set((tutorials.tutorials || tutorials).map?.call ? [] : []);
const tutorialList = Array.isArray(tutorials) ? tutorials : (tutorials.tutorials || []);
for (const t of tutorialList) if (t?.id) tutorialIds.add(t.id);

let transactionCount = 0;
for (const trigger of triggers) {
    const steps = flattenSteps(trigger.do || []);
    for (const step of steps) {
        const action = step.action;
        const params = step.params || {};
        if (action === 'state.transaction') {
            transactionCount++;
            if (!commandIds.has(params.definitionId)) errors.push(`${trigger.id}: 事务 ${params.definitionId} 不在 commands.json`);
        } else if (action === 'startDialogue') {
            if (!dialogueIds.has(params.id)) errors.push(`${trigger.id}: 对话 ${params.id} 不在 dialogues.json`);
        } else if (action === 'tutorial.command') {
            if (params.tutorialId && !tutorialIds.has(params.tutorialId)) errors.push(`${trigger.id}: 教程 ${params.tutorialId} 不在 tutorials.json`);
        } else if (action === 'spawnPlacements' || action === 'despawnPlacements') {
            const group = params.selector?.group;
            if (group && trigger.id.startsWith('trg_s02_') && !s02Groups.has(group)) {
                errors.push(`${trigger.id}: 场景组 ${group} 不在 S02.json`);
            }
        }
    }
}

function flattenSteps(steps, out = []) {
    for (const step of steps || []) {
        if (!step) continue;
        if (Array.isArray(step.branch)) for (const branch of step.branch) flattenSteps(branch.do, out);
        else out.push(step);
    }
    return out;
}

// ---- 3) quests 目标 → commands ----
for (const quest of quests) {
    for (const step of quest.steps || []) {
        if (step.objectiveType === 'commit.fact' && !commandIds.has(step.target)) {
            errors.push(`quest ${quest.id} step ${step.id}: 事实 ${step.target} 不在 commands.json`);
        }
    }
}

// ---- 4) 关键链路检查 ----
const triggerIds = new Set(triggers.map(t => t.id));
for (const required of ['trg_s02_farewell', 'trg_s02_recruit', 'trg_s02_camp_laid', 'trg_s02_raid_wave2', 'trg_s02_raid_repeled', 'trg_s02_raid_defeat', 'trg_s02_possession_restore']) {
    if (!triggerIds.has(required)) errors.push(`缺少触发器 ${required}`);
}
const s02CommandIds = commandIds;
for (const required of ['story.s02.porridge.laid', 'story.s02.recruit.tick', 'story.s02.recruit.done', 'story.s02.overnight.done', 'story.s02.camp.laid', 'story.s02.raid.repeled']) {
    if (!s02CommandIds.has(required)) errors.push(`缺少事务 ${required}`);
}
for (const required of ['dialogue.s02.porridgeStart', 'dialogue.s02.recruitDone', 'dialogue.s02.overnight']) {
    if (!dialogueIds.has(required)) errors.push(`缺少对话 ${required}`);
}
if (dialogueIds.has('dialogue.s02.campAlert')) notes.push('dialogue.s02.campAlert 仍存在（M3.5 已由 overnight 替代，建议为死数据）');

// ---- 结果 ----
console.log(`triggers=${triggers.length} commands=${commands.length} dialogues=${dialogues.length} quests=${quests.length} S02 groups=${s02Groups.size} manifest assets=${assetIds.size}`);
if (notes.length) console.log('[notes]\n' + notes.join('\n'));
if (errors.length) {
    console.error(`[FAIL] ${errors.length} 处引用断链:\n` + errors.join('\n'));
    process.exit(1);
}
console.log('ALL REFS OK');
