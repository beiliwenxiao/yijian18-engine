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
 * build-humanoid-skeleton.mjs —— 规范人形骨骼模板 + 配套人形部件图生成。
 *
 * ## 背景（2026-10-23 用户裁定；2026-10-24 v2 按 itch「Female Hero」比例与造型语言重画）
 *   旧 player.json 骨架是「hips 直挂两臂两腿」的简化树（无脊柱分段/无肩/无颈/无脚），
 *   加剪纸式部件图，观感不像人。本脚本按业界标准人形 2D 骨骼拓扑
 *   （Spine / Unity Humanoid 同款约定）重建：
 *
 *     hips(骨盆) ── spine(腰) ── chest(胸) ── neck(颈) ── head(头)
 *        │              └──────┴── upperArmR/L ── forearmR/L
 *        └── thighR/L ── shinR/L ── footR/L
 *
 * ## 比例 v2（7 头身写实女性，身高 H=100px，head unit u≈14.3）
 *   头顶-100 / 颏-86 / 颈根-83.5 / 肩线-82 / 胸中-74 / 腰-62 / 髋-50 / 膝-24 / 踝-5 / 底 0
 *   头:颈:躯干 ≈ 1 : 0.2 : 2.5；腿长（髋→底）占 50%；肩宽 17px≈1.2 头宽（女性窄肩）；
 *   腰围 9px < 髋宽 15px（女性廓形）；上臂围 5px / 大腿围 8px（纤细四肢）。
 *   头部部件按目标尺寸 1:1 绘制（迁移时 K_HEAD=1，内容中心锚定 (32,32)）。
 *
 * ## 部件图（Female Hero 造型语言）
 *   统一深描边 + 每材质 2-3 阶明暗 + 皮革/金属点缀（护肩/袖带/护腕/腰带金扣）。
 *   程序化像素生成（sharp 合成）。输出 assets/images/player/parts-humanoid/，
 *   并重画 parts/ 下头部三态 6 张（迁移后的 player.json 实际引用这些）。
 *   骨架输出 skeletons/player-humanoid.json（模板，迁移脚本消费）。
 *
 * 用法：node scripts/skeleton-pipeline/build-humanoid-skeleton.mjs
 */

import sharp from 'sharp';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseSkeletonAsset } from '../../src/animation/SkeletonAsset.js';
import { createRestLocalPose, composeWorldTransforms, sampleClip } from '../../src/animation/SkeletonPose.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OLD_PARTS = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/parts');
const OUT_PARTS = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/parts-humanoid');
const OUT_SKELETON = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons/player-humanoid.json');
const TEMP = path.join(root, 'Temp');
mkdirSync(OUT_PARTS, { recursive: true });
mkdirSync(TEMP, { recursive: true });

/* ---------------- 1. 配色（延续角色既有色彩身份 + Female Hero 式材质点缀） ---------------- */

const C = {
  skin: '#e8b48c',
  skinDark: '#b57e52',
  hair: '#4a3526',
  hairLight: '#644833',
  cloth: '#ddd6c8',
  waist: '#c9a84c',
  pants: '#4a5a72',
  pantsDark: '#333e50',
  boot: '#6a5a4a',
  leather: '#7a5236',      // 护肩/护腕/腰带（皮革）
  leatherDark: '#54371f',
  metal: '#b8bcc4',        // 金属扣/铆钉
  metalDark: '#767c86'
};
const darken = (hex, k = 0.78) => {
  const n = parseInt(hex.slice(1), 16);
  const f = v => Math.max(0, Math.min(255, Math.round(v * k)));
  return '#' + [f(n >> 16 & 255), f(n >> 8 & 255), f(n & 255)].map(v => v.toString(16).padStart(2, '0')).join('');
};
const lighten = (hex, k = 1.18) => darken(hex, k);
console.log('配色:', JSON.stringify(C));

/* ---------------- 2. 像素部件图生成 ---------------- */

/** 像素画布工具：w×h RGBA buffer，支持矩形/椭圆（坐标一律取整——Buffer 浮点索引赋值会静默丢失） */
function canvas(w, h, outDir = OUT_PARTS) {
  const data = Buffer.alloc(w * h * 4, 0);
  const hex = v => { const n = parseInt(v.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255, 255]; };
  return {
    w, h, data, outDir,
    rect(x, y, rw, rh, color) {
      const [r, g, b, a] = hex(color);
      const x0 = Math.round(x), y0 = Math.round(y);
      for (let yy = y0; yy < y0 + Math.round(rh); yy++) for (let xx = x0; xx < x0 + Math.round(rw); xx++) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const i = (yy * w + xx) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
      }
    },
    ellipse(cx, cy, rx, ry, color) {
      const [r, g, b, a] = hex(color);
      const ccx = Math.round(cx), ccy = Math.round(cy);
      for (let yy = Math.floor(ccy - ry); yy <= ccy + ry; yy++) for (let xx = Math.floor(ccx - rx); xx <= ccx + rx; xx++) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const nx = (xx - ccx) / rx, ny = (yy - ccy) / ry;
        if (nx * nx + ny * ny <= 1) {
          const i = (yy * w + xx) * 4;
          data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
        }
      }
    },
    /** 矩形擦除（置透明）——用于发图镂空露出底下的脸。 */
    clear(x, y, rw, rh) {
      const x0 = Math.round(x), y0 = Math.round(y);
      for (let yy = y0; yy < y0 + Math.round(rh); yy++) for (let xx = x0; xx < x0 + Math.round(rw); xx++) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const i = (yy * w + xx) * 4;
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0;
      }
    },
    /** 椭圆擦除（柔和的镂空边缘）。 */
    clearEllipse(cx, cy, rx, ry) {
      const ccx = Math.round(cx), ccy = Math.round(cy);
      for (let yy = Math.floor(ccy - ry); yy <= ccy + ry; yy++) for (let xx = Math.floor(ccx - rx); xx <= ccx + rx; xx++) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const nx = (xx - ccx) / rx, ny = (yy - ccy) / ry;
        if (nx * nx + ny * ny <= 1) {
          const i = (yy * w + xx) * 4;
          data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0;
        }
      }
    },
    async save(file) {
      await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toFile(path.join(this.outDir, file));
    }
  };
}

