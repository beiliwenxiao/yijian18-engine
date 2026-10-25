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
 * verify-lpc-ground-align.mjs —— 整帧角色「脚底 vs 锚点（地平线）」几何自检。
 *
 * ## 为什么需要
 *   引擎渲染附件是**以锚点为中心**（SkeletonRenderer: drawImage(-w/2, -h/2)），
 *   而 LPC 每帧 64×64 格子底部有透明留白（脚底线在格内 y=61）——
 *   不做偏移整帧角色就会陷地/悬空。此脚本用与引擎一致的绘制几何算出脚底线位置，
 *   确认它落在锚点（地平线）上，避免靠肉眼在编辑器里反复试偏移量。
 *
 * ## 判定
 *   脚底像素行（格内 GROUND_Y=61）映射到屏幕后的 y 应等于锚点 y（= 地平线）。
 *
 * 用法：node scripts/verify-lpc-ground-align.mjs
 */

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKELETON = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons/player-lpc.json');
const SHEET = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/lpc/frames.png');
const CELL = 64;
const GROUND_Y = 61;   // LPC 站立帧脚底线（像素行，实测）

const doc = JSON.parse(readFileSync(SKELETON, 'utf8'));
const attachment = doc.slots.find(s => s.id === 'frame').attachment;

(async () => {
  const { data, info } = await sharp(SHEET).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  // 逐帧测内容底边（相对格内像素行）
  const frameBottom = (sx, sy) => {
    let bottom = -1;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const idx = ((sy + y) * info.width + (sx + x)) * 4;
        if (data[idx + 3] > 32) { if (y > bottom) bottom = y; }
      }
    }
    return bottom;
  };

  // 引擎绘制几何：附件盒以锚点为中心（drawImage(-w/2, -h/2)），ctx 的 +y 向下为正
  const drawH = attachment.height;
  const drawW = attachment.width;
  const destTop = -drawH / 2;            // 相对锚点
  const scaleY = drawH / CELL;

  const actions = Object.entries(doc.meta.lpcActions);
  let worst = 0;
  const rows = [];
  for (const [id, act] of actions) {
    for (const [dir, info2] of Object.entries(act.dirs)) {
      const f = info2.frames[0];
      const bottom = frameBottom(f.sx, f.sy);
      if (bottom < 0) continue;
      // 帧内底边像素行 → 相对锚点的偏移（ctx +y 向下为正）
      const offsetFromAnchor = destTop + bottom * scaleY + attachment.y;
      worst = Math.max(worst, Math.abs(offsetFromAnchor));
      rows.push({ id, dir, bottom, offset: Number(offsetFromAnchor.toFixed(2)) });
    }
  }
  for (const r of rows) {
    console.log(`${(r.id + '/' + r.dir).padEnd(18)} 帧内底边 y=${String(r.bottom).padStart(2)}  相对锚点偏移 ${r.offset >= 0 ? '+' : ''}${r.offset}px`);
  }
  const maxAbs = Math.max(...rows.map(r => Math.abs(r.offset)));
  console.log(`\n最大脚底偏移：${maxAbs.toFixed(2)}px（${maxAbs <= 1 ? '已贴合地平线 ✓' : '未贴合 ✗'}）`);
  if (maxAbs > 1) process.exitCode = 1;
})();
