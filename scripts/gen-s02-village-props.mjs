/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-10-27
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

/**
 * S02 破村庄素材处理管线（M3.5）：
 * Temp/s02-gen/*-raw.jpg（品红底生成图）→ 品红抠透明 → 内容裁边 → 目标高缩放
 * → example/sanguo_zhangjiao/assets/images/s02/*.png
 * 背景（wasteland-ground）无透明需求，仅缩放为 1280×720。
 *
 * 用法：node scripts/gen-s02-village-props.mjs
 */

import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'Temp', 's02-gen');
const OUT_DIR = path.join(ROOT, 'example', 'sanguo_zhangjiao', 'assets', 'images', 's02');

fs.mkdirSync(OUT_DIR, { recursive: true });

/** 品红判定（r/b 高、g 明显低） */
function isMagenta(r, g, b) {
    return b > 90 && r > 90 && g < Math.min(r, b) * 0.7;
}

/** 道具：品红抠透明 + 内容 bbox 裁边 + 目标高缩放 */
async function processProp(rawName, outName, targetHeight) {
    const src = path.join(SRC_DIR, rawName);
    const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    const px = channels === 4 ? 4 : 4;

    // 1) 抠品红 + 记录内容 bbox
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * px;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            if (isMagenta(r, g, b)) {
                data[i + 3] = 0;
            } else {
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < 0) throw new Error(`${rawName}: 未检测到前景内容`);

    // 2) 裁边留 4px 呼吸边
    const pad = 4;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(width - 1, maxX + pad);
    maxY = Math.min(height - 1, maxY + pad);
    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;

    // 3) 输出
    const out = await sharp(data, { raw: { width, height, channels: 4 } })
        .extract({ left: minX, top: minY, width: cropW, height: cropH })
        .resize({ height: targetHeight })
        .png()
        .toFile(path.join(OUT_DIR, outName));
    console.log(`[prop] ${outName}: ${cropW}x${cropH} -> ${out.width}x${out.height}`);
}

/** 背景：直接缩放为 1280×720 场景尺寸 */
async function processBackground(rawName, outName) {
    const out = await sharp(path.join(SRC_DIR, rawName))
        .resize(1280, 720, { fit: 'cover' })
        .png()
        .toFile(path.join(OUT_DIR, outName));
    console.log(`[bg] ${outName}: ${out.width}x${out.height}`);
}

await processBackground('wasteland-ground-raw.jpg', 'wasteland-ground.png');
await processProp('big-tree-raw.jpg', 'big-tree.png', 420);
await processProp('small-tree-raw.jpg', 'small-tree.png', 190);
await processProp('grass-lamp-raw.jpg', 'grass-lamp.png', 210);
await processProp('broken-hut-raw.jpg', 'broken-hut.png', 190);
await processProp('porridge-cauldron-raw.jpg', 'porridge-cauldron.png', 130);
console.log('S02 村庄素材处理完成');
