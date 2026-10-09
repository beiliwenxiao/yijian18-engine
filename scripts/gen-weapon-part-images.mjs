/**
 * 生成玩家骨骼部件武器图（64×64 像素风，透明底）
 *
 * 覆盖：剥皮刀 / 狼牙匕首 / 短弓 / 符杖（手持形态，柄部朝左下便于挂 armFR）。
 * 用法：node scripts/gen-weapon-part-images.mjs
 * 输出：example/sanguo_zhangjiao/assets/images/player/parts/weapon-*.png
 * manifest 与 library.skeletonParts 由调用方另行登记（本脚本只产图）。
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'example/sanguo_zhangjiao/assets/images/player/parts');
mkdirSync(outDir, { recursive: true });

/** 64×64 SVG 画布包装 */
const svg = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${inner}</svg>`;

/* 剥皮刀：短柄斜握，弯刃小刀（刃口银灰、柄深棕） */
const skinningKnife = svg(`
  <g stroke="#1a1410" stroke-width="1">
    <path d="M14 50 L26 38" stroke="#5a3a22" stroke-width="5" stroke-linecap="round" fill="none"/>
    <path d="M24 40 C34 30 44 22 54 14 C52 24 46 36 32 44 Z" fill="#c8ccd4"/>
    <path d="M27 42 C36 34 44 26 51 18 C49 25 44 34 33 41 Z" fill="#eef1f5" stroke="none"/>
    <path d="M24 40 L28 44" stroke="#3a2a1a" stroke-width="3" stroke-linecap="round" fill="none"/>
  </g>
  <circle cx="14" cy="50" r="2.5" fill="#8a5a32"/>
`);

/* 狼牙匕首：弯月獠牙（牙尖朝右上，根部缠绕皮绳短柄） */
const wolfFang = svg(`
  <g stroke="#1a1410" stroke-width="1">
    <path d="M18 50 C20 42 26 32 36 22 C44 14 52 10 56 8 C52 18 46 28 38 36 C32 42 26 47 22 50 Z" fill="#f0ead8"/>
    <path d="M22 49 C26 44 32 37 40 29 C46 23 51 17 54 11 C51 19 45 27 37 35 C31 41 26 46 23 48 Z" fill="#d8d0b8" stroke="none"/>
    <path d="M14 52 L22 46" stroke="#5a3a22" stroke-width="6" stroke-linecap="round" fill="none"/>
    <path d="M16 54 L20 50" stroke="#8a5a32" stroke-width="6" stroke-linecap="round" fill="none"/>
    <path d="M13 49 L19 55" stroke="#3a2a1a" stroke-width="1.5" fill="none"/>
    <path d="M16 46 L22 52" stroke="#3a2a1a" stroke-width="1.5" fill="none"/>
  </g>
`);

/* 短弓：竖置弓身（棕木弧+米白弦），微斜便于手持 */
const shortBow = svg(`
  <g stroke="#1a1410" stroke-width="1">
    <path d="M40 8 C56 20 56 44 40 56" stroke="#6a4426" stroke-width="4.5" fill="none" stroke-linecap="round"/>
    <path d="M40 8 C54 20 54 44 40 56" stroke="#8a5c34" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M40 9 L40 55" stroke="#e8e4d8" stroke-width="1.5" fill="none"/>
    <path d="M38 6 L42 10 M38 58 L42 54" stroke="#4a3020" stroke-width="2.5" stroke-linecap="round" fill="none"/>
    <path d="M42 24 L46 28 L42 32 L38 28 Z" fill="#c8b470"/>
    <path d="M38 30 L34 34 L38 38 L42 34 Z" fill="#c8b470"/>
  </g>
`);

/* 符杖：斜握长杖（深木纹），顶端系黄符纸+红绳 */
const staff = svg(`
  <g stroke="#1a1410" stroke-width="1">
    <path d="M16 56 L44 16" stroke="#4a3020" stroke-width="4" stroke-linecap="round" fill="none"/>
    <path d="M17 54 L43 17" stroke="#6a4830" stroke-width="1.5" stroke-linecap="round" fill="none"/>
    <path d="M42 8 L54 16 L46 28 L34 20 Z" fill="#e8d488"/>
    <path d="M44 12 L50 16" stroke="#b04838" stroke-width="1.5" fill="none"/>
    <path d="M46 10 L48 20" stroke="#b04838" stroke-width="1.5" fill="none"/>
    <path d="M40 14 L36 22 L44 26" stroke="#c8a850" stroke-width="1.5" fill="none"/>
    <circle cx="45" cy="17" r="2" fill="#b04838"/>
  </g>
`);

const jobs = [
  ['weapon-skinningKnife', skinningKnife],
  ['weapon-wolfFang', wolfFang],
  ['weapon-bow', shortBow],
  ['weapon-staff', staff]
];

for (const [name, body] of jobs) {
  const out = join(outDir, `${name}.png`);
  await sharp(Buffer.from(body)).png().toFile(out);
  console.log('生成', out);
}
console.log('完成：4 张武器部件图');
