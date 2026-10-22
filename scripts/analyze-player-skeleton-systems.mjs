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
 * analyze-player-skeleton-systems.mjs —— 判定 player.json 每个剪辑轨道属于哪套坐标系。
 *
 * 背景：player.json 历史上存在三套互不兼容的局部坐标表达：
 *   A 系 = 现 bones 的 rest 坐标（手臂/腿骨链方向倒置）
 *   G 系 = gen-player-skeleton.mjs 的原始设计（hips y=-26、torso y=-2 …，含左右语义与现况相反）
 *   B 系 = idle_down/walk_* 剪辑键值（现行实机表现，解剖方向正确）
 * 三系之间是**每骨常量平移**（根骨 hips 单独），故可精确换算。
 *
 * 本脚本：列出每条轨道的 x/y 键值，分别与 A/G/B 三套局部坐标表比对，输出判定与残差。
 * 只读脚本。
 *
 * 用法：node scripts/analyze-player-skeleton-systems.mjs
 */

import { readFileSync } from 'node:fs';

const ROOT = 'example/sanguo_zhangjiao/assets/';
const doc = JSON.parse(readFileSync(ROOT + 'skeletons/player.json', 'utf8'));

// --- A 系：现 bones 的局部 rest ---
const A = new Map(doc.bones.map(bone => [bone.id, { x: bone.x, y: bone.y }]));

// --- G 系：gen-player-skeleton.mjs 原始设计（左右语义与现况相反） ---
const G = new Map(Object.entries({
  hips: { x: 0, y: -26 },
  torso: { x: 0, y: -2 },
  head: { x: 0, y: -20 },
  back: { x: 0, y: -14 },
  armUL: { x: -7, y: -16 }, armFL: { x: 0, y: 12 },
  armUR: { x: 7, y: -16 }, armFR: { x: 0, y: 12 },
  thighL: { x: -5, y: -1 }, calfL: { x: 0, y: 13 },
  thighR: { x: 5, y: -1 }, calfR: { x: 0, y: 13 }
}));

// --- B 系：idle_down 首帧键值（现行实机表现） ---
const idleClip = doc.clips.find(c => c.name === 'idle_down');
const B = new Map();
for (const track of idleClip.tracks) {
  const key = track.keys[0];
  const fallback = A.get(track.bone) || { x: 0, y: 0 };
  B.set(track.bone, { x: key.x ?? fallback.x, y: key.y ?? fallback.y });
}

console.log('=== 三套局部坐标表 ===');
console.log('bone'.padEnd(8) + 'A(rest)'.padEnd(20) + 'G(gen)'.padEnd(20) + 'B(idle_down)'.padEnd(20) + 'G→B 差'.padEnd(18) + 'A→B 差');
for (const bone of A.keys()) {
  const a = A.get(bone), g = G.get(bone), b = B.get(bone);
  const g2b = g ? `${(b.x - g.x).toFixed(2)},${(b.y - g.y).toFixed(2)}` : '-';
  const a2b = `${(b.x - a.x).toFixed(2)},${(b.y - a.y).toFixed(2)}`;
  console.log(bone.padEnd(8)
    + `${a.x},${a.y}`.padEnd(20)
    + (g ? `${g.x},${g.y}` : '-').padEnd(20)
    + `${b.x},${b.y}`.padEnd(20)
    + g2b.padEnd(18) + a2b);
}

console.log('\n=== 每条轨道判定 ===');
for (const clip of doc.clips) {
  console.log(`\n[${clip.name}]`);
  for (const track of clip.tracks || []) {
    const bone = track.bone;
    const a = A.get(bone), b = B.get(bone), g = G.get(bone);
    const keys = track.keys || [];
    const xs = keys.map(k => k.x).filter(v => v != null);
    const ys = keys.map(k => k.y).filter(v => v != null);
    const mean = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    const mx = mean(xs), my = mean(ys);
    const dist = ref => {
      if (!ref) return Infinity;
      const dx = mx == null ? 0 : Math.abs(mx - ref.x);
      const dy = my == null ? 0 : Math.abs(my - ref.y);
      return dx + dy;
    };
    const dA = dist(a), dB = dist(b), dG = dist(g);
    const best = dB <= dA && dB <= dG ? 'B' : (dA <= dG ? 'A' : 'G');
    const residual = best === 'B' ? dB : best === 'A' ? dA : dG;
    console.log(`  ${bone.padEnd(7)} x键${String(mx).padStart(7)} y键${String(my).padStart(8)}  →  ${best} 系 (残差 ${residual.toFixed(2)})`
      + (xs.length === 0 ? '  [无x键]' : '') + (ys.length === 0 ? '  [无y键]' : ''));
  }
}
