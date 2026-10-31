/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @date      2026-10-31
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *
 * 点光源物品图标补全管线（蜡烛/火把/火堆/熄灭的火堆/萤火虫）：
 * 内联 SVG 造型（与 NpcRenderStyles 代码绘制同造型语言）→ sharp 栅格化
 * → example/sanguo_zhangjiao/assets/images/s01/prop-*.png（2 倍显示分辨率）
 *
 * 用法：node scripts/gen-light-item-icons.mjs
 */

import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'example', 'sanguo_zhangjiao', 'assets', 'images', 's01');

fs.mkdirSync(OUT_DIR, { recursive: true });

/** 火焰泪滴形（外焰橙 + 内焰黄） */
function flame(cx, baseY, w, h) {
    return `
    <path d="M ${cx} ${baseY - h} C ${cx + w * 0.55} ${baseY - h * 0.62}, ${cx + w * 0.42} ${baseY - h * 0.18}, ${cx} ${baseY}
             C ${cx - w * 0.42} ${baseY - h * 0.18}, ${cx - w * 0.55} ${baseY - h * 0.62}, ${cx} ${baseY - h} Z"
          fill="url(#flameOuter)"/>
    <path d="M ${cx} ${baseY - h * 0.55} C ${cx + w * 0.24} ${baseY - h * 0.36}, ${cx + w * 0.18} ${baseY - h * 0.1}, ${cx} ${baseY}
             C ${cx - w * 0.18} ${baseY - h * 0.1}, ${cx - w * 0.24} ${baseY - h * 0.36}, ${cx} ${baseY - h * 0.55} Z"
          fill="url(#flameInner)"/>`;
}

const DEFS = `
  <defs>
    <radialGradient id="flameOuter" cx="0.5" cy="0.75" r="0.75">
      <stop offset="0" stop-color="#ffd76a"/><stop offset="0.55" stop-color="#ff9a3e"/><stop offset="1" stop-color="#e85d1f"/>
    </radialGradient>
    <radialGradient id="flameInner" cx="0.5" cy="0.8" r="0.8">
      <stop offset="0" stop-color="#fff3c4"/><stop offset="1" stop-color="#ffc257"/>
    </radialGradient>
    <radialGradient id="glowGreen" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#d6ffc8"/><stop offset="0.4" stop-color="#8df07a" stop-opacity="0.85"/><stop offset="1" stop-color="#8df07a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="wax" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#d9cbae"/><stop offset="0.5" stop-color="#f7eeda"/><stop offset="1" stop-color="#cbbb9c"/>
    </linearGradient>
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#5d4326"/><stop offset="0.5" stop-color="#7a5a33"/><stop offset="1" stop-color="#4a341e"/>
    </linearGradient>
    <linearGradient id="charred" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#241d16"/><stop offset="0.5" stop-color="#3a322a"/><stop offset="1" stop-color="#1c1610"/>
    </linearGradient>
    <radialGradient id="stone" cx="0.35" cy="0.3" r="0.9">
      <stop offset="0" stop-color="#9a948a"/><stop offset="0.7" stop-color="#756f64"/><stop offset="1" stop-color="#57524a"/>
    </radialGradient>
  </defs>`;

