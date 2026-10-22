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
 * audit-player-skeleton-clips.mjs —— 审计 player.json：rest 坐标 vs 各剪辑键值的坐标系一致性。
 *
 * 背景：剪辑关键帧的 x/y 是**绝对局部值**（采样时整列替换 rest），
 * 因此 rest 的 bones 坐标必须与剪辑键值同源，否则「缺该骨轨道的剪辑」
 * （gather/attack/logging/mining/fishing）会落到另一套坐标系 → 人物变形。
 *
 * 输出：每个剪辑首帧下各骨的世界坐标，与 rest 世界坐标并排列出。
 * 只读脚本。
 *
 * 用法：node scripts/audit-player-skeleton-clips.mjs
 */

import { readFileSync } from 'node:fs';
import { parseSkeletonAsset } from '../src/animation/SkeletonAsset.js';
import { createRestLocalPose, composeWorldTransforms, sampleClip } from '../src/animation/SkeletonPose.js';

const ROOT = 'example/sanguo_zhangjiao/assets/';
const doc = JSON.parse(readFileSync(ROOT + 'skeletons/player.json', 'utf8'));
const asset = parseSkeletonAsset(doc);
const rest = createRestLocalPose(asset);
const restWorld = composeWorldTransforms(asset, rest);

const bones = [...asset.bones.keys()];

console.log('=== rest 世界坐标 ===');
for (const b of bones) {
  const w = restWorld.get(b);
  console.log(`  ${b.padEnd(7)} x=${w.x.toFixed(2).padStart(7)}  y=${w.y.toFixed(2).padStart(7)}`);
}

console.log('\n=== 各剪辑首帧世界坐标（与 rest 的偏差 Δ）===');
for (const clip of asset.clips.values()) {
  const world = composeWorldTransforms(asset, sampleClip(clip, 0, rest));
  const rows = [];
  for (const b of bones) {
    const w = world.get(b);
    const r = restWorld.get(b);
    const dx = w.x - r.x, dy = w.y - r.y;
    // 只有偏差明显的才算「与 rest 不同源」
    if (Math.abs(dx) > 0.6 || Math.abs(dy) > 0.6) {
      rows.push(`${b}:Δ(${dx.toFixed(1)},${dy.toFixed(1)})`);
    }
  }
  console.log(`\n[${clip.name}] ${rows.length ? rows.join('  ') : '（与 rest 完全一致）'}`);
}
