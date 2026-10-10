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
 * calibrate-player-arm-anchors.mjs
 * 手臂部件重绘（generate-player-arm-parts.mjs，关节在画布中心）后的锚点校准（幂等）：
 *   - 4 个手臂槽位挂点归零 (0,0)：肩/肘关节精确落在骨骼原点
 *   - 5 件武器 + toolHand 统一挂到前臂手部位置 (0,13)（前臂骨长 13）
 *   - 后续细调在骨骼编辑器里拖动挂件即可（拖图=改偏移）
 * 用法：node scripts/calibrate-player-arm-anchors.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons/player.json');
const skel = JSON.parse(readFileSync(file, 'utf8'));

// 槽位 id → 新挂点
const ANCHORS = {
  armUL: [0, 0],
  armUR: [0, 0],
  armFL: [0, 0],
  armFR: [0, 0],
  weaponSpear: [0, 13],
  weaponSkinningKnife: [0, 13],
  weaponWolfFang: [0, 13],
  weaponBow: [0, 13],
  weaponStaff: [0, 13],
  toolHand: [0, 13]
};

let changed = 0;
for (const slot of skel.slots || []) {
  const anchor = ANCHORS[slot.id];
  if (!anchor || !slot.attachment || slot.attachment.type === 'empty') continue;
  const [x, y] = anchor;
  if (slot.attachment.x !== x || slot.attachment.y !== y) {
    console.log(`${slot.id}: (${slot.attachment.x},${slot.attachment.y}) → (${x},${y})`);
    slot.attachment.x = x;
    slot.attachment.y = y;
    changed++;
  }
}

writeFileSync(file, JSON.stringify(skel, null, 2) + '\n', 'utf8');
console.log(`完成：更新 ${changed} 个挂点`);
