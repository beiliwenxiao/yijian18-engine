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
 * SkeletonBindService.js —— 骨骼动画编辑器「🧷 绑骨」的服务端内核。
 *
 * 输入一张设计图截图 + 浏览器当前骨架 + 用户在图上点的关节像素坐标：
 *   1. 由「骨起点 → 子骨起点」换算骨段（叶子骨用 length/末端坐标补足）；
 *   2. 复用 scripts/skeleton-pipeline/lib/sheet-partition.mjs 分区 + 打包；
 *   3. 每块内容中心相对骨起点换算成骨骼局部偏移（抵消骨 rest 旋转）。
 *
 * 只返回 JSON（图集 PNG 走 base64），不写盘——写盘由编辑器沿用现有保存通道完成。
 */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { partitionSheet, composeAtlasPixels } from '../../scripts/skeleton-pipeline/lib/sheet-partition.mjs';

const DEG2RAD = Math.PI / 180;
const IMAGE_EXTENSION = /\.(png|jpe?g|webp)$/i;

function failure(message) {
  return Object.assign(new Error(message), { statusCode: 422 });
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finitePoint(point) {
  return Boolean(point) && finiteNumber(point.x) !== null && finiteNumber(point.y) !== null;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * 计算静止姿态下每根骨骼的世界原点与累计旋转（角度制，y 向下）。
 * 只用于把设计单位末端/偏移换算到像素，不参与任何运行时行为。
 * @param {Array<{name:string,parent:string|null,x:number,y:number,rot:number}>} bones
 * @returns {Map<string,{name:string,x:number,y:number,rot:number}>}
 */
export function computeRestWorldBones(bones) {
  const list = Array.isArray(bones) ? bones : [];
  const byName = new Map();
  for (const bone of list) {
    if (bone?.name && !byName.has(bone.name)) byName.set(bone.name, bone);
  }
  const world = new Map();
  const resolving = new Set();
  const resolve = (bone) => {
    if (!bone) return null;
    if (world.has(bone.name)) return world.get(bone.name);
    if (resolving.has(bone.name)) throw failure(`骨骼父子关系存在环: ${bone.name}`);
    resolving.add(bone.name);
    const parent = bone.parent ? resolve(byName.get(bone.parent)) : null;
    const localX = finiteNumber(bone.x) || 0;
    const localY = finiteNumber(bone.y) || 0;
    const rot = (parent?.rot || 0) + (finiteNumber(bone.rot) || 0);
    let x;
    let y;
    if (parent) {
      const parentRad = parent.rot * DEG2RAD;
      const cos = Math.cos(parentRad);
      const sin = Math.sin(parentRad);
      x = parent.x + localX * cos - localY * sin;
      y = parent.y + localX * sin + localY * cos;
    } else {
      x = localX;
      y = localY;
    }
    const result = { name: bone.name, x, y, rot };
    world.set(bone.name, result);
    resolving.delete(bone.name);
    return result;
  };
  for (const bone of list) resolve(bone);
  return world;
}

/**
 * 由关节像素坐标 + 骨长度换算骨段。
 * 骨段 a = 本骨像素起点（pxJoints），b = 子骨像素起点；叶子骨用 endX/endY 或 length 推算末端。
 * 未采集关节的骨，用最近的已采集祖先 + 静止世界位移反推，保证部分采集也能出图。
 * @returns {{segments:Array<{key:string,a:{x:number,y:number},b:{x:number,y:number}}>, world:Map, pixels:Map}}
 */
export function buildBindSegments({ bones, pxJoints, pxPerUnit } = {}) {
  const list = Array.isArray(bones) ? bones : [];
  const pxPer = finiteNumber(pxPerUnit);
  if (!(pxPer > 0)) throw failure('pxPerUnit 必须大于 0');
  const joints = pxJoints && typeof pxJoints === 'object' ? pxJoints : {};
  const world = computeRestWorldBones(list);
  const pixelOrigins = new Map();
  for (const bone of list) {
    const joint = joints[bone.name];
    if (finitePoint(joint)) pixelOrigins.set(bone.name, { x: Number(joint.x), y: Number(joint.y) });
  }
  // 未采集关节：沿父链找最近的已采集祖先，用世界位移差换算像素位置
  const byName = new Map(list.filter(bone => bone?.name).map(bone => [bone.name, bone]));
  for (const bone of list) {
    if (!bone?.name || pixelOrigins.has(bone.name)) continue;
    let ancestor = bone.parent;
    const visited = new Set();
    while (ancestor && !pixelOrigins.has(ancestor) && !visited.has(ancestor)) {
      visited.add(ancestor);
      ancestor = byName.get(ancestor)?.parent;
    }
    if (!ancestor || !pixelOrigins.has(ancestor)) continue;
    const ancestorWorld = world.get(ancestor);
    const boneWorld = world.get(bone.name);
    if (!ancestorWorld || !boneWorld) continue;
    const anchor = pixelOrigins.get(ancestor);
    pixelOrigins.set(bone.name, {
      x: anchor.x + (boneWorld.x - ancestorWorld.x) * pxPer,
      y: anchor.y + (boneWorld.y - ancestorWorld.y) * pxPer
    });
  }

  const childrenOf = new Map();
  for (const bone of list) {
    if (!bone?.name || !bone.parent) continue;
    if (!childrenOf.has(bone.parent)) childrenOf.set(bone.parent, []);
    childrenOf.get(bone.parent).push(bone.name);
  }

  const segments = [];
  for (const bone of list) {
    if (!bone?.name) continue;
    const start = pixelOrigins.get(bone.name);
    if (!start) continue;
    let end = null;
    const childName = (childrenOf.get(bone.name) || []).find(name => pixelOrigins.has(name));
    if (childName) {
      end = pixelOrigins.get(childName);
    } else {
      const boneWorld = world.get(bone.name);
      if (boneWorld) {
        const endX = finiteNumber(bone.endX);
        const endY = finiteNumber(bone.endY);
        if (endX !== null && endY !== null) {
          end = { x: start.x + (endX - boneWorld.x) * pxPer, y: start.y + (endY - boneWorld.y) * pxPer };
        } else {
          const length = finiteNumber(bone.length) || 0;
          // 叶子骨：优先沿「父骨 → 本骨」方向延续 length（再接一段手臂/头等），
          // 没有父骨像素时退回骨骼自身 +x 朝向（与编辑器骨条末端同一口径）。
          const parentPixel = bone.parent ? pixelOrigins.get(bone.parent) : null;
          let dx = 0;
          let dy = 0;
          if (parentPixel) {
            const vx = start.x - parentPixel.x;
            const vy = start.y - parentPixel.y;
            const len = Math.hypot(vx, vy);
            if (len > 1e-6) { dx = vx / len; dy = vy / len; }
          }
          if (dx === 0 && dy === 0) {
            const rad = boneWorld.rot * DEG2RAD;
            dx = Math.cos(rad);
            dy = Math.sin(rad);
          }
          end = {
            x: start.x + dx * length * pxPer,
            y: start.y + dy * length * pxPer
          };
        }
      }
    }
    segments.push({ key: bone.name, a: { ...start }, b: end ? { ...end } : { ...start } });
  }
  return { segments, world, pixels: pixelOrigins };
}

/** 识别头部骨名（颈线以上像素归它）。 */
function pickHeadKey(bones, segments) {
  const segmentKeys = new Set(segments.map(segment => segment.key));
  for (const name of ['head', 'headAll', 'Head', 'HEAD']) {
    if (segmentKeys.has(name)) return name;
  }
  const matched = (Array.isArray(bones) ? bones : []).find(bone => bone?.name && /head/i.test(bone.name));
  return matched && segmentKeys.has(matched.name) ? matched.name : '';
}

/**
 * 绑骨主入口：读源图 → 分区打包 → 挂点换算。
 *
 * @param {Object} params
 * @param {string} params.sourceAbsolutePath 源图绝对路径（已由路由白名单校验）
 * @param {Array<{name:string,parent:string|null,x:number,y:number,rot:number,endX?:number,endY?:number,length?:number}>} params.bones
 * @param {number} params.pxPerUnit 源图像素 / 骨骼设计单位
 * @param {number} [params.designHeight] 设计高度（可选，仅用于契约完整性）
 * @param {Object} params.pxJoints 骨名 -> 源图关节像素坐标
 * @param {number} [params.atlasWidth=512]
 * @param {number} [params.headCutoff] 颈线像素 y（缺省取 neck 关节 y）
 * @returns {Promise<{ok:true, atlas:{width:number,height:number}, atlasPngBase64:string, parts:Array, stats:Object}>}
 */
export async function bindSkeletonParts({
  sourceAbsolutePath,
  bones,
  pxPerUnit,
  designHeight,
  pxJoints,
  atlasWidth,
  headCutoff
} = {}) {
  const list = Array.isArray(bones) ? bones.filter(bone => bone?.name) : [];
  if (list.length === 0) throw failure('bones 不能为空');
  const pxPer = finiteNumber(pxPerUnit);
  if (!(pxPer > 0)) throw failure('pxPerUnit 必须大于 0');

  const absoluteSource = String(sourceAbsolutePath || '').trim();
  if (!absoluteSource || !path.isAbsolute(absoluteSource) || !IMAGE_EXTENSION.test(absoluteSource)) {
    throw failure('sourceAbsolutePath 必须是 png/jpg/webp 的绝对路径');
  }
  if (!fs.existsSync(absoluteSource) || !fs.statSync(absoluteSource).isFile()) {
    throw failure('源图不存在');
  }

  const joints = pxJoints && typeof pxJoints === 'object' ? pxJoints : {};
  const built = buildBindSegments({ bones: list, pxJoints: joints, pxPerUnit: pxPer });
  if (built.segments.length === 0) throw failure('没有可用的关节坐标（pxJoints 需要至少一个点）');

  let cutoff = finiteNumber(headCutoff);
  if (cutoff === null && finitePoint(joints.neck)) cutoff = Number(joints.neck.y);
  const atlasWidthValue = Math.max(64, Math.round(finiteNumber(atlasWidth) || 512));

  const { data, info } = await sharp(absoluteSource).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const partitioned = partitionSheet({
    pixels: { data, width: info.width, height: info.height },
    segments: built.segments,
    headCutoffY: cutoff === null ? undefined : cutoff,
    headKey: pickHeadKey(list, built.segments),
    atlasWidth: atlasWidthValue,
    pad: 2
  });
  if (partitioned.blocks.length === 0) throw failure('源图没有可切分的不透明像素');

  const placements = new Map(partitioned.atlas.placements.map(placement => [placement.key, placement]));
  const parts = [];
  for (const block of partitioned.blocks) {
    const placement = placements.get(block.key);
    const originPixel = built.pixels.get(block.key);
    const boneWorld = built.world.get(block.key);
    const centerX = block.x + block.w / 2;
    const centerY = block.y + block.h / 2;
    const dx = originPixel ? (centerX - originPixel.x) / pxPer : 0;
    const dy = originPixel ? (centerY - originPixel.y) / pxPer : 0;
    const worldRot = boneWorld?.rot || 0;
    const rad = worldRot * DEG2RAD;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    parts.push({
      bone: block.key,
      atlas: { sx: placement.sx, sy: placement.sy, sw: block.w, sh: block.h },
      // 抵消骨 rest 旋转：内容中心世界偏移 → 骨骼局部偏移
      local: { x: round2(dx * cos + dy * sin), y: round2(-dx * sin + dy * cos) },
      rot: round2(-worldRot),
      width: round2(block.w / pxPer),
      height: round2(block.h / pxPer)
    });
  }

  const atlasPixels = composeAtlasPixels(partitioned.blocks, partitioned.atlas);
  const atlasPng = await sharp(atlasPixels, {
    raw: { width: partitioned.atlas.width, height: partitioned.atlas.height, channels: 4 }
  }).png({ compressionLevel: 9 }).toBuffer();

  return {
    ok: true,
    source: { width: info.width, height: info.height },
    atlas: { width: partitioned.atlas.width, height: partitioned.atlas.height },
    atlasPngBase64: atlasPng.toString('base64'),
    parts,
    stats: { ...partitioned.stats, designHeight: finiteNumber(designHeight) }
  };
}

export default bindSkeletonParts;
