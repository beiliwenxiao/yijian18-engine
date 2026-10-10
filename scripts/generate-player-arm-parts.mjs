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
 * generate-player-arm-parts.mjs
 * 生成玩家角色手臂部件图（上臂×2 / 前臂×2）：
 *   - 64x64 画布，关节（肩/肘）在画布中心，内容向下延伸（attachment (0,0) 即对齐骨骼）
 *   - 内容长度与 player.json 骨长一致（上臂 12px、前臂 13px 含手）
 *   - 像素风格：2px 块 + 深色描边 + 两档明度；上臂=袍袖色，前臂=肤色+手
 * 用法：node scripts/generate-player-arm-parts.mjs
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/parts');

// 配色（与 torso 袍 / head 肤色同族）
const OUTLINE = '#211f26';
const SLEEVE = '#3d4657';
const SLEEVE_LIGHT = '#4a5568';
const SLEEVE_DARK = '#2f3644';
const SKIN = '#d8a06a';
const SKIN_LIGHT = '#e2b07c';
const SKIN_DARK = '#b8825a';

/** 画一个描边像素块（含 1 圈 outline），坐标按 2px 网格对齐。 */
function block(x, y, w, h, fill, fillLight, fillDark) {
  return [
    `<rect x="${x - 1}" y="${y - 1}" width="${w + 2}" height="${h + 2}" fill="${OUTLINE}"/>`,
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`,
    `<rect x="${x}" y="${y}" width="${Math.max(2, w / 3)}" height="${h}" fill="${fillLight}"/>`,
    `<rect x="${x + w - Math.max(2, w / 3)}" y="${y}" width="${Math.max(2, w / 3)}" height="${h}" fill="${fillDark}"/>`
  ].join('');
}

/** 上臂：肩关节在 (32,32)，袍袖向下 12px 至肘（骨长 12）。 */
function upperArm() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" shape-rendering="crispEdges">
    ${block(28, 30, 8, 14, SLEEVE, SLEEVE_LIGHT, SLEEVE_DARK)}
  </svg>`;
}

/** 前臂：肘关节在 (32,32)，肤色向下 11px + 手 4px（骨长 13）。 */
function foreArm() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" shape-rendering="crispEdges">
    ${block(28, 30, 8, 12, SKIN, SKIN_LIGHT, SKIN_DARK)}
    ${block(27, 42, 10, 5, SKIN, SKIN_LIGHT, SKIN_DARK)}
  </svg>`;
}

async function write(name, svg) {
  const file = path.join(outDir, name);
  await sharp(Buffer.from(svg)).png().toFile(file);
  console.log('生成', path.relative(root, file));
}

// 左右臂镜像对称：内容一致（绘制层由骨骼旋转/翻转区分左右）
await write('upper-arm-l.png', upperArm());
await write('upper-arm-r.png', upperArm());
await write('fore-arm-l.png', foreArm());
await write('fore-arm-r.png', foreArm());
console.log('完成');
