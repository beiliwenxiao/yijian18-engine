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
 * SkeletonEditorGeometry.js - 骨骼编辑器画布几何纯函数
 *
 * 从 SkeletonEditor.js 抽出的可单测内核（无 DOM 依赖）：
 *   - 挂图跟随模式（follow）换算：挂图是否跟随所在骨骼的缩放
 *   - 骨骼长度末端世界坐标：length 只影响骨条视觉长度，不进变换矩阵
 *   - 挂点锚点世界坐标：与运行时 SkeletonRenderer 同一口径
 */

/**
 * 挂图跟随模式的缩放系数（与运行时 SkeletonRenderer 同一口径）：
 *   follow='bone'    —— 挂图完全跟随骨骼变换（含缩放，用于 squash & stretch 压扁拉伸）
 *   follow='noScale' —— 挂图只跟随骨骼位置与旋转，不跟随缩放（缺省；拖骨骼缩放不让图片变形）
 * @param {string} [follow] - 槽位跟随模式
 * @param {Object} [boneWorld] - 骨骼世界变换 { x, y, rot, sx, sy }
 * @returns {{sx:number, sy:number}}
 */
export function followScale(follow, boneWorld) {
  if (follow === 'bone') return { sx: boneWorld?.sx || 1, sy: boneWorld?.sy || 1 };
  return { sx: 1, sy: 1 };
}

/**
 * 骨骼长度末端世界坐标（Spine 式）：沿骨骼自身方向（世界 rot）的 length 末端。
 * length 只影响骨条视觉长度，不进入任何变换矩阵——拖它不会让挂图变形。
 * @param {Object} bone - 骨骼定义（用 length）
 * @param {Object} boneWorld - 骨骼世界变换 { x, y, rad, sx, sy }
 * @returns {{x:number, y:number}}
 */
export function boneLengthTipWorld(bone, boneWorld) {
  const length = Math.max(2, bone?.length || 0);
  return {
    x: boneWorld.x + Math.cos(boneWorld.rad) * length * (boneWorld.sx || 1),
    y: boneWorld.y + Math.sin(boneWorld.rad) * length * (boneWorld.sy || 1)
  };
}

/**
 * 按显式挂点偏移求世界锚点（挂点 = 骨骼原点 + 偏移，经骨骼旋转）。
 * @param {Object} boneWorld - 骨骼世界变换 { x, y, rad }
 * @param {Object} offset - 挂点偏移 { x, y }
 * @param {string} [follow] - 槽位跟随模式（noScale 时偏移不被骨骼缩放放大）
 * @returns {{x:number, y:number}}
 */
export function anchorWorldForOffset(boneWorld, offset, follow) {
  const scale = followScale(follow, boneWorld);
  const cos = Math.cos(boneWorld.rad);
  const sin = Math.sin(boneWorld.rad);
  const lx = (offset.x || 0) * scale.sx;
  const ly = (offset.y || 0) * scale.sy;
  return { x: boneWorld.x + lx * cos - ly * sin, y: boneWorld.y + lx * sin + ly * cos };
}