/** 柱体（带左亮右暗+两侧描边的体积感）：宽度随高度可变 */
function limb(w, h, topW, botW, color, colorDark, outline = '#1f1812') {
  const c = canvas(w, h);
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    const halfW = Math.max(1, Math.round((topW + (botW - topW) * t) / 2));
    const cx = Math.floor(w / 2);
    c.rect(cx - halfW, y, halfW * 2, 1, color);
    c.rect(cx + Math.max(0, halfW - Math.max(1, Math.round(halfW * 0.45))), y, Math.max(1, Math.round(halfW * 0.45)), 1, colorDark);
    // 两侧描边（与躯干/背景分离）
    c.rect(cx - halfW, y, 1, 1, outline);
    c.rect(cx + halfW - 1, y, 1, 1, outline);
  }
  return c;
}

const PARTS = {};

/* ---------------- 绘制工具补充 ---------------- */

/** 单像素落点（坐标取整，避免 Buffer 浮点索引被静默丢弃）。 */
function pixel(c, x, y, color) {
  c.rect(Math.round(x), Math.round(y), 1, 1, color);
}

/** 水平线（含端点）。 */
function hline(c, x0, x1, y, color) {
  const a = Math.round(Math.min(x0, x1));
  const b = Math.round(Math.max(x0, x1));
  c.rect(a, Math.round(y), b - a + 1, 1, color);
}

/** 垂直线（含端点）。 */
function vline(c, x, y0, y1, color) {
  const a = Math.round(Math.min(y0, y1));
  const b = Math.round(Math.max(y0, y1));
  c.rect(Math.round(x), a, 1, b - a + 1, color);
}

