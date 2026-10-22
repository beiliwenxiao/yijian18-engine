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
 * export-skeleton-spine.mjs —— 把骨骼资产导出为 Spine JSON（3.8）+ 图集（PNG + .atlas）
 *
 * 用法：node scripts/export-skeleton-spine.mjs <projectRoot> <skeletonFile> [outDir]
 *   例：node scripts/export-skeleton-spine.mjs example/sanguo_zhangjiao assets/skeletons/player.json
 *
 * 产物（默认写到 <projectRoot>/export/spine/<skeletonId>/）：
 *   <skeletonId>.json   Spine 骨骼 JSON（可直接喂 spine-canvas / Spine Unity / cocos-spine）
 *   atlas.png           合成图集
 *   atlas.atlas         Spine atlas 描述
 *   export-report.json  导出报告（有损项清单，见 report.lossy）
 *
 * 方向形态：每个形态导出为一个 skin（skin 名 = 形态键），目标端按方向 setSkin 切换。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [projectRootArg, skeletonArg, outArg] = process.argv.slice(2);
if (!projectRootArg || !skeletonArg) {
  console.error('用法：node scripts/export-skeleton-spine.mjs <projectRoot> <skeletonFile> [outDir]');
  process.exit(1);
}

const projectRoot = path.resolve(root, projectRootArg);
const skeletonPath = path.resolve(projectRoot, skeletonArg);
const { exportSkeletonToSpine, buildSpineAtlasText } = await import(
  pathToFileURL(path.join(root, 'src/dev/SkeletonSpineExporter.js')).href
);

const doc = JSON.parse(readFileSync(skeletonPath, 'utf8'));
const manifestPath = path.join(projectRoot, 'assets/manifests/assets.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const manifestEntries = manifest.assets || manifest.entries || [];

/** assetId → manifest 条目 */
const entryById = new Map(manifestEntries.map(entry => [entry.assetId, entry]));

/** 取素材图片的磁盘路径（找不到返回 null）。 */
function resolveImagePath(assetId) {
  const entry = entryById.get(assetId);
  const relative = entry?.runtime2D?.path || entry?.sourceFile;
  if (!relative) return null;
  const absolute = path.resolve(projectRoot, relative);
  return absolute;
}

const { json, regions, report } = exportSkeletonToSpine(doc, { atlasName: 'atlas.png' });

// ---- 图集排布（shelf 装箱，2px 间距）----
const placed = [];
for (const region of regions) {
  const sourcePath = resolveImagePath(region.assetId);
  if (!sourcePath) {
    console.warn(`跳过 region ${region.name}：manifest 未登记图片路径`);
    continue;
  }
  let meta;
  try {
    meta = await sharp(sourcePath).metadata();
  } catch (error) {
    console.warn(`跳过 region ${region.name}：图片读取失败 ${error.message}`);
    continue;
  }
  const width = region.sw > 0 ? region.sw : (meta.width || 0);
  const height = region.sh > 0 ? region.sh : (meta.height || 0);
  if (!width || !height) {
    console.warn(`跳过 region ${region.name}：图片尺寸不可读`);
    continue;
  }
  placed.push({
    name: region.name,
    assetId: region.assetId,
    sourcePath,
    sx: region.sw > 0 ? region.sx : 0,
    sy: region.sh > 0 ? region.sy : 0,
    width,
    height,
    xyX: 0,
    xyY: 0
  });
}

const GAP = 2;
const MAX_WIDTH = 2048;
let cursorX = 0;
let cursorY = 0;
let shelfHeight = 0;
for (const region of placed) {
  if (cursorX + region.width > MAX_WIDTH && cursorX > 0) {
    cursorX = 0;
    cursorY += shelfHeight + GAP;
    shelfHeight = 0;
  }
  region.xyX = cursorX;
  region.xyY = cursorY;
  cursorX += region.width + GAP;
  shelfHeight = Math.max(shelfHeight, region.height);
}
const atlasWidth = Math.max(1, cursorX - GAP);
const atlasHeight = Math.max(1, cursorY + shelfHeight);

// ---- 合成图集 ----
const composites = [];
for (const region of placed) {
  const buffer = await sharp(region.sourcePath)
    .extract({ left: region.sx, top: region.sy, width: region.width, height: region.height })
    .png()
    .toBuffer();
  composites.push({ input: buffer, left: region.xyX, top: region.xyY });
}

const outDir = outArg
  ? path.resolve(root, outArg)
  : path.join(projectRoot, 'export/spine', doc.skeletonId || 'skeleton');
mkdirSync(outDir, { recursive: true });

const atlasName = 'atlas.png';
await sharp({
  create: { width: atlasWidth, height: atlasHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
})
  .composite(composites)
  .png()
  .toFile(path.join(outDir, atlasName));

writeFileSync(path.join(outDir, `${doc.skeletonId || 'skeleton'}.json`), `${JSON.stringify(json, null, 2)}\n`);
writeFileSync(path.join(outDir, `${atlasName}.atlas`), buildSpineAtlasText(placed, {
  pageName: atlasName,
  width: atlasWidth,
  height: atlasHeight
}));
writeFileSync(path.join(outDir, 'export-report.json'), `${JSON.stringify({ ...report, regions: placed }, null, 2)}\n`);

console.log(`已导出 ${doc.skeletonId} → ${path.relative(root, outDir)}`);
console.log(`  骨骼 ${report.boneCount} / 槽位 ${report.slotCount} / 剪辑 ${report.animationCount} / 皮肤 ${report.skinCount}`);
console.log(`  图集 ${atlasName}（${atlasWidth}×${atlasHeight}，${placed.length} region）`);
if (report.lossy.length > 0) {
  console.log(`  有损项 ${report.lossy.length} 条（见 export-report.json）：`);
  for (const item of report.lossy.slice(0, 8)) {
    console.log(`    - ${item.feature}${item.slot ? ` [${item.slot}]` : ''}${item.bone ? ` [${item.bone}]` : ''}：${item.reason}`);
  }
  if (report.lossy.length > 8) console.log(`    …其余 ${report.lossy.length - 8} 条见报告`);
}
