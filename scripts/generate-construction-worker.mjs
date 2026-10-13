/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-10-11
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * generate-construction-worker.mjs
 * 生成「建筑工人作业」4 帧雪碧图（抡锤敲击：举锤→下砸→砸实+尘土→回位），
 * 并登记进 assets.json（manifest，幂等）。
 * 用于小庇护所等施工期间在施工点旁循环播放的作业表现。
 *
 * 帧布局：192×48 横排 4 帧（每帧 48×48，脚底 y≈44，工人面向左、左侧为木桩）。
 * 用法：node scripts/generate-construction-worker.mjs
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'example/sanguo_zhangjiao/assets/images/units');
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'worker-build.png');

/* ---------------- 调色板（与部件图同族） ---------------- */
const STRAW = { o: '#4a3410', b: '#c8a050', l: '#e2c078', d: '#a07c38' };   // 斗笠
const CLOTH = { o: '#241609', b: '#7a5230', l: '#94683e', d: '#5a3c22', d2: '#3e2815' }; // 褐短打
const SKIN = { o: '#3a2418', b: '#d8a878', l: '#e6bc8e', d: '#b8875a' };    // 皮肤
const IRON = { o: '#15161a', b: '#767e8a', l: '#959daa', d: '#4c525c' };    // 锤头
const HANDLE = { o: '#1f150c', b: '#8a6238', l: '#a67b47', d: '#6b4a26' };  // 锤柄
const STUMP = { o: '#1f150c', b: '#8a6238', l: '#a67b47', d: '#5c3f20', d2: '#402a14' }; // 木桩
const DUST = ['#b0a898', '#9a9284', '#847c70'];