/** 斜线（Bresenham 简化，用于锁骨/筋腱等细节线）。 */
function line(c, x0, y0, x1, y1, color) {
  let x = Math.round(x0), y = Math.round(y0);
  const ex = Math.round(x1), ey = Math.round(y1);
  const dx = Math.abs(ex - x), dy = -Math.abs(ey - y);
  const sx = x < ex ? 1 : -1, sy = y < ey ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 64; guard++) {
    pixel(c, x, y, color);
    if (x === ex && y === ey) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

const OUTLINE = '#241a12';       // 统一深描边
const OUTLINE_SOFT = '#3a2a1e';  // 次级描边（发丝/布料折痕）

/* ---- 头（模板自用；游戏实际引用 parts/ 三态头图，见 2.5 节）16×18 ---- */
{
  const c = canvas(16, 18);
  const cx = 8;
  // 后发
  c.ellipse(cx, 8, 6.2, 5, C.hair);
  // 脸
  c.ellipse(cx, 10.5, 4.8, 6, OUTLINE);
  c.ellipse(cx, 10.3, 4.1, 5.3, C.skin);
  c.rect(cx - 3.6, 9.4, 7.2, 4.6, C.skin);
  // 耳
  c.ellipse(cx - 4.4, 10.5, 0.9, 1.4, C.skin);
  c.ellipse(cx + 4.4, 10.5, 0.9, 1.4, C.skin);
  // 眉
  hline(c, cx - 3, cx - 1.4, 8.3, C.hair);
  hline(c, cx + 1.4, cx + 3, 8.3, C.hair);
  // 眼（2×2：眼白+瞳+高光+上睑）
  c.rect(cx - 2.6, 9.4, 1.6, 1.6, '#f4ece2');
  c.rect(cx + 1, 9.4, 1.6, 1.6, '#f4ece2');
  pixel(c, cx - 1.8, 10.1, '#241c16');
  pixel(c, cx + 1.8, 10.1, '#241c16');
  pixel(c, cx - 2.3, 9.6, '#ffffff');
  pixel(c, cx + 1.1, 9.6, '#ffffff');
  hline(c, cx - 2.7, cx - 1, 9.1, C.hair);
  hline(c, cx + 1, cx + 2.7, 9.1, C.hair);
  // 鼻 / 嘴
  vline(c, cx + 0.3, 11.2, 12.2, darken(C.skinDark, 0.92));
  pixel(c, cx - 0.2, 12.5, C.skin);
  hline(c, cx - 1.2, cx + 1.2, 13.6, darken(C.skinDark, 0.8));
  // 刘海（三缕弧形）+ 顶部发髻
  c.ellipse(cx - 3.2, 7.4, 2.6, 2, C.hair);
  c.ellipse(cx + 3.2, 7.4, 2.6, 2, C.hair);
  c.ellipse(cx, 6.8, 3.4, 2, C.hair);
  c.ellipse(cx, 2, 2.6, 1.9, C.hair);
  pixel(c, cx - 0.8, 1.4, C.hairLight);
  hline(c, cx - 2.4, cx + 2.4, 3.6, C.hairLight);
  line(c, cx - 4.4, 6, cx - 1.6, 7.8, C.hairLight);
  PARTS['head.png'] = c;
}

/* ---- 颈 6×6：肤色短柱 + 颌下阴影 ---- */
{
  const c = canvas(6, 6);
  c.rect(1.7, 0, 2.6, 6, C.skin);
  c.rect(3.3, 0, 1, 6, C.skinDark);
  hline(c, 1.7, 4.3, 0.5, darken(C.skinDark, 0.8));
  PARTS['neck.png'] = c;
}

/* ---- 胸 26×20：小护肩（皮革）+ 抹胸 + 收腰 —— img y0=世界-85，cy10=世界-75 ---- */
{
  const c = canvas(26, 20);
  const cx = 13;

  // 躯干：窄肩细腰（女性廓形）——胸宽 10 → 腰 9（先画躯干，护肩压在臂顶上方）
  c.ellipse(cx, 11.5, 5.8, 7.8, OUTLINE_SOFT);
  c.ellipse(cx, 11.3, 5, 7.2, C.skin);
  c.rect(8.4, 8, 9.2, 13, C.skin);
  // 体侧描边
  vline(c, 8.2, 9, 17, OUTLINE_SOFT);
  vline(c, 17.8, 9, 17, OUTLINE_SOFT);

  // 锁骨（两段短斜线）
  line(c, 10.2, 7.4, 12, 8.2, darken(C.skinDark, 0.9));
  line(c, 15.8, 7.4, 14, 8.2, darken(C.skinDark, 0.9));

  // 抹胸：与躯干同宽 + V 领 + 胸部两团弱阴影 + 下缘
  c.rect(8.2, 9.4, 9.6, 7.6, C.cloth);
  c.rect(8.2, 9.4, 9.6, 1, lighten(C.cloth, 1.12));
  line(c, cx, 9.6, 11.6, 12, darken(C.cloth, 0.9));
  line(c, cx, 9.6, 14.4, 12, darken(C.cloth, 0.9));
  c.ellipse(10.8, 12, 1.6, 1.3, darken(C.cloth, 0.93));
  c.ellipse(15.2, 12, 1.6, 1.3, darken(C.cloth, 0.93));
  hline(c, 8.2, 17.8, 16.8, darken(C.cloth, 0.8));

  // 腰腹露肤（y17-20 = 世界-68..-65，下接腰裙图的上缘皮肤）
  c.rect(8.6, 16.8, 8.8, 3.4, C.skin);
  pixel(c, cx, 18.6, darken(C.skinDark, 0.9));
  c.rect(15.6, 16.8, 1.6, 3.2, C.skinDark);

  // 皮革护肩（肩关节 ±8.5 → img x 4.5/21.5，肩线 y3=世界-82；外移半格避开臂柱正盖）
  for (const sx of [3.9, 22.1]) {
    c.ellipse(sx, 3.2, 3.3, 2.8, OUTLINE);
    c.ellipse(sx, 3.1, 2.7, 2.2, C.leather);
    c.ellipse(sx - (sx < cx ? 0.7 : -0.7), 2.2, 1.5, 1.1, lighten(C.leather, 1.3));
    pixel(c, sx, 3.3, C.metal);
  }
  PARTS['chest.png'] = c;
}

/* ---- 腰 14×12：腰带（皮革+金扣）+ 裙褶 —— img y0=世界-64，挂 spine(-62) 偏移 +4 ---- */
{
  const c = canvas(14, 12);
  // 上缘露肤衔接
  c.rect(3.5, 0, 7, 1.4, C.skin);
  // 腰带
  c.rect(1.4, 1.2, 11.2, 2.8, OUTLINE);
  c.rect(1.6, 1.4, 10.8, 2.2, C.leather);
  c.rect(1.6, 1.4, 10.8, 0.9, lighten(C.leather, 1.28));
  c.rect(6.1, 1.5, 1.8, 1.9, C.waist);          // 金扣
  pixel(c, 6.5, 1.9, C.metal);
  // 裙摆（微外扩的女性髋部廓形）
  c.ellipse(7, 8.6, 6.7, 3.9, OUTLINE_SOFT);
  c.ellipse(7, 8.4, 6, 3.5, C.waist);
  c.rect(2.2, 3.9, 9.6, 7.6, C.waist);
  c.rect(2.2, 3.9, 9.6, 1, lighten(C.waist, 1.3));
  vline(c, 4.6, 5.2, 10.8, darken(C.waist, 0.86));
  vline(c, 9.4, 5.2, 10.8, darken(C.waist, 0.86));
  hline(c, 2.2, 11.8, 10.9, darken(C.waist, 0.78));
  PARTS['waist.png'] = c;
}

/* ---- 上臂 7×17：臂带（皮革）+ 二头肌体积 + 肘收窄 ---- */
{
  const c = limb(7, 17, 5, 4, C.skin, C.skinDark);
  c.ellipse(3.5, 1.4, 2.6, 1.6, C.skin);
  c.rect(1.2, 0.6, 4.6, 2.6, OUTLINE);
  c.rect(1.4, 0.8, 4.2, 2, C.leather);           // 臂带
  hline(c, 1.4, 5.6, 1, lighten(C.leather, 1.25));
  c.ellipse(3.5, 15.6, 2.1, 1.7, C.skin);
  vline(c, 4.9, 4, 12, darken(C.skin, 0.93));
  vline(c, 2.1, 3, 12, lighten(C.skin, 1.07));
  PARTS['upper-arm.png'] = c;
}

/* ---- 前臂+手 7×19：护腕（皮革+绑带）+ 手掌 ---- */
{
  const c = limb(7, 14, 4.4, 3.6, C.skin, C.skinDark);
  c.rect(1.3, 7.2, 4.4, 6.8, OUTLINE);
  c.rect(1.5, 7.4, 4, 6.2, C.leather);           // 护腕
  c.rect(1.5, 7.4, 4, 1, lighten(C.leather, 1.2));
  hline(c, 1.5, 5.5, 9.4, C.leatherDark);        // 绑带两道
  hline(c, 1.5, 5.5, 11.6, C.leatherDark);
  // 手（y14-19）
  c.rect(2.1, 14, 2.8, 1.6, C.skin);
  c.ellipse(3.5, 16.4, 2.3, 2.6, C.skin);
  c.rect(2.2, 17.6, 2.8, 1.2, C.skin);
  vline(c, 3.4, 16.8, 18.6, darken(C.skin, 0.9));
  vline(c, 4.6, 15.2, 16.4, C.skinDark);
  PARTS['forearm.png'] = c;
}

/* ---- 大腿 9×26：裤（腰部收窄带 + 股肌体积 + 膝） ---- */
{
  const c = limb(9, 26, 8, 5.5, C.pants, C.pantsDark);
  c.rect(1, 0.2, 7, 2, darken(C.pants, 0.7));    // 裤腰衔接带
  vline(c, 2.6, 4, 19, darken(C.pants, 0.88));
  vline(c, 6.2, 5, 17, darken(C.pants, 0.92));
  c.ellipse(4.5, 24.2, 2.4, 1.8, C.pants);
  PARTS['thigh.png'] = c;
}

/* ---- 小腿 8×21：裤 + 小腿肚高光 + 靴（皮带扣风） ---- */
{
  const c = limb(8, 21, 5.5, 3.6, C.pants, C.pantsDark);
  c.ellipse(3.2, 5.5, 1.8, 3, lighten(C.pants, 1.1));
  c.rect(1.4, 12, 5.2, 9, OUTLINE);
  c.rect(1.6, 12.2, 4.8, 8.6, C.boot);           // 靴筒
  c.rect(1.6, 12.2, 4.8, 1.2, lighten(C.boot, 1.25));
  pixel(c, 4, 13.6, C.metal);                    // 靴扣
  c.rect(1.6, 19.4, 4.8, 1.6, darken(C.boot, 0.7));
  PARTS['shin.png'] = c;
}

/* ---- 脚 12×5（side 形态，朝 +x 侧影）：踝孔顶边贴图像上沿（踝关节点 = 图内 (3.2, 0)），
 *      鞋底暗条占满图像底边（图内 y=5）→ 踝到鞋底 = 5px = 世界踝(-5) 到地面(0) ---- */
{
  const c = canvas(12, 5);
  c.ellipse(3.2, 2.5, 2.9, 2.5, OUTLINE);
  c.ellipse(3.2, 2.5, 2.3, 1.9, C.boot);
  c.rect(2.6, 0.6, 8.6, 3.6, C.boot);
  c.rect(2.6, 0.6, 8, 1, lighten(C.boot, 1.22));
  c.rect(2.2, 3.6, 9.2, 1.4, darken(C.boot, 0.7));
  PARTS['foot.png'] = c;
}

/* ---- 脚 12×5 正面（down 形态）：脚尖朝观察者 → 图内朝下 ----
 * 锚点约定（与 side 形态统一）：踝关节点 = 图内 (6,0)，鞋底 = 图像底边 y=5（落差 5px） ---- */
{
  const c = canvas(12, 5);
  c.rect(4.2, 0, 3.6, 2.2, OUTLINE);           // 靴口（踝孔）
  c.rect(4.4, 0.2, 3.2, 2, C.boot);
  c.ellipse(6, 3.2, 3.6, 1.9, OUTLINE);          // 鞋头（朝下）
  c.ellipse(6, 3.2, 3.1, 1.5, C.boot);
  c.rect(3, 3.2, 6, 0.9, lighten(C.boot, 1.18));
  c.rect(2.6, 4.1, 6.8, 0.9, darken(C.boot, 0.7));  // 鞋底（接地行）
  PARTS['foot-down.png'] = c;
}

/* ---- 脚 12×5 背面（up 形态）：脚跟朝观察者 → 图内朝下 ---- */
{
  const c = canvas(12, 5);
  c.rect(4.4, 0, 3.2, 2, OUTLINE);
  c.rect(4.6, 0.2, 2.8, 1.8, darken(C.boot, 0.9));
  c.ellipse(6, 3.3, 2.9, 1.7, OUTLINE);            // 鞋跟
  c.ellipse(6, 3.3, 2.5, 1.3, C.boot);
  c.rect(3.5, 4.2, 5, 0.8, darken(C.boot, 0.72));
  PARTS['foot-up.png'] = c;
}

/* ---- 胸 26×20 侧面（side 形态）：身体侧影窄，胸口朝 +x，近侧单护肩 ---- */
{
  const c = canvas(26, 20);
  const cx = 13;
  // 躯干侧影（窄）
  c.ellipse(cx, 11.5, 4.6, 7.6, OUTLINE_SOFT);
  c.ellipse(cx, 11.3, 3.9, 7, C.skin);
  c.rect(cx - 3.9, 8, 7.8, 13, C.skin);
  // 胸前凸（朝 +x）
  c.ellipse(cx + 3.2, 12.2, 2.1, 1.9, OUTLINE_SOFT);
  c.ellipse(cx + 3.2, 12.2, 1.7, 1.5, C.skin);
  // 侧面抹胸（斜挂带）
  c.rect(cx - 4.2, 9.6, 8.4, 7.2, C.cloth);
  c.rect(cx - 4.2, 9.6, 8.4, 1, lighten(C.cloth, 1.12));
  line(c, cx - 3.6, 10, cx + 3.6, 13.4, darken(C.cloth, 0.88));
  line(c, cx + 3.6, 10, cx - 3.6, 13.4, darken(C.cloth, 0.88));
  hline(c, cx - 4.2, cx + 4.2, 16.6, darken(C.cloth, 0.8));
  // 腰腹露肤
  c.rect(cx - 3.8, 16.8, 7.6, 3.2, C.skin);
  c.rect(cx + 2.2, 16.8, 1.6, 3.2, C.skinDark);
  // 近侧护肩（臂在侧视收拢到体轴附近）
  c.ellipse(cx - 2.6, 3.2, 3.2, 2.7, OUTLINE);
  c.ellipse(cx - 2.6, 3.1, 2.6, 2.1, C.leather);
  c.ellipse(cx - 3.2, 2.2, 1.4, 1, lighten(C.leather, 1.3));
  pixel(c, cx - 2.6, 3.3, C.metal);
  PARTS['chest-side.png'] = c;
}

/* ---- 胸 26×20 背面（up 形态）：宽肩、无胸口开口，背部皮革束带 ---- */
{
  const c = canvas(26, 20);
  const cx = 13;
  c.ellipse(cx, 11.5, 5.8, 7.8, OUTLINE_SOFT);
  c.ellipse(cx, 11.3, 5, 7.2, C.skin);
  c.rect(8.4, 8, 9.2, 13, C.skin);
  vline(c, 8.2, 9, 17, OUTLINE_SOFT);
  vline(c, 17.8, 9, 17, OUTLINE_SOFT);
  // 背部斜方肌 + 皮革 Y 型束带（取代正面的抹胸开口）
  line(c, 10.2, 7.6, 12.4, 10.4, darken(C.skinDark, 0.9));
  line(c, 15.8, 7.6, 13.6, 10.4, darken(C.skinDark, 0.9));
  line(c, 12.4, 10.2, 11.2, 17, C.leather);
  line(c, 13.6, 10.2, 14.8, 17, C.leather);
  hline(c, 8.4, 17.6, 13.2, C.leather);
  hline(c, 8.4, 17.6, 14.4, darken(C.leather, 0.8));
  // 腰背露肤
  c.rect(8.6, 16.8, 8.8, 3.2, C.skin);
  c.rect(15.6, 16.8, 1.6, 3.2, C.skinDark);
  // 双护肩
  for (const sx of [3.9, 22.1]) {
    c.ellipse(sx, 3.2, 3.3, 2.8, OUTLINE);
    c.ellipse(sx, 3.1, 2.7, 2.2, C.leather);
    c.ellipse(sx - (sx < cx ? 0.7 : -0.7), 2.2, 1.5, 1.1, lighten(C.leather, 1.3));
    pixel(c, sx, 3.3, C.metal);
  }
  PARTS['chest-up.png'] = c;
}

/* ---- 腰 14×12 侧面（side 形态）：窄腰侧影 + 单侧胯部 ---- */
{
  const c = canvas(14, 12);
  c.rect(4, 0, 6, 1.4, C.skin);
  c.rect(3, 1.2, 8.4, 2.8, OUTLINE);
  c.rect(3.2, 1.4, 8, 2.2, C.leather);
  c.rect(3.2, 1.4, 8, 0.9, lighten(C.leather, 1.28));
  c.rect(4, 1.6, 1.6, 1.8, C.waist);           // 侧扣
  pixel(c, 4.6, 2, C.metal);
  c.ellipse(7, 8.6, 5.2, 3.9, OUTLINE_SOFT);    // 胯/裙侧影
  c.ellipse(7, 8.4, 4.6, 3.5, C.waist);
  c.rect(2.8, 3.9, 8.4, 7.6, C.waist);
  c.rect(2.8, 3.9, 8.4, 1, lighten(C.waist, 1.3));
  vline(c, 5.4, 5.2, 10.8, darken(C.waist, 0.86));
  hline(c, 2.8, 11.2, 10.9, darken(C.waist, 0.78));
  PARTS['waist-side.png'] = c;
}

/* ---- 腰 14×12 背面（up 形态）：无前扣，后腰封边 + 双裙瓣 ---- */
{
  const c = canvas(14, 12);
  c.rect(3.5, 0, 7, 1.4, C.skin);
  c.rect(1.4, 1.2, 11.2, 2.8, OUTLINE);
  c.rect(1.6, 1.4, 10.8, 2.2, C.leather);
  c.rect(1.6, 1.4, 10.8, 0.9, lighten(C.leather, 1.28));
  c.rect(5.9, 1.5, 2.2, 1.9, darken(C.leather, 0.86));  // 后腰扣（无金扣高光）
  c.ellipse(7, 8.6, 6.7, 3.9, OUTLINE_SOFT);
  c.ellipse(7, 8.4, 6, 3.5, C.waist);
  c.rect(2.2, 3.9, 9.6, 7.6, C.waist);
  c.rect(2.2, 3.9, 9.6, 1, lighten(C.waist, 1.3));
  vline(c, 4.8, 5.2, 10.8, darken(C.waist, 0.86));
  vline(c, 9.2, 5.2, 10.8, darken(C.waist, 0.86));
  vline(c, 7, 4.2, 10.8, darken(C.waist, 0.8));    // 臀缝
  hline(c, 2.2, 11.8, 10.9, darken(C.waist, 0.78));
  PARTS['waist-up.png'] = c;
}

// 背挂（斧，简化，配色随旧斧）
PARTS['axe.png'] = (() => {
  const c = canvas(18, 26);
  c.rect(8, 2, 2.6, 22, '#8a6a42');            // 柄
  c.ellipse(9, 5, 7, 5.5, '#9aa2a8');          // 刃
  c.ellipse(7, 5, 3.4, 4.2, '#c8d0d6');
  return c;
})();

/* ---------------- 2.5 旧资产重画：玩家头部三态（迁移后的 player.json 实际引用这些） ----------------
 * player.json 的头/发槽位引用 parts/ 下的旧资产（player.parts.head-front / hair-heroine-*），
 * 新图 headSlot 并不被游戏使用——三态机制要求脸/发分件，故这里重画旧资产。
 * 统一 64×64 画布、内容按 7 头身目标尺寸 1:1 绘制且内容中心对齐画布中心 (32,32)
 * （迁移脚本实测 alpha bbox 中心做锚定，同心绘制保证脸/发相对位置正确）。
 * 输出仍为原文件名（parts/ 目录），manifest 登记的 assetId 不变。 */

const LEGACY_DIR = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/parts');

/** 脸（正面）：内容 12×14 居中 (32,32) —— 对应世界脸中心 = head 骨 origin-86 上方 7px */
function legacyFaceFront() {
  const c = canvas(64, 64, LEGACY_DIR);
  const cx = 32, cy = 32;
  // 脸型：外描边 + 内肤色（尖下巴的女性脸）
  c.ellipse(cx, cy + 0.4, 6.2, 7.4, OUTLINE);
  c.ellipse(cx, cy + 0.2, 5.5, 6.7, C.skin);
  c.rect(cx - 5, cy - 2.4, 10, 7, C.skin);
  // 右侧脸阴影（受光在左）
  c.ellipse(cx + 3.6, cy + 0.8, 1.7, 4.8, C.skinDark);
  pixel(c, cx + 4.6, cy + 2.4, darken(C.skinDark, 0.9));
  // 耳
  c.ellipse(cx - 5.8, cy + 0.4, 1, 1.6, C.skin);
  c.ellipse(cx + 5.8, cy + 0.4, 1, 1.6, C.skin);
  // 眉（2px 短线）
  hline(c, cx - 3.6, cx - 1.6, cy - 3.4, C.hair);
  hline(c, cx + 1.6, cx + 3.6, cy - 3.4, C.hair);
  // 眼（2×2：眼白+瞳+高光+上睑压线）
  c.rect(cx - 3.2, cy - 2.4, 2, 2, '#f4ece2');
  c.rect(cx + 1.2, cy - 2.4, 2, 2, '#f4ece2');
  pixel(c, cx - 2.4, cy - 1.6, '#241c16');
  pixel(c, cx + 2.4, cy - 1.6, '#241c16');
  pixel(c, cx - 2.9, cy - 2.1, '#ffffff');
  pixel(c, cx + 1.7, cy - 2.1, '#ffffff');
  hline(c, cx - 3.3, cx - 1.4, cy - 2.9, C.hair);
  hline(c, cx + 1.4, cx + 3.3, cy - 2.9, C.hair);
  // 鼻（短线阴影+鼻尖亮点）
  vline(c, cx + 0.4, cy + 0.4, cy + 1.8, darken(C.skinDark, 0.92));
  pixel(c, cx - 0.2, cy + 2.1, C.skin);
  // 嘴（微抿短弧）
  hline(c, cx - 1.3, cx + 1.3, cy + 4, darken(C.skinDark, 0.8));
  pixel(c, cx - 1.7, cy + 3.6, darken(C.skinDark, 0.86));
  pixel(c, cx + 1.7, cy + 3.6, darken(C.skinDark, 0.86));
  return c;
}

/** 侧脸：鼻梁朝左，含单眼与耳 */
function legacyFaceSide() {
  const c = canvas(64, 64, LEGACY_DIR);
  const cx = 31.5, cy = 32;
  c.ellipse(cx, cy + 0.4, 5.8, 7, OUTLINE);
  c.ellipse(cx + 0.3, cy + 0.2, 5.1, 6.3, C.skin);
  c.rect(cx - 4.4, cy - 2.4, 9.4, 6.6, C.skin);
  // 鼻梁（左侧凸出）
  c.ellipse(cx - 5.6, cy + 1, 1, 1.3, C.skin);
  pixel(c, cx - 6.4, cy + 0.8, OUTLINE);
  // 下巴阴影
  c.ellipse(cx + 3.4, cy + 1, 1.8, 4.6, C.skinDark);
  // 耳（后侧）
  c.ellipse(cx + 4.2, cy + 0.4, 1.2, 1.8, C.skin);
  pixel(c, cx + 4.2, cy + 0.5, darken(C.skinDark, 0.9));
  // 眉 + 单眼（偏脸前部）
  hline(c, cx - 4.4, cx - 2.4, cy - 3.2, C.hair);
  c.rect(cx - 4, cy - 2.3, 1.9, 1.9, '#f4ece2');
  pixel(c, cx - 3.3, cy - 1.5, '#241c16');
  pixel(c, cx - 3.7, cy - 2, '#ffffff');
  hline(c, cx - 4.1, cx - 2.2, cy - 2.8, C.hair);
  // 鼻底阴影 + 嘴
  pixel(c, cx - 5.2, cy + 2.3, darken(C.skinDark, 0.9));
  hline(c, cx - 4.8, cx - 2.8, cy + 3.8, darken(C.skinDark, 0.8));
  return c;
}

/** 后脑：只有头型与耳廓，无五官 */
function legacyFaceBack() {
  const c = canvas(64, 64, LEGACY_DIR);
  const cx = 32, cy = 32;
  c.ellipse(cx, cy + 0.4, 6.2, 7.2, OUTLINE);
  c.ellipse(cx, cy + 0.2, 5.5, 6.5, C.skin);
  c.rect(cx - 5, cy - 2.4, 10, 7, C.skin);
  c.ellipse(cx + 3.4, cy + 0.8, 2, 5, C.skinDark);
  c.ellipse(cx - 5.8, cy + 0.4, 1, 1.6, C.skin);
  c.ellipse(cx + 5.8, cy + 0.4, 1, 1.6, C.skin);
  return c;
}

/** 前发：crown 顶从 y≈23.4 起（脸顶上方 1.6px，7 头身发量）+ 三缕刘海 + 两侧垂发，中部镂空露脸 */
function legacyHairFront() {
  const c = canvas(64, 64, LEGACY_DIR);
  const cx = 32;
  // 后层 bulk（垂到颌下）
  c.ellipse(cx, 35, 6.8, 6.2, C.hair);
  // crown（顶 y23.4）
  c.ellipse(cx, 28.2, 7.6, 4.8, C.hair);
  c.rect(cx - 7.6, 26, 15.2, 3.4, C.hair);
  hline(c, cx - 3.4, cx + 3.4, 24.6, C.hairLight);   // 束发带高光
  // 三缕刘海（压额到 y≈28.5，不过眉线 y28.6）
  c.ellipse(cx - 4.2, 27.2, 3.3, 2, C.hair);
  c.ellipse(cx + 4.2, 27.2, 3.3, 2, C.hair);
  c.ellipse(cx, 26.8, 4.3, 2, C.hair);
  // 两侧垂发（贴脸到颌 y38.6）
  c.ellipse(cx - 6.4, 32.8, 1.6, 5.8, C.hair);
  c.ellipse(cx + 6.4, 32.8, 1.6, 5.8, C.hair);
  // 发丝高光
  line(c, cx - 5.4, 25, cx - 2.6, 27.2, C.hairLight);
  line(c, cx + 5.4, 25, cx + 2.6, 27.2, C.hairLight);
  // 镂空露脸（y28.9-38.9：眉眼口全露出）
  c.clearEllipse(cx, 33.9, 5.5, 5);
  return c;
}

/** 侧发：脸朝左 → 前刘海在左、后脑长发+低马尾在右；镂空露侧脸 */
function legacyHairSide() {
  const c = canvas(64, 64, LEGACY_DIR);
  const cx = 31.5;
  // crown（顶 y23.4，略偏右盖住后颅）
  c.ellipse(cx + 0.5, 28.2, 7.4, 4.8, C.hair);
  c.rect(cx - 6.9, 26, 15.8, 3.6, C.hair);
  hline(c, cx - 3, cx + 4, 24.6, C.hairLight);
  // 前刘海（左）
  c.ellipse(cx - 4.6, 27.4, 3.2, 2, C.hair);
  c.ellipse(cx - 0.6, 26.8, 3.6, 2, C.hair);
  // 鬓角
  c.ellipse(cx - 5.8, 31.6, 1.3, 3.6, C.hair);
  // 后脑长发 + 低马尾（右，垂到 y46）
  c.ellipse(cx + 6.6, 34.5, 3, 6.5, C.hair);
  c.ellipse(cx + 7.4, 42.5, 2.2, 4, C.hair);
  // 发丝高光
  line(c, cx - 5, 25, cx - 2.2, 27.4, C.hairLight);
  line(c, cx + 5.4, 27, cx + 7, 33, C.hairLight);
  // 镂空露侧脸（脸前部偏左下）
  c.clearEllipse(cx - 1.6, 33.9, 4.8, 5);
  return c;
}

/** 后发：整片后脑发（无镂空），crown 顶 y23.4，中缝线 + 垂发两缕到 y43 */
function legacyHairBack() {
  const c = canvas(64, 64, LEGACY_DIR);
  const cx = 32;
  c.ellipse(cx, 28.4, 7.6, 5, C.hair);
  c.rect(cx - 7.6, 26, 15.2, 6, C.hair);
  hline(c, cx - 3.4, cx + 3.4, 24.6, C.hairLight);
  c.ellipse(cx - 5.8, 38.5, 2.6, 5, C.hair);
  c.ellipse(cx + 5.8, 38.5, 2.6, 5, C.hair);
  vline(c, cx, 26, 33, darken(C.hair, 0.8));       // 中缝
  line(c, cx - 5.2, 26.5, cx - 2.6, 33, C.hairLight);
  line(c, cx + 5.2, 26.5, cx + 2.6, 33, C.hairLight);
  return c;
}

const LEGACY_PARTS = {
  'head-front.png': legacyFaceFront(),
  'head-side.png': legacyFaceSide(),
  'head-back.png': legacyFaceBack(),
  'hair-heroine-front.png': legacyHairFront(),
  'hair-heroine-side.png': legacyHairSide(),
  'hair-heroine-back.png': legacyHairBack()
};
for (const [file, c] of Object.entries(LEGACY_PARTS)) await c.save(file);
console.log(`旧资产重画: ${Object.keys(LEGACY_PARTS).length} 个 → ${path.relative(root, LEGACY_DIR)}`);

for (const [file, c] of Object.entries(PARTS)) await c.save(file);
console.log(`部件图生成: ${Object.keys(PARTS).length} 个 → ${path.relative(root, OUT_PARTS)}`);

/* ---------------- 2.6 manifest 登记（parts-humanoid 全部部件图，幂等） ----------------
 * 形态变体图（chest-side/chest-up/waist-side/waist-up/foot-down/foot-up）也要登记：
 * 运行时靠 attachment.directionOffsets[form].assetId 换图，未登记 = 加载失败 = 空白。 */
{
  const MANIFEST_PREFIX = 'player.humanoid.';
  const manifestPath = path.join(root, 'example/sanguo_zhangjiao/assets/manifests/assets.json');
  const raw = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw.replace(/^\uFEFF/, ''));
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const known = new Set(manifest.assets.map(a => a.assetId));
  let added = 0;
  for (const [file] of Object.entries(PARTS)) {
    const id = MANIFEST_PREFIX + file.replace(/\.png$/, '');
    if (known.has(id)) continue;
    const meta = await sharp(path.join(OUT_PARTS, file)).metadata();
    manifest.assets.push({
      assetId: id,
      imageId: id,
      category: 'character-part',
      usage: ['player-skeleton-part'],
      sourceFile: `assets/images/player/parts-humanoid/${file}`,
      runtime2D: { path: `assets/images/player/parts-humanoid/${file}`, mode: 'image' },
      runtime3D: { mode: 'billboard', sourceAssetId: id },
      pivot: { x: 0.5, y: 0.5 },
      bounds: { width: meta.width, height: meta.height },
      animations: [],
      targetPhase: 'P1',
      status: 'ai-generated',
      revision: 1
    });
    added++;
  }
  if (added) {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2).replace(/\n/g, eol) + eol, 'utf8');
    console.log(`manifest 登记: 新增 ${added} 个部件图条目`);
  } else {
    console.log('manifest 登记: 全部已存在，跳过');
  }
}

