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

import { getWorldMapCellSceneId } from '../../../src/core/WorldMapCell.js';

const CAMPAIGN_ID = 'sanguo-zhangjiao-s01-s14';
const CANONICAL_SCENE_ID = /^S(?:0[1-9]|1[0-4])(?:-C\d{2})?$/;
const LEGACY_SCENE_ID = /^(?:s\d+-\d+|scene_Prologue)$/i;
const LEGACY_ACT_VALUE = /(?:^|[_-])act\d/i;

function issue(code, path, message, actual) {
  return { code, path, message, ...(actual === undefined ? {} : { actual }) };
}

function collectLegacyFacts(value, path, errors) {
  if (typeof value === 'string') {
    if (value === 'mage') errors.push(issue('legacyContent', path, '职业 mage 已废弃，必须使用 strategist', value));
    if (LEGACY_SCENE_ID.test(value)) errors.push(issue('legacyContent', path, '旧场景 ID 不允许进入新战役', value));
    if (LEGACY_ACT_VALUE.test(value)) errors.push(issue('legacyContent', path, '旧 Act 剧情事实不允许进入新战役', value));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (key === 'act' || key === 'currentAct' || /^act\d/i.test(key)) {
      errors.push(issue('legacyContent', childPath, '旧 Act 状态字段不允许进入新战役'));
      continue;
    }
    collectLegacyFacts(child, childPath, errors);
  }
}

function collectWorldScenes(project, errors) {
  const previewScenes = new Set();
  for (const [regionIndex, region] of (project.worldMap?.regions || []).entries()) {
    const entries = [];
    for (const [rowIndex, row] of (region.grid || []).entries()) {
      for (const [colIndex, cell] of (row || []).entries()) {
        const sceneId = getWorldMapCellSceneId(cell, { includeReserved: true });
        if (sceneId) entries.push({ sceneId, path: `worldMap.regions[${regionIndex}].grid[${rowIndex}][${colIndex}]` });
      }
    }
    for (const [chunkIndex, chunk] of (region.chunks || []).entries()) {
      if (chunk?.sceneId) entries.push({ sceneId: chunk.sceneId, path: `worldMap.regions[${regionIndex}].chunks[${chunkIndex}].sceneId` });
    }
    for (const entry of entries) {
      if (!CANONICAL_SCENE_ID.test(entry.sceneId)) errors.push(issue('invalidSceneId', entry.path, '场景 ID 必须为 S01-S14 或 SXX-CNN', entry.sceneId));
      if (region.previewOnly === true) previewScenes.add(entry.sceneId);
    }
  }
  return previewScenes;
}

export function validateSanguoZhangjiaoProject(project) {
  const errors = [];
  if (project.meta?.campaignId !== CAMPAIGN_ID) {
    errors.push(issue('invalidCampaign', 'meta.campaignId', `战役必须为 ${CAMPAIGN_ID}`, project.meta?.campaignId));
  }

  collectLegacyFacts(project, '', errors);
  const previewScenes = collectWorldScenes(project, errors);
  const storyState = project.variables?.storyState || {};
  const currentSceneId = storyState.currentSceneId;
  if (!CANONICAL_SCENE_ID.test(currentSceneId || '')) {
    errors.push(issue('invalidSceneId', 'variables.storyState.currentSceneId', '当前场景必须为 canonical S01-S14', currentSceneId));
  }
  if (previewScenes.has(currentSceneId)) {
    errors.push(issue('previewSceneInStory', 'variables.storyState.currentSceneId', '构图预览场景不能成为当前主流程场景', currentSceneId));
  }

  for (const [index, sceneId] of (storyState.unlockedScenes || []).entries()) {
    const path = `variables.storyState.unlockedScenes[${index}]`;
    if (!CANONICAL_SCENE_ID.test(sceneId || '')) errors.push(issue('invalidSceneId', path, '解锁场景必须为 canonical S01-S14', sceneId));
    if (previewScenes.has(sceneId)) errors.push(issue('previewSceneInStory', path, '构图预览场景不能提前进入主流程解锁列表', sceneId));
  }

  for (const [index, scene] of (project.scenes || []).entries()) {
    const sceneId = scene?.sceneId || scene?.id;
    if (sceneId && !CANONICAL_SCENE_ID.test(sceneId)) {
      errors.push(issue('invalidSceneId', `scenes[${index}]`, '项目场景必须使用 canonical ID', sceneId));
    }
  }
  return { ok: errors.length === 0, errors };
}

export const SANGUO_ZHANGJIAO_CONTENT_POLICY = Object.freeze({
  validateProject: validateSanguoZhangjiaoProject
});

export default SANGUO_ZHANGJIAO_CONTENT_POLICY;