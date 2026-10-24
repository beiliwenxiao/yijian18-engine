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
 * ## 背景（2026-10-23 用户裁定）
 *   旧 player.json 骨架是「hips 直挂两臂两腿」的简化树（无脊柱分段/无肩/无颈/无脚），
 *   加剪纸式部件图，观感不像人。本脚本按业界标准人形 2D 骨骼拓扑
 *   （Spine / Unity Humanoid 同款约定）+ 7.5 头身真人比例重建：
 *
 *     hips(骨盆) ── spine(腰) ── chest(胸) ── neck(颈) ── head(头)
 *        │              └──────┴── upperArmR/L ── forearmR/L
 *        └── thighR/L ── shinR/L ── footR/L
 *
 * ## 比例（身高 H=110px，7.5 头身，head height h=14.7）
 *   头顶-110 / 颏-95.3 / 肩线-90 / 肘-69.3 / 腕-53.4 / 髋-53 / 膝-31.4 / 踝-4.4
 *   腿长占 48%、上肢(肩→腕) 33%、头:颈:躯干 ≈ 1 : 0.36 : 2.5
 *
 * ## 部件图
 *   程序化像素生成（sharp 合成），配色从现有部件图中心采样（保持角色一致）。
 *   输出 assets/images/player/parts-humanoid/，骨架 skeletons/player-humanoid.json。
 *   本脚本为独立验证版：不动 player.json，验收后再替换并迁移剪辑。
 *
 * 用法：node scripts/build-humanoid-skeleton.mjs
 */

import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseSkeletonAsset } from '../src/animation/SkeletonAsset.js';
import { createRestLocalPose, composeWorldTransforms, sampleClip } from '../src/animation/SkeletonPose.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD_PARTS = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/parts');
const OUT_PARTS = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/parts-humanoid');
const OUT_SKELETON = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons/player-humanoid.json');
const TEMP = path.join(root, 'Temp');
mkdirSync(OUT_PARTS, { recursive: true });
mkdirSync(TEMP, { recursive: true });

/* ---------------- 1. 从现有部件图采样配色 ---------------- */

