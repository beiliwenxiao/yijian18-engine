/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * inspect-player-parts.mjs
 * 打印玩家部件图的内容包围盒与主色（供重绘脚本对齐轮廓/配色）。
 * 用法：node scripts/inspect-player-parts.mjs
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/parts');

const PARTS = [
  'head-front.png', 'head-side.png', 'head-back.png',
  'torso.png', 'skirt-front.png', 'skirt-back.png',
  'upper-arm-l.png', 'fore-arm-l.png', 'thigh-l.png', 'calf-l.png'
];

function quantize(r, g, b) {
  return `${[r, g, b].map(v => Math.round(v / 16) * 16).join(',')}`;
}

for (const name of PARTS) {
  const { data, info } = await sharp(path.join(dir, name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  const colors = new Map();
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      const a = data[i + 3];
      if (a < 32) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      const key = quantize(data[i], data[i + 1], data[i + 2]);
      colors.set(key, (colors.get(key) || 0) + 1);
    }
  }
  const top = [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([rgb, count]) => `${rgb.split(',').map(n => (+n).toString(16).padStart(2, '0')).join('')}×${count}`);
  console.log(
    `${name}: 内容 bbox x[${x0}..${x1}] y[${y0}..${y1}] (${x1 - x0 + 1}x${y1 - y0 + 1})`,
    `| 主色: ${top.join(' ')}`
  );
}
