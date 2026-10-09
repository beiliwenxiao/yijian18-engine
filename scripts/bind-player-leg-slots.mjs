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
 * bind-player-leg-slots.mjs
 * 为 player.json 绑定腿部部件槽位（大腿×2/小腿×2，幂等）：
 *   - 部件图关节在画布中心（generate-player-leg-parts.mjs 生成），挂点偏移 (0,0) 即对齐骨骼
 *   - z=2：位于背景背矛(z1)之后、躯干(z5)/前裙(z6)之前，腿部在袍下若隐若现
 * 用法：node scripts/bind-player-leg-slots.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons/player.json');
const skel = JSON.parse(readFileSync(file, 'utf8'));
skel.slots = skel.slots || [];

const LEG_SLOTS = [
  { id: 'legThighL', bone: 'thighL', assetId: 'player.parts.thigh-l', partId: 'part.thigh.l' },
  { id: 'legThighR', bone: 'thighR', assetId: 'player.parts.thigh-r', partId: 'part.thigh.r' },
  { id: 'legCalfL', bone: 'calfL', assetId: 'player.parts.calf-l', partId: 'part.calf.l' },
  { id: 'legCalfR', bone: 'calfR', assetId: 'player.parts.calf-r', partId: 'part.calf.r' }
];

let added = 0;
for (const leg of LEG_SLOTS) {
  if (skel.slots.some(slot => slot.attachment?.partId === leg.partId)) {
    console.log('跳过（已存在）:', leg.id);
    continue;
  }
  skel.slots.push({
    id: leg.id,
    bone: leg.bone,
    z: 2,
    attachment: { type: 'image', assetId: leg.assetId, partId: leg.partId, x: 0, y: 0, rot: 0, width: 64, height: 64 }
  });
  added++;
}

writeFileSync(file, JSON.stringify(skel, null, 2) + '\n', 'utf8');
console.log(`完成：新增 ${added} 个腿部槽位，共 ${skel.slots.length} 个槽位`);