const C = {
  skin: '#e8b48c',
  skinDark: '#b57e52',
  hair: '#4a3526',
  hairLight: '#644833',
  cloth: '#ddd6c8',
  waist: '#c9a84c',
  pants: '#4a5a72',
  pantsDark: '#333e50',
  boot: '#6a5a4a'
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

const OUTLINE = '#241a12';       // 统一深描边（比旧 #1f1812 略暖）
const OUTLINE_SOFT = '#3a2a1e';  // 次级描边（发丝/布料折痕）

// 头（脸+发，正面）：24×26 画布 —— 规整脸型 + 清晰五官 + 收束发髻（不再是爆炸发堆）
{
  const c = canvas(24, 26);
  const cx = 12;

  // 后发（底）：收窄的椭圆 + 两侧鬓发
  c.ellipse(cx, 9.5, 9, 6.5, C.hair);
  c.ellipse(cx - 8, 13, 2.6, 4.5, C.hair);
  c.ellipse(cx + 8, 13, 2.6, 4.5, C.hair);

  // 发髻（顶）：小而端正的圆髻 + 高光 + 束带
  c.ellipse(cx, 2.5, 4, 2.8, C.hair);
  c.ellipse(cx - 1.2, 1.6, 1.6, 1.2, C.hairLight);
  hline(c, cx - 4, cx + 4, 4.6, C.hairLight);

  // 脸：外描边 + 内肤色（先深后浅两层做轮廓）
  c.ellipse(cx, 16.5, 7.6, 8.2, OUTLINE);
  c.ellipse(cx, 16.2, 6.9, 7.6, C.skin);
  c.rect(cx - 6, 16, 12, 6, C.skin);
  // 右侧脸阴影（受光在左）
  c.ellipse(cx + 4.2, 17.5, 2.2, 5.2, C.skinDark);
  c.ellipse(cx + 5, 19, 1.2, 2.6, darken(C.skinDark, 0.9));

  // 耳
  c.ellipse(cx - 6.6, 16.5, 1.2, 1.8, C.skin);
  c.ellipse(cx + 6.6, 16.5, 1.2, 1.8, C.skin);

  // 眉（两段短线）
  hline(c, cx - 5, cx - 2, 12.4, C.hair);
  hline(c, cx + 2, cx + 5, 12.4, C.hair);
  pixel(c, cx - 5, 13.2, C.hair);
  pixel(c, cx + 5, 13.2, C.hair);

  // 眼：眼白 + 深瞳 + 高光（每眼 2×2 起）
  c.rect(cx - 4.5, 14.6, 2, 2, '#f4ece2');
  c.rect(cx + 2.5, 14.6, 2, 2, '#f4ece2');
  pixel(c, cx - 3.6, 15.2, '#241c16');
  pixel(c, cx + 3.6, 15.2, '#241c16');
  pixel(c, cx - 4, 14.8, '#ffffff');
  pixel(c, cx + 3.2, 14.8, '#ffffff');
  // 上眼睑压线
  hline(c, cx - 4.6, cx - 2.6, 14.2, C.hair);
  hline(c, cx + 2.6, cx + 4.6, 14.2, C.hair);

  // 鼻（短线阴影 + 鼻尖亮点）
  vline(c, cx + 0.4, 16.6, 18.2, darken(C.skinDark, 0.92));
  pixel(c, cx - 0.2, 18.4, C.skin);

  // 嘴（微抿的弧）
  hline(c, cx - 1.6, cx + 1.6, 20.2, darken(C.skinDark, 0.8));
  pixel(c, cx - 1.9, 19.8, darken(C.skinDark, 0.86));
  pixel(c, cx + 1.9, 19.8, darken(C.skinDark, 0.86));

  // 刘海：三缕弧形，压住额头但留出眉眼
  c.ellipse(cx - 4.6, 10.6, 4.2, 3, C.hair);
  c.ellipse(cx + 4.6, 10.6, 4.2, 3, C.hair);
  c.ellipse(cx, 9.8, 5.4, 2.8, C.hair);
  // 发丝高光
  line(c, cx - 6, 9, cx - 2, 11, C.hairLight);
  line(c, cx + 6, 9, cx + 2, 11, C.hairLight);
  PARTS['head.png'] = c;
}

// 颈：肤色短柱 + 颌下阴影
{
  const c = canvas(8, 8);
  c.rect(2.4, 0, 3.4, 8, C.skin);
  c.rect(4.4, 0, 1.4, 8, C.skinDark);
  hline(c, 2.4, 5.8, 0.6, darken(C.skinDark, 0.8));   // 颌下投影
  PARTS['neck.png'] = c;
}

// 胸（肩+胸衣）：28×24 —— 锁骨线 + 抹胸上提覆盖胸腹 + 肩弧（肩部只此一处画，上臂不再画肩球）
{
  const c = canvas(28, 24);
  const cy = 7;

  // 肩部三角肌（肤色弧，顶面亮）——全角色唯一的肩
  c.ellipse(4.6, cy, 4.4, 4, C.skin);
  c.ellipse(23.4, cy, 4.4, 4, C.skin);
  c.ellipse(4.6, cy - 1, 3.4, 2.4, lighten(C.skin, 1.08));
  c.ellipse(23.4, cy - 1, 3.4, 2.4, lighten(C.skin, 1.08));
  c.ellipse(25.4, cy + 1.5, 2, 2.8, C.skinDark);

  // 躯干主体（肤色）+ 弱描边（避免与手臂重叠处形成黑洞）
  c.ellipse(14, cy + 3.5, 8.6, 7.4, OUTLINE_SOFT);
  c.ellipse(14, cy + 3, 7.8, 6.8, C.skin);
  c.rect(6.6, cy + 2, 14.8, 9, C.skin);

  // 锁骨线（两段斜线）
  line(c, 7.5, cy + 2.4, 11.5, cy + 4, darken(C.skinDark, 0.9));
  line(c, 20.5, cy + 2.4, 16.5, cy + 4, darken(C.skinDark, 0.9));

  // 抹胸/胸衣：上提至锁骨线，覆盖胸腹（消除大片裸肤）
  c.rect(6.8, cy + 3.2, 14.4, 13.8, C.cloth);
  c.rect(6.8, cy + 3.2, 14.4, 1.8, lighten(C.cloth, 1.22));   // 上缘高光
  vline(c, 10.2, cy + 5, cy + 16, darken(C.cloth, 0.88));     // 褶皱
  vline(c, 17.8, cy + 5, cy + 16, darken(C.cloth, 0.88));
  line(c, 14, cy + 3.4, 11.4, cy + 7, darken(C.cloth, 0.9));  // 领口交叠（V 领）
  line(c, 14, cy + 3.4, 16.6, cy + 7, darken(C.cloth, 0.9));
  hline(c, 6.8, 21.2, cy + 16, darken(C.cloth, 0.8));         // 下缘

  // 腰线阴影（衣下缘到腰）
  c.rect(7.2, cy + 16.4, 13.6, 1.6, C.skinDark);
  PARTS['chest.png'] = c;
}

// 腰/骨盆（腰裙）：20×14 —— 腰带 + 裙褶
{
  const c = canvas(20, 14);
  c.rect(3, 0, 14, 5, C.skin);                    // 腹部露出
  c.rect(3, 0, 14, 1.8, C.skinDark);
  c.ellipse(10, 8.6, 8.6, 5.6, OUTLINE_SOFT);
  c.ellipse(10, 8.4, 8, 5.2, C.waist);
  c.rect(2, 5.6, 16, 6, C.waist);
  c.rect(2, 5.6, 16, 1.6, lighten(C.waist, 1.3));  // 腰带高光
  vline(c, 6.4, 7.6, 12.4, darken(C.waist, 0.86)); // 裙褶
  vline(c, 13.6, 7.6, 12.4, darken(C.waist, 0.86));
  PARTS['waist.png'] = c;
}

// 上臂：不再画肩球（肩由 chest 图唯一负责，避免双肩分离）+ 二头肌体积 + 肘收窄
{
  const c = limb(9, 21, 7.2, 5.2, C.skin, C.skinDark);
  c.ellipse(4.5, 1.6, 3.2, 1.8, C.skin);             // 顶部与肩衔接的小圆角
  c.ellipse(4.5, 17.6, 2.5, 2.4, C.skin);          // 肘
  vline(c, 5.8, 6, 14, darken(C.skin, 0.93));       // 内侧暗线（体积，弱化避免黑洞）
  line(c, 2.4, 5, 2.4, 13, lighten(C.skin, 1.07)); // 外侧亮线
  PARTS['upper-arm.png'] = c;
}

// 前臂+手：收窄腕部 + 手掌 + 手指暗示
{
  const c = limb(8, 17, 5.6, 4.4, C.skin, C.skinDark);
  c.ellipse(4, 14.2, 3, 3.4, C.skin);              // 手掌
  c.rect(2.6, 15.4, 3.4, 1.4, C.skin);
  vline(c, 3.2, 15.2, 16.6, darken(C.skin, 0.9));  // 指缝暗示
  vline(c, 4.8, 15.2, 16.6, darken(C.skin, 0.9));
  c.ellipse(5.2, 9, 1.2, 3.4, C.skinDark);         // 内侧暗
  PARTS['forearm.png'] = c;
}

// 大腿：裤（外扩股肌 + 膝收窄 + 褶线）
{
  const c = limb(11, 24, 9, 7, C.pants, C.pantsDark);
  vline(c, 3.2, 3, 18, darken(C.pants, 0.88));      // 裤褶
  vline(c, 7.6, 4, 16, darken(C.pants, 0.92));
  PARTS['thigh.png'] = c;
}

// 小腿：裤 + 小腿肚 + 踝部靴口
{
  const c = limb(9, 28, 7, 4.4, C.pants, C.pantsDark);
  c.ellipse(4.5, 7, 2.6, 4.4, lighten(C.pants, 1.1)); // 小腿肚高光
  c.rect(2.4, 24.6, 4.6, 3.2, C.boot);             // 靴口
  c.rect(2.4, 24.6, 4.6, 1, lighten(C.boot, 1.2));
  PARTS['shin.png'] = c;
}

// 脚（朝 +x 鞋）：鞋面高光 + 鞋底暗线
{
  const c = canvas(14, 7);
  c.ellipse(5, 3.5, 4.5, 3.4, C.boot);
  c.rect(4, 1, 9, 5, C.boot);
  c.rect(4, 1, 8, 1.4, lighten(C.boot, 1.22));
  c.rect(4, 4.6, 9.5, 1.6, darken(C.boot, 0.7));
  PARTS['foot.png'] = c;
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
 * 新图的 headSlot 并不被游戏使用——三态机制要求脸/发分件，故这里重画旧资产。
 * 统一 64×64 坐标系（脸内容 x22-42 / y2-25），让脸与发同心；发图中部椭圆镂空露出脸。
 * 输出仍为原文件名（parts/ 目录），manifest 登记的 assetId 不变。 */

const LEGACY_DIR = path.join(root, 'example/sanguo_zhangjiao/assets/images/player/parts');

/** 脸（正面）：64×64，内容区 x22-42 / y2-25 */
function legacyFaceFront() {
  const c = canvas(64, 64, LEGACY_DIR);
  const cx = 32, cy = 13.5;
  c.ellipse(cx, cy, 10.5, 11.5, OUTLINE);       // 外描边
  c.ellipse(cx, cy, 9.6, 10.6, C.skin);          // 脸
  c.rect(cx - 9, cy - 2, 18, 10, C.skin);
  c.ellipse(cx + 5.4, cy + 1, 2.2, 5.6, darken(C.skin, 0.9));  // 右侧暗部（弱化）
  c.ellipse(cx + 6.2, cy + 2.6, 1.2, 2.6, darken(C.skinDark, 0.92));
  c.ellipse(cx - 9.6, cy - 0.5, 1.4, 2.4, C.skin); // 耳
  c.ellipse(cx + 9.6, cy - 0.5, 1.4, 2.4, C.skin);
  hline(c, cx - 7, cx - 3, cy - 4.4, C.hair);     // 眉
  hline(c, cx + 3, cx + 7, cy - 4.4, C.hair);
  c.rect(cx - 6, cy - 2, 3, 2.4, '#f4ece2');      // 眼白
  c.rect(cx + 3, cy - 2, 3, 2.4, '#f4ece2');
  pixel(c, cx - 5, cy - 1, '#241c16');            // 瞳
  pixel(c, cx + 5, cy - 1, '#241c16');
  pixel(c, cx - 5.4, cy - 1.8, '#ffffff');        // 高光
  pixel(c, cx + 4.6, cy - 1.8, '#ffffff');
  hline(c, cx - 6.4, cx - 3, cy - 2.6, C.hair);   // 上睑
  hline(c, cx + 3, cx + 6.4, cy - 2.6, C.hair);
  vline(c, cx + 0.4, cy + 0.5, cy + 2.8, darken(C.skinDark, 0.9)); // 鼻
  hline(c, cx - 2, cx + 2, cy + 5, darken(C.skinDark, 0.8));       // 嘴
  pixel(c, cx - 2.4, cy + 4.6, darken(C.skinDark, 0.86));
  pixel(c, cx + 2.4, cy + 4.6, darken(C.skinDark, 0.86));
  return c;
}

/** 侧脸：鼻梁朝左，含单眼与侧发轮廓 */
function legacyFaceSide() {
  const c = canvas(64, 64, LEGACY_DIR);
  const cx = 31, cy = 13.5;
  c.ellipse(cx, cy, 9.6, 11, OUTLINE);
  c.ellipse(cx, cy, 8.6, 10, C.skin);
  c.rect(cx - 8, cy - 2, 16, 9, C.skin);
  c.ellipse(cx + 5.6, cy + 1, 2.6, 6.4, C.skinDark);
  c.ellipse(cx - 8.2, cy + 0.5, 1.6, 2.6, C.skin);  // 耳（后侧）
  pixel(c, cx - 8.4, cy + 0.5, darken(C.skinDark, 0.9));
  hline(c, cx - 7, cx - 3.4, cy - 4.2, C.hair);      // 眉
  c.rect(cx - 6.6, cy - 2, 2.8, 2.2, '#f4ece2');     // 眼
  pixel(c, cx - 5.8, cy - 1, '#241c16');
  pixel(c, cx - 6.2, cy - 1.8, '#ffffff');
  hline(c, cx - 7, cx - 4, cy - 2.6, C.hair);
  vline(c, cx - 5.6, cy + 0.5, cy + 3, darken(C.skinDark, 0.9)); // 鼻梁
  hline(c, cx - 6.4, cx - 3.4, cy + 4.6, darken(C.skinDark, 0.8)); // 嘴
  return c;
}

/** 后脑：只有头型与耳廓，无五官 */
function legacyFaceBack() {
  const c = canvas(64, 64, LEGACY_DIR);
  const cx = 32, cy = 14;
  c.ellipse(cx, cy, 10.5, 11.5, OUTLINE);
  c.ellipse(cx, cy, 9.6, 10.6, C.skin);
  c.rect(cx - 9, cy - 2, 18, 9, C.skin);
  c.ellipse(cx + 5.4, cy + 1, 3, 6.6, C.skinDark);
  c.ellipse(cx - 9.6, cy - 0.5, 1.4, 2.4, C.skin);
  c.ellipse(cx + 9.6, cy - 0.5, 1.4, 2.4, C.skin);
  return c;
}

/** 前发：顶部发块 + 两侧垂发 + 顶部发髻，中部椭圆镂空露脸 */
function legacyHairFront() {
  const c = canvas(64, 64, LEGACY_DIR);
  const cx = 32;
  c.ellipse(cx, 18, 15, 17, C.hair);            // 顶部发块
  c.rect(cx - 15, 14, 30, 12, C.hair);
  c.ellipse(cx - 14, 30, 4, 16, C.hair);         // 左侧垂发
  c.ellipse(cx + 14, 30, 4, 16, C.hair);         // 右侧垂发
  c.ellipse(cx, 4, 8, 5, C.hair);                // 发髻
  c.ellipse(cx - 2.4, 2.6, 3, 2, C.hairLight);   // 髻高光
  hline(c, cx - 8, cx + 8, 8.4, C.hairLight);     // 束带
  line(c, cx - 12, 12, cx - 6, 18, C.hairLight);  // 发丝高光
  line(c, cx + 12, 12, cx + 6, 18, C.hairLight);
  c.clearEllipse(cx, 18, 12, 12.5);               // 镂空露脸
  return c;
}

/** 侧发：偏向一边的刘海 + 后脑发 + 鬓角 */
function legacyHairSide() {
  const c = canvas(64, 64, LEGACY_DIR);
  const cx = 31;
  c.ellipse(cx, 18, 14, 17, C.hair);
  c.rect(cx - 14, 14, 28, 12, C.hair);
  c.ellipse(cx + 12, 32, 4.5, 18, C.hair);       // 后脑长发
  c.ellipse(cx - 13, 28, 3.4, 14, C.hair);       // 前鬓
  c.ellipse(cx + 1, 5, 7, 4.4, C.hair);
  line(c, cx - 10, 12, cx - 4, 18, C.hairLight);
  c.clearEllipse(cx - 2, 18, 10, 12);             // 镂空露侧脸
  return c;
}

/** 后发：整片后脑发（无镂空） */
function legacyHairBack() {
  const c = canvas(64, 64, LEGACY_DIR);
  const cx = 32;
  c.ellipse(cx, 20, 15, 18, C.hair);
  c.rect(cx - 15, 16, 30, 16, C.hair);
  c.ellipse(cx - 13, 36, 5, 18, C.hair);
  c.ellipse(cx + 13, 36, 5, 18, C.hair);
  c.ellipse(cx, 4, 8, 5, C.hair);
  c.ellipse(cx - 2.4, 2.6, 3, 2, C.hairLight);
  line(c, cx - 10, 14, cx - 5, 22, C.hairLight);
  line(c, cx + 10, 14, cx + 5, 22, C.hairLight);
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

/* ---------------- 3. 骨架 JSON 组装 ---------------- */

const P = 'player.humanoid.';
// 部件图用原尺寸渲染（不写 width/height，运行时回退 img 原尺寸）——写 64 会放大 2.67 倍出棋盘缝
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
    { id: 'hips', parent: null, x: 0, y: -53, rot: 0, scaleX: 1, scaleY: 1, length: 12 },
    { id: 'spine', parent: 'hips', x: 0, y: 1, rot: 0, scaleX: 1, scaleY: 1, length: 19 },
    { id: 'chest', parent: 'spine', x: 0, y: -19, rot: 0, scaleX: 1, scaleY: 1, length: 17 },
    { id: 'neck', parent: 'chest', x: 0, y: -17, rot: 0, scaleX: 1, scaleY: 1, length: 5 },
    { id: 'head', parent: 'neck', x: 0, y: -5, rot: 0, scaleX: 1, scaleY: 1, length: 15 },
    { id: 'upperArmR', parent: 'chest', x: -11, y: -14, rot: 4, scaleX: 1, scaleY: 1, length: 20 },
    { id: 'upperArmL', parent: 'chest', x: 11, y: -14, rot: -4, scaleX: 1, scaleY: 1, length: 20 },
    { id: 'forearmR', parent: 'upperArmR', x: 0, y: 20, rot: 0, scaleX: 1, scaleY: 1, length: 17 },
    { id: 'forearmL', parent: 'upperArmL', x: 0, y: 20, rot: 0, scaleX: 1, scaleY: 1, length: 17 },
    { id: 'thighR', parent: 'hips', x: -5.5, y: 1, rot: 0, scaleX: 1, scaleY: 1, length: 22 },
    { id: 'thighL', parent: 'hips', x: 5.5, y: 1, rot: 0, scaleX: 1, scaleY: 1, length: 22 },
    { id: 'shinR', parent: 'thighR', x: 0, y: 22, rot: 0, scaleX: 1, scaleY: 1, length: 26 },
    { id: 'shinL', parent: 'thighL', x: 0, y: 22, rot: 0, scaleX: 1, scaleY: 1, length: 26 },
    { id: 'footR', parent: 'shinR', x: 0, y: 26, rot: -90, scaleX: 1, scaleY: 1, length: 7 },
    { id: 'footL', parent: 'shinL', x: 0, y: 26, rot: -90, scaleX: 1, scaleY: 1, length: 7 }
  ],
  slots: [
    slot('axeBack', 'chest', 1, 'axe.png', -15, -8),
    slot('armUR', 'upperArmR', 3, 'upper-arm.png', 0, 2),
    slot('armUL', 'upperArmL', 4, 'upper-arm.png', 0, 2),
    slot('legThighR', 'thighR', 5, 'thigh.png', 0, 10),
    slot('legThighL', 'thighL', 6, 'thigh.png', 0, 10),
    slot('legShinR', 'shinR', 7, 'shin.png', 0, 12),
    slot('legShinL', 'shinL', 8, 'shin.png', 0, 12),
    slot('footR', 'footR', 9, 'foot.png', -2, -1),
    slot('footL', 'footL', 10, 'foot.png', 2, -1),
    slot('waist', 'spine', 12, 'waist.png', 0, -14),
    slot('chestSlot', 'chest', 14, 'chest.png', 0, -8),
    slot('armFR', 'forearmR', 16, 'forearm.png', 0, 1),
    slot('armFL', 'forearmL', 17, 'forearm.png', 0, 1),
    slot('neckSlot', 'neck', 19, 'neck.png', 0, -2),
    slot('headSlot', 'head', 21, 'head.png', 0, -6)
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
            { t: 0, x: 0, y: -19, rot: 0 },
            { t: 450, x: 0, y: -18.3, rot: 0.7, ease: 'easeInOut' },
            { t: 900, x: 0, y: -18.4, rot: 0.7, ease: 'easeInOut' },
            { t: 1350, x: 0, y: -19, rot: 0, ease: 'easeInOut' }
          ]
        },
        {
          bone: 'head',
          keys: [
            { t: 0, x: 0, y: -5, rot: 0 },
            { t: 450, x: 0, y: -4.8, rot: 1.4, ease: 'easeInOut' },
            { t: 900, x: 0, y: -4.8, rot: 1.4, ease: 'easeInOut' },
            { t: 1350, x: 0, y: -5, rot: 0, ease: 'easeInOut' }
          ]
        },
        {
          bone: 'upperArmR',
          keys: [
            { t: 0, x: -11, y: -14, rot: 3 },
            { t: 450, x: -11, y: -14, rot: 4.5, ease: 'easeInOut' },
            { t: 900, x: -11, y: -14, rot: 4, ease: 'easeInOut' },
            { t: 1350, x: -11, y: -14, rot: 3, ease: 'easeInOut' }
          ]
        },
        {
          bone: 'upperArmL',
          keys: [
            { t: 0, x: 11, y: -14, rot: -3 },
            { t: 450, x: 11, y: -14, rot: -4.5, ease: 'easeInOut' },
            { t: 900, x: 11, y: -14, rot: -4, ease: 'easeInOut' },
            { t: 1350, x: 11, y: -14, rot: -3, ease: 'easeInOut' }
          ]
        },
        {
          bone: 'forearmR',
          keys: [
            { t: 0, x: 0, y: 20, rot: 0 },
            { t: 450, x: 0, y: 20, rot: -1, ease: 'easeInOut' },
            { t: 900, x: 0, y: 20, rot: -0.5, ease: 'easeInOut' },
            { t: 1350, x: 0, y: 20, rot: 0, ease: 'easeInOut' }
          ]
        },
        {
          bone: 'forearmL',
          keys: [
            { t: 0, x: 0, y: 20, rot: 0 },
            { t: 450, x: 0, y: 20, rot: 1, ease: 'easeInOut' },
            { t: 900, x: 0, y: 20, rot: 0.5, ease: 'easeInOut' },
            { t: 1350, x: 0, y: 20, rot: 0, ease: 'easeInOut' }
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
const headTop = Math.min(...['headSlot'].map(id => {
  const s = asset.slots.find(x => x.id === id);
  return world0.get(s.bone).y + (s.attachment.y ?? 0);
}));
console.log(`校验: 头骨世界 y=${r(world0.get('head').y)}  脚踝骨 y=${r(world0.get('footR').y)}（≈-4）`);
function r(v) { return Math.round(v * 100) / 100; }

// 渲染 idle_down 3 帧（简版合成：各部件按骨位姿贴图）
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