/* ---------------- 3. 骨架 JSON 组装（7 头身，脚底 = y0，头顶 = y-100） ---------------- */

const P = 'player.humanoid.';
// 部件图用原尺寸渲染（不写 width/height，运行时回退 img 原尺寸）
const slot = (id, bone, z, part, x, y) => ({
  id, bone, z,
  attachment: { type: 'image', assetId: P + part, partId: 'part.humanoid.' + part.replace('.png', ''), x, y, rot: 0, visible: true }
});

// 镜像挂图：右臂/右腿用同图（引擎 slot 无 flip，直接同图对称柱体看不出差异）
const doc = {
  schemaVersion: 1,
  skeletonId: 'skeleton.player-humanoid',
  meta: { width: 96, height: 96, coordinateSpace: 'canonical-v1', headProportionApplied: true },
  defaultClip: 'idle_down',
  bones: [
    { id: 'hips', parent: null, x: 0, y: -50, rot: 0, scaleX: 1, scaleY: 1, length: 12 },
    { id: 'spine', parent: 'hips', x: 0, y: -12, rot: 0, scaleX: 1, scaleY: 1, length: 12 },
    { id: 'chest', parent: 'spine', x: 0, y: -12, rot: 0, scaleX: 1, scaleY: 1, length: 9 },
    { id: 'neck', parent: 'chest', x: 0, y: -9.5, rot: 0, scaleX: 1, scaleY: 1, length: 3 },
    { id: 'head', parent: 'neck', x: 0, y: -2.5, rot: 0, scaleX: 1, scaleY: 1, length: 14 },
    { id: 'upperArmR', parent: 'chest', x: -8.5, y: -8, rot: 4, scaleX: 1, scaleY: 1, length: 17 },
    { id: 'upperArmL', parent: 'chest', x: 8.5, y: -8, rot: -4, scaleX: 1, scaleY: 1, length: 17 },
    { id: 'forearmR', parent: 'upperArmR', x: 0, y: 17, rot: 0, scaleX: 1, scaleY: 1, length: 15 },
    { id: 'forearmL', parent: 'upperArmL', x: 0, y: 17, rot: 0, scaleX: 1, scaleY: 1, length: 15 },
    { id: 'thighR', parent: 'hips', x: -3.5, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 26 },
    { id: 'thighL', parent: 'hips', x: 3.5, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 26 },
    { id: 'shinR', parent: 'thighR', x: 0, y: 26, rot: 0, scaleX: 1, scaleY: 1, length: 19 },
    { id: 'shinL', parent: 'thighL', x: 0, y: 26, rot: 0, scaleX: 1, scaleY: 1, length: 19 },
    { id: 'footR', parent: 'shinR', x: 0, y: 19, rot: -90, scaleX: 1, scaleY: 1, length: 7 },
    { id: 'footL', parent: 'shinL', x: 0, y: 19, rot: -90, scaleX: 1, scaleY: 1, length: 7 }
  ],
  slots: [
    slot('axeBack', 'chest', 1, 'axe.png', -13, -6),
    slot('armUR', 'upperArmR', 3, 'upper-arm.png', 0, 8),
    slot('armUL', 'upperArmL', 4, 'upper-arm.png', 0, 8),
    slot('legThighR', 'thighR', 5, 'thigh.png', 0, 13),
    slot('legThighL', 'thighL', 6, 'thigh.png', 0, 13),
    slot('legShinR', 'shinR', 7, 'shin.png', 0, 10),
    slot('legShinL', 'shinL', 8, 'shin.png', 0, 10),
    slot('footR', 'footR', 9, 'foot.png', -2, 2.5),
    slot('footL', 'footL', 10, 'foot.png', 2, 2.5),
    slot('waist', 'spine', 12, 'waist.png', 0, 4),
    slot('chestSlot', 'chest', 14, 'chest.png', 0, -1),
    slot('armFR', 'forearmR', 16, 'forearm.png', 0, 9),
    slot('armFL', 'forearmL', 17, 'forearm.png', 0, 9),
    slot('neckSlot', 'neck', 19, 'neck.png', 0, -1),
    slot('headSlot', 'head', 21, 'head.png', 0, -7)
  ],
  clips: [
    {
      // 呼吸循环 4 关键帧（0/450/900/1350 平分 1800ms）：0 基准 → 450 吸气峰 → 900 回落 →
      // 1350 回到基准（=第 1 组值，首尾闭合）；末尾隐含的循环帧（t=1800）省略。
      name: 'idle_down',
      durationMs: 1800,
      loop: true,
      tracks: [
        {
          bone: 'chest',
          keys: [
            { t: 0, x: 0, y: -12, rot: 0 },
            { t: 450, x: 0, y: -11.3, rot: 0.7, ease: 'easeInOut' },
            { t: 900, x: 0, y: -11.4, rot: 0.7, ease: 'easeInOut' },
            { t: 1350, x: 0, y: -12, rot: 0, ease: 'easeInOut' }
          ]
        },
        {
          bone: 'head',
          keys: [
            { t: 0, x: 0, y: -2.5, rot: 0 },
            { t: 450, x: 0, y: -2.3, rot: 1.4, ease: 'easeInOut' },
            { t: 900, x: 0, y: -2.3, rot: 1.4, ease: 'easeInOut' },
            { t: 1350, x: 0, y: -2.5, rot: 0, ease: 'easeInOut' }
          ]
        },
        {
          bone: 'upperArmR',
          keys: [
            { t: 0, x: -8.5, y: -8, rot: 3 },
            { t: 450, x: -8.5, y: -8, rot: 4.5, ease: 'easeInOut' },
            { t: 900, x: -8.5, y: -8, rot: 4, ease: 'easeInOut' },
            { t: 1350, x: -8.5, y: -8, rot: 3, ease: 'easeInOut' }
          ]
        },
        {
          bone: 'upperArmL',
          keys: [
            { t: 0, x: 8.5, y: -8, rot: -3 },
            { t: 450, x: 8.5, y: -8, rot: -4.5, ease: 'easeInOut' },
            { t: 900, x: 8.5, y: -8, rot: -4, ease: 'easeInOut' },
            { t: 1350, x: 8.5, y: -8, rot: -3, ease: 'easeInOut' }
          ]
        },
        {
          bone: 'forearmR',
          keys: [
            { t: 0, x: 0, y: 17, rot: 0 },
            { t: 450, x: 0, y: 17, rot: -1, ease: 'easeInOut' },
            { t: 900, x: 0, y: 17, rot: -0.5, ease: 'easeInOut' },
            { t: 1350, x: 0, y: 17, rot: 0, ease: 'easeInOut' }
          ]
        },
        {
          bone: 'forearmL',
          keys: [
            { t: 0, x: 0, y: 17, rot: 0 },
            { t: 450, x: 0, y: 17, rot: 1, ease: 'easeInOut' },
            { t: 900, x: 0, y: 17, rot: 0.5, ease: 'easeInOut' },
            { t: 1350, x: 0, y: 17, rot: 0, ease: 'easeInOut' }
          ]
        }
      ]
    }
  ]
};

