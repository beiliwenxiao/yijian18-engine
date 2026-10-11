/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-10-11
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * apply-directional-presets.mjs —— 把对角线行走动作预设合入 player.json（A 方案 8 向接线）。
 * 规则与编辑器 _applyPreset 一致：预设轨道按骨名匹配过滤，结构化克隆写入，与预设零关联。
 * 幂等：目标剪辑已存在则跳过。
 * 用法：node scripts/apply-directional-presets.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skeletonPath = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons/player.json');
const presetDir = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons/anim-presets');
const { validateSkeletonAsset } = await import(pathToFileURL(path.join(root, 'src/core/validation/SkeletonAssetValidator.js')).href);

const PRESET_IDS = ['humanoid.walk_SE', 'humanoid.walk_SW', 'humanoid.walk_NE', 'humanoid.walk_NW'];

const doc = JSON.parse(readFileSync(skeletonPath, 'utf8'));
const docBones = new Set((doc.bones || []).map(bone => bone.id));
doc.clips = doc.clips || [];

let applied = 0;
for (const presetId of PRESET_IDS) {
  const preset = JSON.parse(readFileSync(path.join(presetDir, `${presetId}.json`), 'utf8'));
  const matchedTracks = (preset.tracks || []).filter(track => docBones.has(track.bone));
  if (matchedTracks.length === 0) {
    console.warn(`跳过 ${presetId}: 无轨道匹配 player.json 骨骼`);
    continue;
  }
  if ((doc.clips || []).some(clip => clip.name === preset.clipName)) {
    console.log(`跳过 ${presetId}: 剪辑 ${preset.clipName} 已存在`);
    continue;
  }
  doc.clips.push({
    name: preset.clipName,
    durationMs: preset.durationMs || 1000,
    loop: preset.loop !== false,
    tracks: structuredClone(matchedTracks)
  });
  applied++;
  console.log(`合入 ${presetId} → ${preset.clipName}（匹配 ${matchedTracks.length} 轨）`);
}

if (applied > 0) {
  const validation = validateSkeletonAsset(structuredClone(doc));
  if (!validation.ok) throw new Error(`合入后校验失败: ${JSON.stringify(validation.errors)}`);
  writeFileSync(skeletonPath, JSON.stringify(doc, null, 2) + '\n');
  console.log(`已写入 ${applied} 个对角剪辑，校验通过`);
} else {
  console.log('无需写入（全部已存在）');
}
