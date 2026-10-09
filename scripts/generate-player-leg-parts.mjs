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
 * generate-player-leg-parts.mjs
 * 生成玩家角色腿部部件图（大腿×2 / 小腿×2）：
 *   - 64x64 画布，关节（髋/膝）在画布中心，内容向下延伸（attachment (0,0) 即对齐骨骼）
 *   - 内容长度与 player.json 骨长一致（大腿 13px、小腿 14px 含靴）
 *   - 像素风格：2px 块 + 深色描边 + 左高右暗两档明度，配色与头部/躯干袍一致
 * 用法：node scripts/generate-player-leg-parts.mjs
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/parts');

// 配色（与 torso 袍 / head 肤色同族）
const OUTLINE = '#211f26';
const PANTS = '#3d4657';
const PANTS_LIGHT = '#4a5568';
const PANTS_DARK = '#2f3644';
const BOOT = '#262b36';
const BOOT_DARK = '#1d2129';

const PX = 2; // 像素块尺寸（2px 网格 → 像素画颗粒感）

/** 画一个描边像素块（含 1 圈 outline），坐标按 2px 网格对齐。 */
function block(x, y, w, h, fill, fillLight, fillDark) {
  const rects = [
    `<rect x="${x - 1}" y="${y - 1}" width="${w + 2}" height="${h + 2}" fill="${OUTLINE}"/>`,
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`,
    `<rect x="${x}" y="${y}" width="${Math.max(PX, w / 3)}" height="${h}" fill="${fillLight}"/>`,
    `<rect x="${x + w - Math.max(PX, w / 3)}" y="${y}" width="${Math.max(PX, w / 3)}" height="${h}" fill="${fillDark}"/>`
  ];
  return rects.join('');
}

/** 大腿：髋关节在 (32,32)，裤管向下 13px 至膝（骨长 13）。 */
function thigh() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" shape-rendering="crispEdges">
    ${block(27, 30, 10, 15, PANTS, PANTS_LIGHT, PANTS_DARK)}
    ${block(29, 45, 6, 2, PANTS_DARK, PANTS_DARK, OUTLINE)}
  </svg>`;
}

/** 小腿：膝关节在 (32,32)，裤管向下 10px + 靴 4px（骨长 14）。 */
function calf() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" shape-rendering="crispEdges">
    ${block(28, 30, 8, 11, PANTS, PANTS_LIGHT, PANTS_DARK)}
    ${block(27, 41, 10, 6, BOOT, BOOT, BOOT_DARK)}
    <rect x="25" y="47" width="14" height="2" fill="${OUTLINE}"/>
  </svg>`;
}

async function write(name, svg) {
  const file = path.join(outDir, name);
  await sharp(Buffer.from(svg)).png().toFile(file);
  console.log('生成', path.relative(root, file));
}

// 左右腿镜像对称：内容一致（绘制层由骨骼旋转/翻转区分左右）
await write('thigh-l.png', thigh());
await write('thigh-r.png', thigh());
await write('calf-l.png', calf());
await write('calf-r.png', calf());
console.log('完成');
