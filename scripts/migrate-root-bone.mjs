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
 * migrate-root-bone.mjs —— 骨骼结构迁移：删除 root 定位骨，提拔其唯一子骨骼为根
 * （对齐 Spine/Unity 惯例：骨盆/躯干即骨架根，实体定位由渲染原点=脚底承担）。
 *
 * 迁移语义（世界位置零位移）：
 *   - 前提：root 位于 (0,0) 且无旋转/缩放（纯定位点）；恰有一个直接子骨骼。
 *   - 子骨骼提拔为根：局部坐标保持不变。运行时根骨骼局部 x/y 即世界偏移
 *     （SkeletonPose._resolve：无 parent 时 world = local），故世界位置不变。
 *   - 槽位：bone:'root' → 新根；type:'image' 挂件按世界位置反算偏移补偿。
 *   - 轨道：bone:'root' → 新根。**键值是绝对局部值（替换 rest）**，root rest 在原点
 *     而新根 rest 非（如 hips y=-26），故 root 键迁入前必须加新根 rest 偏移，
 *     否则播放动画时全身会沉到脚底（碰撞椭圆与人物错位）。
 *     与新根已有轨道同 t 合并时：原 hips 世界 = root键 + hips键（平移近似）→ 键值相加。
 * 用法：node scripts/migrate-root-bone.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skeletonDir = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons');
const { validateSkeletonAsset } = await import(pathToFileURL(path.join(root, 'src/core/validation/SkeletonAssetValidator.js')).href);

/** 递归收集骨架 JSON 文件（跳过 anim-presets 索引/预设由通用扫描覆盖）。 */
function walkJson(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkJson(full);
    return entry.name.endsWith('.json') && entry.name !== 'index.json' ? [full] : [];
  });
}

/** 键值补偿：root 键值（原 root 世界偏移，root rest 在原点）→ 新根局部键值（绝对语义，加新根 rest）。 */
function shiftKeyToRest(key, rest) {
  const next = { ...key };
  if (next.x != null) next.x = Math.round((next.x + rest.x) * 100) / 100;
  if (next.y != null) next.y = Math.round((next.y + rest.y) * 100) / 100;
  if (next.rot != null) next.rot = Math.round((next.rot + rest.rot) * 100) / 100;
  if (next.scaleX != null) next.scaleX = Math.round(next.scaleX * (rest.sx || 1) * 100) / 100;
  if (next.scaleY != null) next.scaleY = Math.round(next.scaleY * (rest.sy || 1) * 100) / 100;
  return next;
}

/** 合并键序列。语义：原 hips 世界 = root 键 + hips 键（平移近似），故
 *  - 同 t 双方存在：键值相加（用 root 原值，不 shift）；
 *  - hips 缺键/缺字段（root 单方）：root 世界贡献 = root 键 + hips rest → 用 shift 补偿值。 */
function mergeKeys(targetKeys, incomingKeys, rest) {
  const shifted = incomingKeys.map(key => shiftKeyToRest(key, rest));
  const merged = [...targetKeys.map(key => ({ ...key }))];
  incomingKeys.forEach((incoming, index) => {
    const shiftedKey = shifted[index];
    const hit = merged.find(key => Math.abs(key.t - incoming.t) <= 2);
    if (!hit) {
      merged.push({ ...shiftedKey });
      return;
    }
    for (const field of ['x', 'y', 'rot', 'scaleX', 'scaleY']) {
      const a = hit[field];
      const b = incoming[field];
      if (a == null && b == null) continue;
      if (a == null) hit[field] = shiftedKey[field]; // hips 缺字段：root 世界 + hips rest
      else if (b == null) { /* 保留目标值（已是绝对局部值） */ }
      else if (field === 'scaleX' || field === 'scaleY') hit[field] = Math.round(a * b * 100) / 100;
      else hit[field] = Math.round((a + b) * 100) / 100;
    }
    if (hit.ease == null && incoming.ease != null) hit.ease = incoming.ease;
  });
  merged.sort((a, b) => a.t - b.t);
  return merged;
}

let migrated = 0;
let skipped = 0;

for (const file of walkJson(skeletonDir)) {
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const bones = doc.bones;
  if (!Array.isArray(bones)) {
    // 动作预设（顶层 tracks）：bone==='root' 直接改名到对应拓扑新根由人工确认——扫描确认当前无 root 轨道
    if (Array.isArray(doc.tracks) && doc.tracks.some(track => track.bone === 'root')) {
      throw new Error(`预设 ${path.relative(skeletonDir, file)} 含 root 轨道，需人工指定新根`);
    }
    continue;
  }
  const rootBone = bones.find(bone => bone.parent === null && bone.id === 'root');
  if (!rootBone) { skipped++; continue; }
  if (rootBone.x !== 0 || rootBone.y !== 0 || rootBone.rot !== 0 || rootBone.scaleX !== 1 || rootBone.scaleY !== 1) {
    throw new Error(`${path.relative(skeletonDir, file)}: root 不在原点/含变换，需人工处理`);
  }
  const children = bones.filter(bone => bone.parent === 'root');
  if (children.length !== 1) {
    throw new Error(`${path.relative(skeletonDir, file)}: root 有 ${children.length} 个直接子骨骼，需人工处理`);
  }
  const newRoot = children[0];
  newRoot.parent = null; // 局部坐标保持：根骨骼局部=世界偏移，世界位置不变

  // 槽位迁移：root → 新根；image 挂件反算偏移保持世界位置
  for (const slot of doc.slots || []) {
    if (slot.bone !== 'root') continue;
    const attachment = slot.attachment;
    if (attachment && attachment.type === 'image') {
      attachment.x = Math.round(((attachment.x || 0) - newRoot.x) * 10) / 10;
      attachment.y = Math.round(((attachment.y || 0) - newRoot.y) * 10) / 10;
    }
    slot.bone = newRoot.id;
  }

  // 轨道迁移：root 轨道并入新根轨道（键值补偿新根 rest 后合并/改名）
  const newRootRest = { x: newRoot.x, y: newRoot.y, rot: newRoot.rot || 0, sx: newRoot.scaleX ?? 1, sy: newRoot.scaleY ?? 1 };
  for (const clip of doc.clips || []) {
    const rootTrack = (clip.tracks || []).find(track => track.bone === 'root');
    if (!rootTrack) continue;
    const shiftedKeys = (rootTrack.keys || []).map(key => {
      if (key.rot != null || key.scaleX != null || key.scaleY != null) {
        throw new Error(`${path.relative(skeletonDir, file)}: root 轨道含旋转/缩放键，平移近似合并不适用，需人工处理`);
      }
      return shiftKeyToRest(key, newRootRest);
    });
    const targetTrack = clip.tracks.find(track => track.bone === newRoot.id);
    if (targetTrack) {
      targetTrack.keys = mergeKeys(targetTrack.keys, rootTrack.keys || [], newRootRest);
    } else {
      clip.tracks.push({ bone: newRoot.id, keys: shiftedKeys });
    }
    clip.tracks = clip.tracks.filter(track => track !== rootTrack);
  }

  // 删除 root 骨
  doc.bones = bones.filter(bone => bone.id !== 'root');

  // 自校验
  const validation = validateSkeletonAsset(structuredClone(doc));
  if (!validation.ok) {
    throw new Error(`${path.relative(skeletonDir, file)} 迁移后校验失败: ${JSON.stringify(validation.errors)}`);
  }

  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  console.log('已迁移', path.relative(skeletonDir, file), '→ 新根:', newRoot.id);
  migrated++;
}

console.log(`完成：迁移 ${migrated} 份，跳过 ${skipped} 份（无 root）`);
