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
function canvas(w, h) {
  const data = Buffer.alloc(w * h * 4, 0);
  const hex = v => { const n = parseInt(v.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255, 255]; };
  return {
    w, h, data,
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
    async save(file) {
      await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toFile(path.join(OUT_PARTS, file));
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

// 头（脸+发，正面）：14.7px 高 → 24×26 画布，脸占下 2/3，发盖顶
{
  const c = canvas(24, 26);
  const cx = 12;
  // 发冠（底层大椭圆）
  c.ellipse(cx, 8, 9.5, 8.5, C.hair);
  c.ellipse(cx - 8.5, 11, 3, 5.5, C.hair);     // 侧发
  c.ellipse(cx + 8.5, 11, 3, 5.5, C.hair);
  // 发髻
  c.ellipse(cx, 1.5, 4, 3.5, C.hair);
  c.ellipse(cx - 1.2, 0.8, 1.8, 1.5, C.hairLight);
  // 脸（肤）
  c.ellipse(cx, 15, 7.5, 7.5, C.skin);
  c.rect(cx - 7, 14, 14, 6, C.skin);
  // 脸侧阴影
  c.ellipse(cx + 5.5, 17, 2.2, 5, C.skinDark);
  // 眼（正面 2 像素眼）
  c.rect(cx - 4.5, 15, 2, 2.6, '#2a2320');
  c.rect(cx + 2.5, 15, 2, 2.6, '#2a2320');
  // 嘴
  c.rect(cx - 1, 20.6, 2.4, 1, darken(C.skinDark, 0.85));
  // 刘海盖额头
  c.ellipse(cx - 5, 9.5, 4.5, 3.2, C.hair);
  c.ellipse(cx + 5, 9.5, 4.5, 3.2, C.hair);
  c.ellipse(cx, 8.5, 6, 3.4, C.hair);
  PARTS['head.png'] = c;
}

// 颈：肤色短柱
{
  const c = canvas(8, 8);
  c.rect(2.5, 0, 3.4, 8, C.skin);
  c.rect(4.6, 0, 1.3, 8, C.skinDark);
  PARTS['neck.png'] = c;
}

// 胸（肩+胸衣）：肩宽 22 → 28×24 画布；三角肌肤色+抹胸
{
  const c = canvas(28, 24);
  const cy = 8;
  // 肩部三角肌（肤色圆）
  c.ellipse(4.5, cy, 4.5, 4.5, C.skin);
  c.ellipse(23.5, cy, 4.5, 4.5, C.skin);
  c.ellipse(25, cy + 1.5, 2.4, 3, C.skinDark);
  // 躯干上段（肤色）+抹胸
  c.ellipse(14, cy + 4, 8.5, 8, C.skin);
  c.rect(7, cy + 2, 14, 10, C.skin);
  c.rect(8, cy + 7, 12, 8, C.cloth);           // 抹胸
  c.rect(8, cy + 7, 12, 2, lighten(C.cloth, 1.25));
  // 腰线阴影
  c.rect(7.5, cy + 13.5, 13, 2, C.skinDark);
  // 领口锁骨线
  c.rect(11, cy + 5.5, 6, 1, C.skinDark);
  PARTS['chest.png'] = c;
}

// 腰/骨盆（腰裙）：20×14
{
  const c = canvas(20, 14);
  c.rect(3, 0, 14, 5, C.skin);                 // 腹部露出
  c.rect(3, 0, 14, 2, C.skinDark);
  c.ellipse(10, 9, 8.5, 6, C.waist);           // 裙
  c.rect(2, 6, 16, 6, C.waist);
  c.rect(2, 6, 16, 1.8, lighten(C.waist, 1.3)); // 腰带高光
  PARTS['waist.png'] = c;
}

// 上臂（左向图，右臂镜像）：肤色柱+肩球
{
  const c = limb(9, 21, 7.5, 5.5, C.skin, C.skinDark);
  c.ellipse(4.5, 3, 4, 4, C.skin);             // 肩球
  c.ellipse(4.5, 17.5, 2.6, 2.6, C.skin);      // 肘
  PARTS['upper-arm.png'] = c;
}

// 前臂+手
{
  const c = limb(8, 17, 5.5, 4.5, C.skin, C.skinDark);
  c.ellipse(4, 14.5, 3, 3.2, C.skin);          // 手
  PARTS['forearm.png'] = c;
}

// 大腿：裤
{
  const c = limb(11, 24, 9, 7, C.pants, C.pantsDark);
  PARTS['thigh.png'] = c;
}

// 小腿：裤+踝
{
  const c = limb(9, 28, 7, 4.5, C.pants, C.pantsDark);
  c.rect(2.5, 25, 4.5, 3, C.boot);             // 踝部靴口
  PARTS['shin.png'] = c;
}

// 脚（朝 +x 鞋）
{
  const c = canvas(14, 7);
  c.ellipse(5, 3.5, 4.5, 3.4, C.boot);
  c.rect(4, 1, 9, 5, C.boot);
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
    { id: 'upperArmR', parent: 'chest', x: -13, y: -14, rot: 4, scaleX: 1, scaleY: 1, length: 18 },
    { id: 'upperArmL', parent: 'chest', x: 13, y: -14, rot: -4, scaleX: 1, scaleY: 1, length: 18 },
    { id: 'forearmR', parent: 'upperArmR', x: 0, y: 18, rot: 0, scaleX: 1, scaleY: 1, length: 15 },
    { id: 'forearmL', parent: 'upperArmL', x: 0, y: 18, rot: 0, scaleX: 1, scaleY: 1, length: 15 },
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
      name: 'idle_down',
      durationMs: 1800,
      loop: true,
      tracks: [
        {
          bone: 'chest',
          keys: [
            { t: 0, x: 0, y: -19, rot: 0 },
            { t: 450, x: 0, y: -18.4, rot: 0.6, ease: 'easeInOut' },
            { t: 900, x: 0, y: -18.1, rot: 1, ease: 'easeInOut' },
            { t: 1350, x: 0, y: -18.5, rot: 0.6, ease: 'easeInOut' },
            { t: 1799, x: 0, y: -19, rot: 0 }
          ]
        },
        {
          bone: 'head',
          keys: [
            { t: 0, x: 0, y: -5, rot: 0 },
            { t: 450, x: 0, y: -4.8, rot: 1.2, ease: 'easeInOut' },
            { t: 900, x: 0, y: -4.6, rot: 1.8, ease: 'easeInOut' },
            { t: 1350, x: 0, y: -4.8, rot: 1.2, ease: 'easeInOut' },
            { t: 1799, x: 0, y: -5, rot: 0 }
          ]
        },
        {
          bone: 'upperArmR',
          keys: [
            { t: 0, x: -11, y: -14, rot: 3 },
            { t: 900, x: -11, y: -14, rot: 4.5, ease: 'easeInOut' },
            { t: 1799, x: -11, y: -14, rot: 3 }
          ]
        },
        {
          bone: 'upperArmL',
          keys: [
            { t: 0, x: 11, y: -14, rot: -3 },
            { t: 900, x: 11, y: -14, rot: -4.5, ease: 'easeInOut' },
            { t: 1799, x: 11, y: -14, rot: -3 }
          ]
        },
        {
          bone: 'forearmR',
          keys: [
            { t: 0, x: 0, y: 18, rot: 0 },
            { t: 900, x: 0, y: 18, rot: -1.2, ease: 'easeInOut' },
            { t: 1799, x: 0, y: 18, rot: 0 }
          ]
        },
        {
          bone: 'forearmL',
          keys: [
            { t: 0, x: 0, y: 18, rot: 0 },
            { t: 900, x: 0, y: 18, rot: 1.2, ease: 'easeInOut' },
            { t: 1799, x: 0, y: 18, rot: 0 }
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
