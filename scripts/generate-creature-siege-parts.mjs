/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-10-10
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * generate-creature-siege-parts.mjs
 * 生成狼/马/骑手/攻城器械（冲车/投石车/井阑）部件图 + 玩家护甲部件图，
 * 并登记进 assets.json（manifest）与 library.json（skeletonParts）。
 *
 * 部件约定（与运行时 SkeletonRenderer 对齐）：
 *   - 挂件图以「骨骼原点 = 图像中心」绘制（渲染时 -w/2,-h/2 居中）；
 *   - 朝向 +x（右），身体链 spine→chest→neck→head 沿 +x；
 *   - 四肢/垂件沿 +y（下），背驮件（马鞍）沿 -y（上），塔身段沿 -y（上）；
 *   - 像素风：crispEdges + 深色描边 + 左亮右暗两档明度。
 * 用法：node scripts/generate-creature-siege-parts.mjs
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'example/sanguo_zhangjiao/assets/images/units/parts');
const playerPartsDir = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/parts');
mkdirSync(outDir, { recursive: true });

/* ---------------- 调色板（描边/基色/亮/暗/深） ---------------- */
const WOLF = { o: '#1a1b20', b: '#5d6470', l: '#7a828f', d: '#434855', d2: '#31353f' };
const HORSE = { o: '#241a12', b: '#8a5a30', l: '#a5713d', d: '#6b4423', d2: '#502f16' };
const WOOD = { o: '#1f150c', b: '#8a6238', l: '#a67b47', d: '#6b4a26', d2: '#4c3016' };
const IRON = { o: '#15161a', b: '#767e8a', l: '#959daa', d: '#565e6a', d2: '#3a4049' };
const HIDE = { o: '#241c10', b: '#a08558', l: '#bda273', d: '#7c6540', d2: '#5c4a2d' };
const STONE = { o: '#141418', b: '#8d8d94', l: '#a8a8b0', d: '#6a6a72' };
const CLOTH = { o: '#12241a', b: '#2f6e4f', l: '#3f8a63', d: '#225039', d2: '#173526' };
const SKIN = { o: '#3a2418', b: '#d8a878', l: '#e6bc8e', d: '#b8875a', d2: '#8f6540' };
const LEATHER = { o: '#1d1208', b: '#6e4a2a', l: '#8a6238', d: '#523620', d2: '#3a2614' };
const WHITE = '#e8e4da';

