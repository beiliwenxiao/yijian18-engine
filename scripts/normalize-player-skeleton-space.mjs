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
 * normalize-player-skeleton-space.mjs —— player.json 局部坐标归一化（一次性迁移脚本）。
 *
 * ## 实测根因
 *
 * 1. 剪辑关键帧的 x/y 是**绝对局部值**（采样时整列替换 rest，见 SkeletonPose.sampleClip），
 *    所以 rest 必须与剪辑键值同源，否则「缺 x/y 键的骨」会落到另一套坐标系 → 实机人物变形
 *    （实测 gather/attack/logging/mining/fishing 只有 rot 键，继承被拖歪的 rest → 手脚脱节）。
 * 2. player.json 的 bones rest 被手工拖拽过：各骨局部 x 统一 +2.5，躯干→头间距被拉长 15.96px，
 *    手臂/腿部的父子链方向倒置（肘在肩上方、膝在髋上方）。部件图是照另一套几何摆的，
 *    所以旧 rest 渲染出来是**断肢**的（实测：头与躯干间 15px 空洞）。
 * 3. 唯一自洽的一套是 idle_down 的剪辑键值（现行系）：头贴颈、肘在肩下、膝在髋下、脚踩地。
 *    美术重做部件图时照的就是这套 —— 故以它为唯一基准。
 *
 * ## 归一化规则
 *
 *   new_local = CANONICAL[bone] + (old_key - SOURCE[bone])
 *
 *   - x 轴：SOURCE 恒为 CANONICAL → 键值**原样保留**（作者的屏幕空间意图不动）。
 *   - y 轴：按剪辑所属源系统换算：
 *       G 系 = gen-player-skeleton.mjs 原始设计（相对 rest 的增量基准）
 *       C 系 = 现行系（idle_down 系）
 *       ABS  = 绝对世界高度（躺平贴地 / 悬浮），不动
 *   - rest bones：直接写成 CANONICAL（= idle_down 首帧局部坐标）。
 *
 * ## 幂等
 *
 * meta.coordinateSpace === 'canonical-v1' 时跳过。
 *
 * 用法：node scripts/normalize-player-skeleton-space.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateSkeletonAsset } from '../src/core/validation/SkeletonAssetValidator.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons/player.json');

/** 现行系（idle_down 首帧）——部件图实际装配所依据的骨架基准。 */
const CANONICAL = {
  hips: { x: -0.25, y: -53.14 },
  torso: { x: 0, y: -4.64 },
  head: { x: 0, y: -22.64 },
  back: { x: 0, y: -16.64 },
  armUR: { x: -7, y: -18.64 },
  armUL: { x: 7, y: -18.64 },
  armFR: { x: 0, y: 9.36 },
  armFL: { x: 0, y: 9.36 },
  thighR: { x: -5, y: -3.64 },
  thighL: { x: 5, y: -3.64 },
  calfR: { x: 0, y: 10.11 },
  calfL: { x: 0, y: 10.36 }
};

/** G 系 rest（gen-player-skeleton.mjs 原始设计）——G 系剪辑键值的增量基准。 */
const G_REST = {
  hips: { x: 0, y: -26 },
  torso: { x: 0, y: -2 },
  head: { x: 0, y: -20 },
  back: { x: 0, y: -14 },
  armUL: { x: -7, y: -16 }, armFL: { x: 0, y: 12 },
  armUR: { x: 7, y: -16 }, armFR: { x: 0, y: 12 },
  thighL: { x: -5, y: -1 }, calfL: { x: 0, y: 13 },
  thighR: { x: 5, y: -1 }, calfR: { x: 0, y: 13 }
};

/**
 * 每个剪辑的 y 源系统：
 *   'G'  = 相对 G 系 rest 的增量（走查/待机/跳跃/攻击/攀爬/灵魂）
 *   'C'  = 现行系（idle_down 本身）
 *   'ABS'= 绝对世界高度（躺平贴地），不动
 */
const Y_SOURCE = {
  idle_down: 'C',
  idle_up: 'G',
  idle_side: 'G',
  walk_down: 'G',
  walk_up: 'G',
  walk_side: 'G',
  walk_SE: 'G',
  walk_SW: 'G',
  walk_NE: 'G',
  walk_NW: 'G',
  jump: 'G',
  attack: 'G',
  climb_back: 'G',
  soul: 'G',
  sleep: 'ABS',
  stretcher: 'ABS'
};

/** death 首帧是「站立」（相对 rest 的增量），末段是「躺平贴地」（绝对高度），逐键处理。 */
const DEATH_HIPS_Y = [-53.14, -8, -8];

const round = value => Math.round(value * 100) / 100;

const doc = JSON.parse(readFileSync(file, 'utf8'));

if (doc.meta?.coordinateSpace === 'canonical-v1') {
  console.log('已是 canonical-v1，跳过（幂等）');
  process.exit(0);
}

const report = [];

for (const clip of doc.clips) {
  const ySource = Y_SOURCE[clip.name] || 'C';
  let converted = 0;

  for (const track of clip.tracks || []) {
    const bone = track.bone;
    const canonical = CANONICAL[bone];
    if (!canonical) continue;
    const hasX = track.keys.some(k => k.x != null);
    const hasY = track.keys.some(k => k.y != null);
    if (!hasX && !hasY) continue;   // 纯 rot 轨道 → 继承 rest，无需换算

    track.keys = track.keys.map((key, index) => {
      const next = { ...key };
      // x 轴：键值原样保留（作者的屏幕空间意图）
      if (key.x != null) next.x = round(key.x);
      // y 轴：按剪辑所属源系统换算
      if (key.y != null) {
        if (clip.name === 'death' && bone === 'hips') {
          next.y = DEATH_HIPS_Y[index] ?? key.y;
        } else if (ySource === 'G') {
          const g = G_REST[bone];
          next.y = round(canonical.y + (key.y - g.y));
        } else if (ySource === 'ABS') {
          next.y = round(key.y);
        } else {
          next.y = round(canonical.y + (key.y - canonical.y));
        }
      }
      return next;
    });
    converted++;
  }

  report.push(`[${clip.name}] y 源系 ${ySource}，换算轨道 ${converted} 条`);
}

/* ---------------- bones rest → 现行系 ---------------- */

for (const bone of doc.bones) {
  const c = CANONICAL[bone.id];
  if (!c) continue;
  bone.x = c.x;
  bone.y = c.y;
}

/* ---------------- 标记坐标系版本 + 校验 ---------------- */

doc.meta = doc.meta || {};
doc.meta.coordinateSpace = 'canonical-v1';

const validation = validateSkeletonAsset(structuredClone(doc));
if (!validation.ok) {
  console.error('归一化后校验失败：');
  for (const error of validation.errors) console.error(' ', error.path || '', error.message || error.reason || '');
  process.exit(1);
}

writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

console.log('已归一化 player.json 局部坐标 → canonical-v1（现行系）');
for (const line of report) console.log(' ', line);