const rect = (x, y, w, h, f) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"/>`;
const svg = (w, h, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" shape-rendering="crispEdges">${inner}</svg>`;

/** 描边块：1 圈 outline + 基色 + 左亮条 + 右暗条。 */
function block(x, y, w, h, p, stripW = 2) {
  return rect(x - 1, y - 1, w + 2, h + 2, p.o) + rect(x, y, w, h, p.b)
    + rect(x, y, Math.min(stripW, w), h, p.l) + rect(x + w - Math.min(stripW, w), y, Math.min(stripW, w), h, p.d);
}

/**
 * 绘制单帧（48×48，脚底 y≈44）。
 * @param {object} pose 姿态参数
 *   hammer: {hx, hy, ang} 锤头左上角位置；handle: [x1,y1,x2,y2] 锤柄线段端点
 *   lean: 身体前倾像素（头/躯干左移）；arms: [[x,y,w,h],...] 手臂块
 *   dust: 是否绘制尘土粒子
 */
function frameSvg(pose) {
  const { hammer, handle, lean = 0, arms = [], dust = false } = pose;
  const bx = 26 - lean;          // 躯干左缘
  const parts = [];

  // 木桩（工人左前方，砸击目标）
  parts.push(block(9, 33, 12, 11, STUMP));
  parts.push(rect(9, 33, 12, 2, STUMP.l));       // 顶面亮
  parts.push(rect(11, 35, 2, 7, STUMP.d2));      // 年轮暗纹

  // 双腿（直立，脚下 44）
  parts.push(block(26, 28, 4, 14, CLOTH.d, 1));  // 左腿（裤）
  parts.push(block(31, 28, 4, 14, CLOTH.d, 1));
  parts.push(block(25, 41, 6, 3, CLOTH.o, 1));   // 鞋
  parts.push(block(30, 41, 6, 3, CLOTH.o, 1));

  // 躯干（褐短打）+ 腰带
  parts.push(block(bx, 16, 9, 13, CLOTH));
  parts.push(rect(bx, 25, 9, 2, CLOTH.d2));      // 腰带

  // 头 + 斗笠
  parts.push(block(bx + 1, 10, 7, 7, SKIN, 1));
  parts.push(rect(bx + 2, 14, 5, 1, SKIN.d));    // 下巴阴影
  parts.push(block(bx - 3, 5, 15, 5, STRAW));    // 斗笠（宽檐）
  parts.push(rect(bx + 1, 4, 7, 2, STRAW.l));    // 笠顶亮
  parts.push(rect(bx - 3, 9, 15, 1, STRAW.d));   // 檐口暗

  // 手臂（先画臂再画锤柄，柄压在手上）
  for (const [ax, ay, aw, ah] of arms) parts.push(block(ax, ay, aw, ah, SKIN, 1));

  // 锤柄 + 锤头
  parts.push(`<line x1="${handle[0]}" y1="${handle[1]}" x2="${handle[2]}" y2="${handle[3]}" stroke="${HANDLE.b}" stroke-width="2"/>`);
  parts.push(rect(handle[0] - 1, handle[1] - 1, 2, 2, HANDLE.o));
  parts.push(block(hammer.hx, hammer.hy, 9, 7, IRON));
  parts.push(rect(hammer.hx + 1, hammer.hy + 1, 2, 5, IRON.l));  // 锤面高光

  // 尘土粒子（砸实帧）
  if (dust) {
    parts.push(rect(6, 30, 2, 2, DUST[0]));
    parts.push(rect(22, 28, 2, 2, DUST[1]));
    parts.push(rect(15, 25, 2, 2, DUST[2]));
    parts.push(rect(4, 40, 2, 2, DUST[1]));
  }

  return svg(48, 48, parts.join(''));
}

/* ---------------- 4 帧姿态 ---------------- */
const FRAMES = [
  // 帧 0 举锤：双臂高举过头顶，锤在右上，身体微后仰（lean 负=右移）
  frameSvg({
    hammer: { hx: 36, hy: 3 },
    handle: [31, 14, 40, 8],
    lean: -1,
    arms: [[30, 12, 3, 7], [33, 9, 3, 8]]
  }),
  // 帧 1 下砸：锤落向木桩顶，身体前倾
  frameSvg({
    hammer: { hx: 8, hy: 26 },
    handle: [26, 20, 13, 28],
    lean: 2,
    arms: [[24, 18, 6, 3], [23, 20, 5, 3]]
  }),
  // 帧 2 砸实：锤贴桩 + 尘土
  frameSvg({
    hammer: { hx: 7, hy: 27 },
    handle: [26, 21, 12, 29],
    lean: 2,
    arms: [[24, 19, 6, 3], [23, 21, 5, 3]],
    dust: true
  }),
  // 帧 3 回位：锤收至腰侧竖立
  frameSvg({
    hammer: { hx: 33, hy: 17 },
    handle: [35, 24, 35, 34],
    lean: 0,
    arms: [[31, 19, 3, 5], [34, 22, 3, 4]]
  })
];

/* ---------------- 合成横排雪碧图 ---------------- */
const frameBuffers = await Promise.all(FRAMES.map(f => sharp(Buffer.from(f)).png().toBuffer()));
await sharp({
  create: { width: 192, height: 48, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
})
  .composite(frameBuffers.map((input, index) => ({ input, left: index * 48, top: 0 })))
  .png()
  .toFile(outFile);

const meta = await sharp(outFile).metadata();
console.log(`已生成 ${path.relative(root, outFile)}（${meta.width}×${meta.height}，4 帧）`);

/* ---------------- 登记 manifest（assets.json，CRLF，幂等） ---------------- */
const manifestPath = path.join(root, 'example/sanguo_zhangjiao/assets/manifests/assets.json');
const eolM = readFileSync(manifestPath, 'utf8').includes('\r\n') ? '\r\n' : '\n';
let manifest = readFileSync(manifestPath, 'utf8');

const assetId = 'units.worker-build';
const relFile = 'assets/images/units/worker-build.png';

if (!manifest.includes(`"${assetId}"`)) {
  const entry = [
    '    {',
    `      "assetId": "${assetId}",`,
    `      "imageId": "${assetId}",`,
    '      "category": "effect",',
    '      "usage": [',
    '        "scene-effect"',
    '      ],',
    `      "sourceFile": "${relFile}",`,
    '      "runtime2D": {',
    `        "path": "${relFile}",`,
    '        "mode": "image"',
    '      },',
    '      "runtime3D": {',
    '        "mode": "billboard",',
    `        "sourceAssetId": "${assetId}"`,
    '      },',
    '      "pivot": {',
    '        "x": 0.5,',
    '        "y": 1.0',
    '      },',
    '      "bounds": {',
    '        "width": 192,',
    '        "height": 48',
    '      },',
    '      "grid": {',
    '        "columns": 4,',
    '        "rows": 1,',
    '        "cellWidth": 48,',
    '        "cellHeight": 48',
    '      },',
    '      "animations": [],',
    '      "targetPhase": "P1",',
    '      "status": "placeholder",',
    '      "revision": 1',
    '    }'
  ].join(eolM);

  const tailAnchor = manifest.lastIndexOf(eolM + '  ]');
  if (tailAnchor < 0) throw new Error('manifest 尾部锚点未找到');
  const head = manifest.slice(0, tailAnchor);
  const tail = manifest.slice(tailAnchor);
  manifest = head + ',' + eolM + entry + tail;
  writeFileSync(manifestPath, manifest);
  console.log('manifest 已登记', assetId);
} else {
  console.log('manifest 已登记过，跳过');
}

JSON.parse(readFileSync(manifestPath, 'utf8'));
console.log('manifest JSON 校验通过');