/* ---------------- SVG 基元 ---------------- */
const rect = (x, y, w, h, f) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"/>`;
const svg = (w, h, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" shape-rendering="crispEdges">${inner}</svg>`;

/** 描边块：1 圈 outline + 基色 + 左亮条 + 右暗条（竖向体积感）。 */
function block(x, y, w, h, p) {
  const strip = Math.max(2, Math.round(w * 0.28));
  return rect(x - 1, y - 1, w + 2, h + 2, p.o) + rect(x, y, w, h, p.b)
    + rect(x, y, strip, h, p.l) + rect(x + w - strip, y, strip, h, p.d);
}

/** 横向块：1 圈 outline + 基色 + 上亮条 + 下暗条（横梁/圆木体积感）。 */
function beam(x, y, w, h, p) {
  const strip = Math.max(2, Math.round(h * 0.3));
  return rect(x - 1, y - 1, w + 2, h + 2, p.o) + rect(x, y, w, h, p.b)
    + rect(x, y, w, strip, p.l) + rect(x, y + h - strip, w, strip, p.d);
}

/** 像素圆盘：outline 圈 + 基色 + 左上高光。 */
function disc(cx, cy, r, p) {
  return `<circle cx="${cx}" cy="${cy}" r="${r + 1}" fill="${p.o}"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${p.b}"/>`
    + `<circle cx="${cx - r * 0.35}" cy="${cy - r * 0.35}" r="${Math.max(1.5, r * 0.3)}" fill="${p.l}"/>`;
}

/** 木轮：轮辋 + 交叉辐条 + 铁毂。 */
function wheel(r) {
  const cx = 32, cy = 32;
  return svg(64, 64,
    disc(cx, cy, r, WOOD)
    + rect(cx - 1, cy - r + 1, 2, r * 2 - 2, WOOD.d)
    + rect(cx - r + 1, cy - 1, r * 2 - 2, 2, WOOD.d)
    + rect(cx - 1, cy - r + 1, 2, r * 2 - 2, WOOD.d2)
    + `<circle cx="${cx}" cy="${cy}" r="3" fill="${IRON.d}"/>`
    + `<circle cx="${cx}" cy="${cy}" r="1.5" fill="${IRON.l}"/>`
  );
}

/* ---------------- 部件绘制（关节=画布中心，朝向 +x） ---------------- */

/* ===== 狼（tpl.wolf，灰狼） ===== */
function wolfBody() { // 绑 spine：覆盖 spine→chest 躯干，狼皮
  const cx = 48, cy = 32;
  return svg(96, 64,
    block(cx - 24, cy - 7, 12, 14, WOLF)            // 后臀
    + block(cx - 20, cy - 9, 44, 18, WOLF)          // 躯干
    + block(cx + 16, cy - 13, 12, 12, WOLF)         // 前肩隆起
    + rect(cx - 20, cy - 9, 44, 3, WOLF.l)          // 背部亮毛
    + rect(cx - 12, cy + 5, 26, 4, WOLF.d2)         // 腹部阴影
    + rect(cx - 6, cy - 11, 2, 2, WOLF.d2)          // 毛斑
    + rect(cx + 4, cy - 12, 2, 2, WOLF.d2)
  );
}
function wolfNeck() { // 绑 neck：颈毛
  return svg(64, 64,
    block(28, 16, 16, 20, WOLF)
    + rect(28, 16, 4, 20, WOLF.l)
    + rect(38, 18, 2, 16, WOLF.d2)
  );
}
function wolfHead() { // 绑 head：狼头（耳/眼/吻）
  return svg(64, 64,
    rect(31, 12, 5, 8, WOLF.d) + rect(40, 12, 5, 8, WOLF.d)   // 双耳
    + rect(32, 13, 3, 5, WOLF.b) + rect(41, 13, 3, 5, WOLF.b)
    + block(28, 18, 18, 12, WOLF)                              // 头骨
    + block(44, 22, 9, 6, WOLF)                                // 吻部
    + rect(45, 24, 6, 2, WOLF.d2)
    + rect(37, 21, 3, 3, WHITE) + rect(38, 22, 2, 2, '#101014') // 眼
    + rect(52, 24, 2, 2, '#101014')                             // 鼻尖
  );
}
function wolfJaw() { // 绑 jaw：下颚 + 獠牙
  return svg(64, 64,
    block(30, 30, 20, 7, WOLF)
    + rect(32, 29, 2, 3, WHITE) + rect(38, 29, 2, 3, WHITE) + rect(44, 29, 2, 3, WHITE)
    + rect(30, 37, 20, 2, WOLF.d2)
    + rect(49, 32, 2, 2, '#101014')
  );
}
function wolfTail() { // 绑 tail1：蓬尾（覆盖 tail1+tail2）
  return svg(64, 64,
    block(8, 24, 26, 9, WOLF)
    + block(2, 28, 10, 10, WOLF)
    + rect(8, 24, 26, 2, WOLF.l)
    + rect(2, 36, 10, 3, WOLF.d2)
  );
}
function wolfLegUpper() { // 绑 legFL_upper（FR/HR 复用）
  return svg(64, 64, block(27, 30, 11, 16, WOLF));
}
function wolfLegLower() { // 绑 legFL_lower（FR/HR 复用）：小腿 + 爪
  return svg(64, 64,
    block(29, 30, 8, 12, WOLF)
    + block(27, 42, 12, 5, WOLF.d)
  );
}

/* ===== 马（tpl.horse，棕马） ===== */
function horseBody() { // 绑 spine：马躯干
  const cx = 48, cy = 32;
  return svg(96, 64,
    block(cx - 27, cy - 10, 13, 19, HORSE)          // 后臀
    + block(cx - 22, cy - 12, 46, 24, HORSE)        // 躯干
    + block(cx + 17, cy - 15, 13, 15, HORSE)        // 前肩
    + rect(cx - 22, cy - 12, 46, 4, HORSE.l)        // 背部亮
    + rect(cx - 14, cy + 7, 30, 5, HORSE.d2)        // 腹部阴影
  );
}
function horseNeck() { // 绑 neck1（neck2 复用）：粗颈 + 鬃毛
  return svg(64, 64,
    block(29, 13, 17, 21, HORSE)
    + rect(29, 13, 4, 21, HORSE.d2)                 // 鬃毛
    + rect(31, 11, 6, 3, HORSE.d2)
    + rect(41, 16, 2, 16, HORSE.d)
  );
}
function horseHead() { // 绑 head：马头（长脸/耳/额鬃）
  return svg(64, 64,
    rect(33, 10, 4, 8, HORSE.d) + rect(41, 10, 4, 8, HORSE.d)  // 双耳
    + block(31, 16, 17, 13, HORSE)                              // 头骨
    + block(45, 21, 9, 8, HORSE.l)                              // 鼻梁
    + rect(52, 26, 3, 3, '#2a2a30')                             // 鼻孔
    + rect(31, 15, 9, 4, HORSE.d2)                              // 额鬃
    + rect(38, 19, 3, 3, WHITE) + rect(39, 20, 2, 2, '#101014') // 眼
  );
}
function horseTail() { // 绑 tail1：甩尾（覆盖 tail1+tail2）
  return svg(64, 64,
    block(6, 24, 20, 11, HORSE.d)
    + block(1, 28, 10, 15, HORSE.d2)
    + rect(6, 24, 20, 3, HORSE.b)
  );
}
function horseSaddle() { // 绑 saddle：鞍毯 + 木鞍桥（沿 -y 上方）
  return svg(64, 64,
    rect(20, 26, 24, 6, HIDE.o) + rect(21, 26, 22, 5, HIDE.b)   // 鞍毯
    + rect(23, 28, 3, 3, HIDE.d) + rect(37, 28, 3, 3, HIDE.d)
    + block(24, 18, 16, 9, LEATHER)                              // 鞍桥
    + rect(24, 16, 4, 4, LEATHER.d) + rect(36, 16, 4, 4, LEATHER.d) // 前后鞍桥
    + rect(27, 21, 10, 2, LEATHER.l)
  );
}
function horseLegUpper() { // 绑 legFL_upper（FR/HR 复用）
  return svg(64, 64, block(26, 30, 13, 19, HORSE));
}
function horseLegLower() { // 绑 legFL_lower（FR/HR 复用）：小腿 + 蹄
  return svg(64, 64,
    block(29, 30, 9, 14, HORSE)
    + block(28, 44, 11, 5, HORSE.d2)                // 蹄
  );
}

/* ===== 骑手（tpl.mounted，三国士兵：铁甲 + 绿帻） ===== */
function riderTorso() { // 绑 rider_torso：半身铁甲（沿 -y 上方）
  return svg(64, 64,
    block(22, 14, 20, 19, IRON)                     // 胸甲
    + block(18, 14, 7, 7, IRON.l) + block(39, 14, 7, 7, IRON.l) // 双肩甲
    + rect(22, 20, 20, 2, IRON.d)                   // 甲片缝
    + rect(22, 26, 20, 2, IRON.d)
    + rect(27, 17, 10, 6, IRON.l)                   // 护心镜
    + block(22, 31, 20, 5, CLOTH)                   // 腰带/战袍下摆
    + rect(30, 32, 4, 4, CLOTH.d)                   // 绦带结
  );
}
function riderHead() { // 绑 rider_head：头 + 绿帻
  return svg(64, 64,
    rect(29, 8, 6, 6, CLOTH.d)                      // 帻顶结
    + block(25, 12, 14, 7, CLOTH)                   // 绿帻
    + block(26, 19, 12, 12, SKIN)                   // 脸
    + rect(34, 23, 2, 2, '#20202a')                 // 眼
    + rect(30, 28, 5, 1, SKIN.d)                    // 嘴
  );
}
function riderArmUpper() { // 绑 rider_armUL（UR 复用）：上臂甲
  return svg(64, 64, block(27, 30, 11, 14, IRON));
}
function riderArmFore() { // 绑 rider_armFL（FR 复用）：前臂 + 持缰手
  return svg(64, 64,
    block(28, 30, 9, 12, IRON.d)
    + block(27, 42, 11, 7, SKIN)                    // 手
  );
}

/* ===== 冲车（tpl.siege_ram） ===== */
function ramBase() { // 绑 base：车体底盘（双横梁 + 立柱）
  const cx = 48, cy = 32;
  return svg(96, 64,
    beam(cx - 26, cy - 7, 52, 6, WOOD)              // 上梁
    + beam(cx - 26, cy + 2, 52, 6, WOOD)            // 下梁
    + rect(cx - 18, cy - 9, 5, 20, WOOD.d)          // 立柱
    + rect(cx + 2, cy - 9, 5, 20, WOOD.d)
    + rect(cx + 16, cy - 9, 5, 20, WOOD.d)
    + rect(cx - 27, cy + 8, 54, 2, WOOD.o)
  );
}
function ramRoof() { // 绑 roof：顶棚木架（双柱 + 顶梁）
  const cx = 48, cy = 32;
  return svg(96, 64,
    block(cx - 26, cy - 4, 6, 14, WOOD)             // 左柱
    + block(cx + 20, cy - 4, 6, 14, WOOD)           // 右柱
    + beam(cx - 30, cy - 10, 60, 7, WOOD)           // 顶梁
    + rect(cx - 22, cy - 2, 3, 10, WOOD.d2)
    + rect(cx + 12, cy - 2, 3, 10, WOOD.d2)
  );
}
function ramCover() { // 绑 cover：湿牛皮蒙皮 + 垂穗
  const cx = 48, cy = 32;
  let fringe = '';
  for (let i = 0; i < 8; i++) fringe += rect(cx - 24 + i * 6, cy + 1, 3, 4, HIDE.d);
  return svg(96, 64,
    beam(cx - 25, cy - 9, 50, 11, HIDE)
    + rect(cx - 18, cy - 7, 2, 2, HIDE.d2) + rect(cx - 2, cy - 5, 2, 2, HIDE.d2) + rect(cx + 14, cy - 8, 2, 2, HIDE.d2)
    + fringe
  );
}
function ramArm() { // 绑 ram_arm：撞木（圆木 + 绳箍）
  const cx = 48, cy = 32;
  return svg(96, 64,
    beam(cx - 10, cy - 4, 50, 9, WOOD)
    + rect(cx - 4, cy - 5, 3, 11, WOOD.d2)          // 绳箍
    + rect(cx + 18, cy - 5, 3, 11, WOOD.d2)
    + rect(cx + 36, cy - 3, 5, 5, WOOD.d)           // 端头磨圆
  );
}
function ramHead() { // 绑 ram_head：撞头铁帽
  return svg(64, 64,
    block(30, 25, 14, 14, IRON)
    + block(44, 27, 7, 10, IRON.d)                  // 锥头
    + rect(48, 29, 4, 6, IRON.d2)
    + rect(33, 28, 2, 2, IRON.l) + rect(39, 32, 2, 2, IRON.l) // 铆钉
  );
}
function ramPusher() { // 绑 pusherL/R/B：推杆（沿 -x 向后）
  return svg(64, 64,
    beam(6, 29, 24, 6, WOOD)
    + rect(6, 27, 3, 10, WOOD.d)                    // 握把端
    + rect(26, 28, 4, 8, WOOD.d2)
  );
}

/* ===== 投石车（tpl.siege_catapult） ===== */
function catapultBase() { // 绑 base：车架 + 轴
  const cx = 48, cy = 32;
  return svg(96, 64,
    beam(cx - 24, cy - 6, 48, 9, WOOD)
    + beam(cx - 24, cy + 4, 48, 5, WOOD.d)
    + rect(cx - 16, cy - 9, 5, 16, WOOD.d)          // 斜撑座
    + rect(cx + 8, cy - 9, 5, 16, WOOD.d)
    + rect(cx - 28, cy + 1, 56, 2, WOOD.o)
  );
}
function catapultFrame() { // 绑 frame_winch：绞盘 A 字架 + 卷轴
  return svg(64, 64,
    block(21, 12, 6, 22, WOOD)                      // 左柱
    + block(37, 12, 6, 22, WOOD)                    // 右柱
    + beam(19, 9, 26, 5, WOOD)                      // 顶横
    + rect(24, 16, 2, 14, WOOD.d2)
    + rect(38, 16, 2, 14, WOOD.d2)
    + `<circle cx="32" cy="34" r="6" fill="${WOOD.o}"/><circle cx="32" cy="34" r="5" fill="${WOOD.d}"/>` // 绞盘
    + rect(30, 34, 4, 1.5, WOOD.l) + rect(30, 37, 4, 1.5, WOOD.l)
  );
}
function catapultArm() { // 绑 throw_arm：抛臂（长杆）
  const cx = 48, cy = 32;
  return svg(96, 64,
    beam(cx - 16, cy - 3, 52, 7, WOOD)
    + rect(cx - 10, cy - 4, 3, 9, WOOD.d2)          // 束箍
    + rect(cx + 10, cy - 4, 3, 9, WOOD.d2)
    + block(cx + 34, cy - 4, 6, 9, WOOD.d)          // 臂端
  );
}
function catapultSling() { // 绑 sling：皮兜 + 兜绳
  return svg(64, 64,
    rect(26, 22, 2, 8, '#c9b287') + rect(36, 22, 2, 8, '#c9b287')  // 兜绳
    + rect(24, 26, 4, 2, '#c9b287') + rect(36, 26, 4, 2, '#c9b287')
    + block(27, 30, 11, 9, HIDE)                    // 皮兜
    + rect(29, 33, 2, 2, HIDE.d2) + rect(34, 35, 2, 2, HIDE.d2)    // 透气孔
  );
}
function catapultWeight() { // 绑 counterweight：配重木箱（沿 +y 下垂）
  return svg(64, 64,
    block(23, 30, 18, 15, WOOD.d)
    + rect(23, 35, 18, 2, IRON.d)                   // 铁箍
    + rect(23, 41, 18, 2, IRON.d)
    + rect(30, 30, 4, 15, WOOD.d2)                  // 箱板缝
    + rect(29, 28, 6, 3, IRON.d)                    // 吊环
  );
}
function catapultStone() { // 石弹（可挂 sling 或作独立抛射物）
  return svg(64, 64,
    disc(32, 33, 10, STONE)
    + rect(27, 30, 3, 2, STONE.d) + rect(35, 36, 4, 2, STONE.d) // 碎面
    + rect(30, 38, 2, 2, STONE.d)
  );
}

/* ===== 井阑（tpl.siege_tower） ===== */
function towerBase() { // 绑 base：底盘横梁
  return svg(64, 64,
    beam(8, 26, 48, 8, WOOD)
    + beam(8, 35, 48, 5, WOOD.d)
    + rect(14, 24, 5, 12, WOOD.d)
    + rect(45, 24, 5, 12, WOOD.d)
  );
}
function towerWall(paint) { // 塔身段（沿 -y 上方）：竖板墙
  let planks = '';
  for (let i = 1; i < 5; i++) planks += rect(20 + i * 5, 7, 1, 26, WOOD.d2);
  return svg(64, 64, block(20, 6, 24, 27, WOOD) + planks + paint);
}
function towerBody1() { // 绑 towerL1：底层塔身
  return towerWall(rect(26, 24, 12, 9, WOOD.d2)); // 底层加固裙板
}
function towerBody2() { // 绑 towerL2：中层（开箭窗）
  return towerWall(rect(28, 14, 8, 8, '#12100c') + rect(27, 13, 10, 2, WOOD.d));
}
function towerBody3() { // 绑 towerL3：顶层（旗下）
  return towerWall(rect(41, 2, 3, 9, WOOD.d2) + rect(44, 3, 7, 5, '#a03830') + rect(20, 5, 24, 2, WOOD.l));
}
function towerPlatform() { // 绑 top_platform：顶部平台 + 围栏
  let posts = '';
  for (let i = 0; i < 6; i++) posts += rect(15 + i * 7, 18, 2, 9, WOOD.d);
  return svg(64, 64,
    beam(13, 27, 38, 6, WOOD)                       // 平台板
    + rect(13, 18, 38, 2, WOOD.d)                   // 栏杆横杆
    + posts
    + rect(12, 33, 40, 2, WOOD.o)
  );
}
function towerLadder() { // 绑 ladder：爬梯（沿 -y 向上）
  let rungs = '';
  for (let i = 0; i < 5; i++) rungs += rect(24, 9 + i * 5, 16, 2, WOOD.d);
  return svg(64, 64,
    rect(23, 6, 3, 27, WOOD) + rect(38, 6, 3, 27, WOOD)
    + rungs
  );
}
function towerShield() { // 绑 shield_front：前盾（生牛皮 + 铆钉，沿 +y 垂帘）
  return svg(64, 64,
    beam(16, 30, 30, 17, HIDE)
    + rect(20, 34, 2, 2, IRON.d) + rect(30, 38, 2, 2, IRON.d) + rect(40, 34, 2, 2, IRON.d)
    + rect(16, 47, 30, 2, HIDE.d2)
  );
}

/* ===== 玩家护甲（player.json armor 槽，绑 torso，z9） ===== */
function armorLeather() { // 皮甲：护心镜 + 绑带
  return svg(64, 64,
    block(21, 16, 22, 17, LEATHER)
    + `<circle cx="32" cy="24" r="6" fill="${LEATHER.o}"/><circle cx="32" cy="24" r="5" fill="#9c7444"/><circle cx="30" cy="22" r="2" fill="#c49a60"/>` // 护心镜
    + rect(21, 20, 22, 2, LEATHER.d)                // 横绑带
    + rect(21, 30, 22, 2, LEATHER.d)
    + rect(23, 33, 3, 3, LEATHER.d2) + rect(30, 33, 3, 3, LEATHER.d2) + rect(37, 33, 3, 3, LEATHER.d2) // 下摆垂穗
  );
}
function armorIron() { // 铁甲：明光铠 + 护肩
  return svg(64, 64,
    block(19, 15, 26, 18, IRON)
    + block(15, 15, 6, 9, IRON.l) + block(43, 15, 6, 9, IRON.l) // 护肩翼
    + `<circle cx="27" cy="23" r="5" fill="${IRON.d}"/><circle cx="27" cy="23" r="4" fill="${IRON.l}"/>`
    + `<circle cx="37" cy="23" r="5" fill="${IRON.d}"/><circle cx="37" cy="23" r="4" fill="${IRON.l}"/>` // 双护心镜
    + rect(19, 31, 26, 4, IRON.d)                   // 腰甲
    + rect(23, 32, 2, 2, IRON.l) + rect(31, 32, 2, 2, IRON.l) + rect(39, 32, 2, 2, IRON.l)
    + rect(21, 35, 22, 2, IRON.d2)
  );
}

/* ---------------- 清单：name / 画布 / 绘制 / 绑定 ---------------- */
const PARTS = [
  // 狼
  { name: 'wolf-body', w: 96, draw: wolfBody, bone: 'spine', lib: 'wolf', cn: '狼皮躯干' },
  { name: 'wolf-neck', w: 64, draw: wolfNeck, bone: 'neck', lib: 'wolf', cn: '狼颈毛' },
  { name: 'wolf-head', w: 64, draw: wolfHead, bone: 'head', lib: 'wolf', cn: '狼头' },
  { name: 'wolf-jaw', w: 64, draw: wolfJaw, bone: 'jaw', lib: 'wolf', cn: '狼下颚' },
  { name: 'wolf-tail', w: 64, draw: wolfTail, bone: 'tail1', lib: 'wolf', cn: '狼尾' },
  { name: 'wolf-leg-upper', w: 64, draw: wolfLegUpper, bone: 'legFL_upper', lib: 'wolf', cn: '狼大腿' },
  { name: 'wolf-leg-lower', w: 64, draw: wolfLegLower, bone: 'legFL_lower', lib: 'wolf', cn: '狼小腿' },
  // 马
  { name: 'horse-body', w: 96, draw: horseBody, bone: 'spine', lib: 'horse', cn: '马躯干' },
  { name: 'horse-neck', w: 64, draw: horseNeck, bone: 'neck1', lib: 'horse', cn: '马颈' },
  { name: 'horse-head', w: 64, draw: horseHead, bone: 'head', lib: 'horse', cn: '马头' },
  { name: 'horse-tail', w: 64, draw: horseTail, bone: 'tail1', lib: 'horse', cn: '马尾' },
  { name: 'horse-saddle', w: 64, draw: horseSaddle, bone: 'saddle', lib: 'horse', cn: '马鞍' },
  { name: 'horse-leg-upper', w: 64, draw: horseLegUpper, bone: 'legFL_upper', lib: 'horse', cn: '马大腿' },
  { name: 'horse-leg-lower', w: 64, draw: horseLegLower, bone: 'legFL_lower', lib: 'horse', cn: '马小腿' },
  // 骑手
  { name: 'rider-torso', w: 64, draw: riderTorso, bone: 'rider_torso', lib: 'rider', cn: '骑手半身甲' },
  { name: 'rider-head', w: 64, draw: riderHead, bone: 'rider_head', lib: 'rider', cn: '骑手头' },
  { name: 'rider-arm-upper', w: 64, draw: riderArmUpper, bone: 'rider_armUL', lib: 'rider', cn: '骑手上臂' },
  { name: 'rider-arm-fore', w: 64, draw: riderArmFore, bone: 'rider_armFL', lib: 'rider', cn: '骑手前臂' },
  // 冲车
  { name: 'ram-base', w: 96, draw: ramBase, bone: 'base', lib: 'ram', cn: '冲车车体' },
  { name: 'ram-roof', w: 96, draw: ramRoof, bone: 'roof', lib: 'ram', cn: '冲车顶架' },
  { name: 'ram-cover', w: 96, draw: ramCover, bone: 'cover', lib: 'ram', cn: '顶棚蒙皮' },
  { name: 'ram-arm', w: 96, draw: ramArm, bone: 'ram_arm', lib: 'ram', cn: '撞木' },
  { name: 'ram-head', w: 64, draw: ramHead, bone: 'ram_head', lib: 'ram', cn: '撞头铁帽' },
  { name: 'ram-wheel', w: 64, draw: () => wheel(11), bone: 'wheelFL', lib: 'ram', cn: '冲车木轮' },
  { name: 'ram-pusher', w: 64, draw: ramPusher, bone: 'pusherL', lib: 'ram', cn: '推杆' },
  // 投石车
  { name: 'catapult-base', w: 96, draw: catapultBase, bone: 'base', lib: 'catapult', cn: '投石车车架' },
  { name: 'catapult-wheel', w: 64, draw: () => wheel(12), bone: 'wheelF', lib: 'catapult', cn: '投石车轮' },
  { name: 'catapult-frame', w: 64, draw: catapultFrame, bone: 'frame_winch', lib: 'catapult', cn: '绞盘支架' },
  { name: 'catapult-arm', w: 96, draw: catapultArm, bone: 'throw_arm', lib: 'catapult', cn: '抛臂' },
  { name: 'catapult-sling', w: 64, draw: catapultSling, bone: 'sling', lib: 'catapult', cn: '皮兜' },
  { name: 'catapult-weight', w: 64, draw: catapultWeight, bone: 'counterweight', lib: 'catapult', cn: '配重箱' },
  { name: 'catapult-stone', w: 64, draw: catapultStone, bone: 'sling', lib: 'catapult', cn: '石弹' },
  // 井阑
  { name: 'tower-base', w: 64, draw: towerBase, bone: 'base', lib: 'tower', cn: '井阑底盘' },
  { name: 'tower-wheel', w: 64, draw: () => wheel(10), bone: 'wheelFL', lib: 'tower', cn: '井阑木轮' },
  { name: 'tower-body-1', w: 64, draw: towerBody1, bone: 'towerL1', lib: 'tower', cn: '塔身底层' },
  { name: 'tower-body-2', w: 64, draw: towerBody2, bone: 'towerL2', lib: 'tower', cn: '塔身中层' },
  { name: 'tower-body-3', w: 64, draw: towerBody3, bone: 'towerL3', lib: 'tower', cn: '塔身顶层' },
  { name: 'tower-platform', w: 64, draw: towerPlatform, bone: 'top_platform', lib: 'tower', cn: '顶部平台' },
  { name: 'tower-ladder', w: 64, draw: towerLadder, bone: 'ladder', lib: 'tower', cn: '爬梯' },
  { name: 'tower-shield', w: 64, draw: towerShield, bone: 'shield_front', lib: 'tower', cn: '前盾蒙皮' },
  // 玩家护甲
  { name: 'armor-leather', w: 64, draw: armorLeather, bone: 'torso', lib: 'armor', cn: '皮甲', player: true },
  { name: 'armor-iron', w: 64, draw: armorIron, bone: 'torso', lib: 'armor', cn: '铁甲', player: true }
];

const SIEGE_LIBS = new Set(['ram', 'catapult', 'tower']);
const fileOf = p => p.player
  ? path.join(playerPartsDir, `${p.name}.png`)
  : path.join(outDir, `${p.name}.png`);
const manifestPathOf = p => p.player
  ? `assets/images/player/parts/${p.name}.png`
  : `assets/images/units/parts/${p.name}.png`;
const assetIdOf = p => p.player
  ? `player.parts.${p.name}`
  : `${p.lib}.parts.${p.name.replace(new RegExp(`^${p.lib}-`), '')}`;
const manifestCategoryOf = p => SIEGE_LIBS.has(p.lib) ? 'siege-part' : 'character-part';

/* ---------------- 1. 生成 PNG ---------------- */
for (const part of PARTS) {
  const file = fileOf(part);
  try {
    await sharp(Buffer.from(part.draw())).png().toFile(file);
  } catch (error) {
    throw new Error(`部件 ${part.name} 生成失败: ${error.message}`);
  }
  console.log('生成', path.relative(root, file));
}

/* ---------------- 2. 登记 manifest（assets.json，CRLF，幂等） ---------------- */
const manifestPath = path.join(root, 'example/sanguo_zhangjiao/assets/manifests/assets.json');
let manifest = readFileSync(manifestPath, 'utf8');
const eolM = '\r\n';
if (!manifest.includes(assetIdOf(PARTS[0]))) {
  const entry = p => {
    const h = 64;
    const id = assetIdOf(p);
    return `    {${eolM
      }      "assetId": "${id}",${eolM
      }      "imageId": "${id}",${eolM
      }      "category": "${manifestCategoryOf(p)}",${eolM
      }      "usage": [${eolM
      }        "skeleton-part"${eolM
      }      ],${eolM
      }      "sourceFile": "${manifestPathOf(p)}",${eolM
      }      "runtime2D": {${eolM
      }        "path": "${manifestPathOf(p)}",${eolM
      }        "mode": "image"${eolM
      }      },${eolM
      }      "runtime3D": {${eolM
      }        "mode": "billboard",${eolM
      }        "sourceAssetId": "${id}"${eolM
      }      },${eolM
      }      "pivot": {${eolM
      }        "x": 0.5,${eolM
      }        "y": 0.5${eolM
      }      },${eolM
      }      "bounds": {${eolM
      }        "width": ${p.w},${eolM
      }        "height": ${h}${eolM
      }      },${eolM
      }      "grid": {${eolM
      }        "columns": 1,${eolM
      }        "rows": 1,${eolM
      }        "cellWidth": ${p.w},${eolM
      }        "cellHeight": ${h}${eolM
      }      },${eolM
      }      "animations": [],${eolM
      }      "targetPhase": "P1",${eolM
      }      "status": "placeholder",${eolM
      }      "revision": 1${eolM
      }    }`;
  };
  const tailAnchor = manifest.lastIndexOf(eolM + '  ]');
  if (tailAnchor < 0) throw new Error('manifest 尾部锚点未找到');
  const insertAt = tailAnchor;
  manifest = manifest.slice(0, insertAt) + ',' + eolM
    + PARTS.map(entry).join(',' + eolM) + manifest.slice(insertAt);
  writeFileSync(manifestPath, manifest);
  console.log('manifest 登记', PARTS.length, '个条目');
} else {
  console.log('manifest 已登记过，跳过');
}
JSON.parse(readFileSync(manifestPath, 'utf8'));
console.log('manifest JSON 校验通过');

/* ---------------- 3. 追加 library.json skeletonParts（LF，幂等） ---------------- */
const libraryPath = path.join(root, 'example/sanguo_zhangjiao/project/library.json');
let library = readFileSync(libraryPath, 'utf8');
const eolL = '\n';
if (!library.includes('"part.wolf.body"')) {
  const entry = p => {
    const id = `part.${p.lib}.${p.name.replace(/^[a-z]+-/, '')}`;
    const fields = [
      `      "assetId": "${assetIdOf(p)}"`,
      `      "bone": "${p.bone}"`,
      `      "category": "${p.lib}"`,
      `      "height": 64`,
      `      "id": "${id}"`,
      `      "tags": [${eolL}        "${SIEGE_LIBS.has(p.lib) ? 'siege' : (p.lib === 'armor' ? 'armor' : 'creature')}"${eolL}      ]`,
      `      "width": ${p.w}`
    ];
    return `    {${eolL}${fields.join(',' + eolL)}${eolL}    }`;
  };
  const anchor = library.indexOf('"skeletonParts": [');
  if (anchor < 0) throw new Error('library skeletonParts 锚点未找到');
  const closeAt = library.indexOf(eolL + '  ]', anchor);
  if (closeAt < 0) throw new Error('library skeletonParts 结束符未找到');
  library = library.slice(0, closeAt) + ',' + eolL
    + PARTS.map(entry).join(',' + eolL) + library.slice(closeAt);
  writeFileSync(libraryPath, library);
  console.log('library.json 追加', PARTS.length, '个部件定义');
} else {
  console.log('library.json 已追加过，跳过');
}
JSON.parse(readFileSync(libraryPath, 'utf8'));
console.log('library JSON 校验通过');
console.log('全部完成：', PARTS.length, '个部件');