/** 石圈（椭圆环上 N 颗石头） */
function stoneRing(cx, cy, rx, ry, count, stoneRx = 11, stoneRy = 8) {
    let svg = '';
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count;
        const x = cx + rx * Math.cos(angle);
        const y = cy + ry * Math.sin(angle);
        svg += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${stoneRx}" ry="${stoneRy}" fill="url(#stone)" stroke="#3d382f" stroke-width="1.5"/>
                <ellipse cx="${(x - stoneRx * 0.25).toFixed(1)}" cy="${(y - stoneRy * 0.3).toFixed(1)}" rx="${(stoneRx * 0.4).toFixed(1)}" ry="${(stoneRy * 0.35).toFixed(1)}" fill="rgba(220,215,200,0.35)"/>`;
    }
    return svg;
}

/** 交叉木柴（两根旋转圆角矩形） */
function logs(cx, cy, length, thickness, fill, stroke) {
    return `
    <g transform="rotate(16 ${cx} ${cy})">
      <rect x="${cx - length / 2}" y="${cy - thickness / 2}" width="${length}" height="${thickness}" rx="${thickness / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
    </g>
    <g transform="rotate(-16 ${cx} ${cy})">
      <rect x="${cx - length / 2}" y="${cy - thickness / 2}" width="${length}" height="${thickness}" rx="${thickness / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
      <circle cx="${cx - length / 2 + thickness / 2}" cy="${cy}" r="${thickness / 2.6}" fill="#8a6a42" stroke="${stroke}" stroke-width="1"/>
    </g>`;
}

const ICONS = [
    {
        out: 'prop-candle.png',
        width: 40,
        height: 72,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="72" viewBox="0 0 40 72">${DEFS}
          ${flame(20, 18, 12, 15)}
          <line x1="20" y1="18" x2="20" y2="24" stroke="#4a3a22" stroke-width="2"/>
          <rect x="12" y="23" width="16" height="44" rx="3" fill="url(#wax)" stroke="#a8967a" stroke-width="1.5"/>
          <path d="M 12 30 q 3 4 0 8" stroke="#cbbb9c" stroke-width="2" fill="none"/>
          <rect x="10" y="64" width="20" height="5" rx="2" fill="#b3a284" stroke="#8a7a5e" stroke-width="1"/>
        </svg>`
    },
    {
        out: 'prop-torch.png',
        width: 44,
        height: 112,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="112" viewBox="0 0 44 112">${DEFS}
          ${flame(22, 40, 18, 34)}
          <rect x="14" y="38" width="16" height="9" rx="2" fill="#4a3a26" stroke="#2e2416" stroke-width="1.5"/>
          <path d="M 17 47 L 27 47 L 24.5 106 L 19.5 106 Z" fill="url(#wood)" stroke="#3a2a18" stroke-width="1.5"/>
          <path d="M 19.5 60 L 21 60 L 20 100" stroke="#5d4326" stroke-width="1.5" fill="none"/>
        </svg>`
    },
    {
        out: 'prop-campfire-lit.png',
        width: 144,
        height: 96,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="96" viewBox="0 0 144 96">${DEFS}
          ${flame(72, 52, 30, 46)}
          ${logs(72, 62, 74, 13, 'url(#wood)', '#3a2a18')}
          ${stoneRing(72, 68, 58, 20, 9, 12, 9)}
        </svg>`
    },
    {
        out: 'prop-campfire-unlit.png',
        width: 144,
        height: 96,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="96" viewBox="0 0 144 96">${DEFS}
          <path d="M 76 40 C 70 32, 82 26, 76 16" stroke="rgba(170,170,170,0.5)" stroke-width="3" fill="none" stroke-linecap="round"/>
          ${logs(72, 62, 74, 13, 'url(#charred)', '#0f0c08')}
          ${stoneRing(72, 68, 58, 20, 9, 12, 9)}
          <circle cx="66" cy="60" r="2.5" fill="#c8452a" opacity="0.8"/>
          <circle cx="80" cy="64" r="2" fill="#c8452a" opacity="0.6"/>
        </svg>`
    },
    {
        out: 'prop-firefly.png',
        width: 36,
        height: 36,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">${DEFS}
          <circle cx="18" cy="20" r="16" fill="url(#glowGreen)"/>
          <ellipse cx="18" cy="23" rx="6" ry="8" fill="#2e3a22" stroke="#141a0e" stroke-width="1"/>
          <ellipse cx="18" cy="28" rx="5" ry="4.5" fill="#c9f79a" stroke="#7ab558" stroke-width="1"/>
          <circle cx="18" cy="13.5" r="3.5" fill="#3a4630"/>
          <path d="M 10 14 q -5 -4 -7 -1" stroke="rgba(60,70,50,0.7)" stroke-width="1.5" fill="none"/>
          <path d="M 26 14 q 5 -4 7 -1" stroke="rgba(60,70,50,0.7)" stroke-width="1.5" fill="none"/>
        </svg>`
    }
];

for (const icon of ICONS) {
    const out = await sharp(Buffer.from(icon.svg))
        .png()
        .toFile(path.join(OUT_DIR, icon.out));
    console.log(`[icon] ${icon.out}: ${out.width}x${out.height}（Manifest bounds 用此值）`);
}
console.log('点光源物品图标处理完成');