writeFileSync(OUT_SKELETON, JSON.stringify(doc, null, 2) + '\n', 'utf8');
console.log(`骨架: ${path.relative(root, OUT_SKELETON)}（${doc.bones.length} 骨 / ${doc.slots.length} 槽）`);

/* ---------------- 4. 渲染验证（idle_down 三帧 + 校验） ---------------- */

const asset = parseSkeletonAsset(doc);
const rest = createRestLocalPose(asset);
const world0 = composeWorldTransforms(asset, sampleClip(asset.clips.get('idle_down'), 0, rest));
console.log(`校验: 头骨世界 y=${r(world0.get('head').y)}（颏-86）  脚踝骨 y=${r(world0.get('footR').y)}（≈-5）`);
function r(v) { return Math.round(v * 100) / 100; }

const partImgs = new Map();
for (const file of Object.keys(PARTS)) {
  partImgs.set(file, await sharp(path.join(OUT_PARTS, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
}
async function renderFrame(timeMs) {
  const W = 160, H = 200;
  const pose = sampleClip(asset.clips.get('idle_down'), timeMs, rest);
  const world = composeWorldTransforms(asset, pose);
  const ordered = [...asset.slots].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  const layers = [];
  for (const s of ordered) {
    const att = s.attachment;
    if (!att || att.type !== 'image') continue;
    const file = att.assetId.replace(P, '');
    const img = partImgs.get(file);
    if (!img) continue;
    const bone = world.get(s.bone);
    if (!bone) continue;
    const cos = Math.cos(bone.rad), sin = Math.sin(bone.rad);
    const lx = att.x ?? 0, ly = att.y ?? 0;
    const ax = bone.x + lx * cos - ly * sin;
    const ay = bone.y + lx * sin + ly * cos;
    // idle_down 呼吸角度微小（≤2°），预览按轴对齐贴图
    layers.push({
      input: await sharp(path.join(OUT_PARTS, file)).png().toBuffer(),
      left: Math.round(80 + ax - img.info.width / 2),
      top: Math.round(180 + ay - img.info.height / 2)
    });
  }
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .png()
    .toBuffer();
}

const frames = await Promise.all([0, 600, 1200].map(renderFrame));
await sharp(frames[0]).png().toFile(path.join(TEMP, 'humanoid-frame0.png'));   // 单帧直出排查 composite
await sharp({ create: { width: 160 * 3 + 20, height: 200, channels: 4, background: { r: 24, g: 24, b: 28, alpha: 255 } } })
  .composite(frames.map((input, i) => ({ input, left: i * 170, top: 0 })))
  .png().toFile(path.join(TEMP, 'humanoid-preview.png'));
console.log(`预览: Temp/humanoid-preview.png（idle_down t=0/600/1200）`);

// 诊断：部件图与预览帧的非透明像素统计
for (const [file, img] of partImgs) {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 32) n++;
  console.log(`[diag] ${file}: ${img.info.width}×${img.info.height} 非透明=${n}`);
}
for (let f = 0; f < frames.length; f++) {
  const { data } = await sharp(frames[f]).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 32) n++;
  console.log(`[diag] 帧${f}: 非透明=${n}`);
}
