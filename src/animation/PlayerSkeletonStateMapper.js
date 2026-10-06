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
 * PlayerSkeletonStateMapper - 玩家/角色骨骼状态映射器（混合模式第一期）
 *
 * 每帧把实体连续状态映射为骨骼剪辑 + 身体槽位帧表：
 *   死亡 > 灵魂 > 攀爬(背向) > 行走(按方向) > 待机(按方向)
 * 离散动作剪辑（attack/gather/logging/mining/fishing/sleep/stretcher/jump）
 * 由各系统经 sprite.playAnimation → playClip 触发，映射器不抢占；
 * 非循环离散剪辑播完后自动回到连续状态剪辑。
 *
 * 身体槽位帧表：按实体 sprite 的 cols×rows + directionRowMap 计算方向行
 * 帧矩形（适应任意角色 sheet 布局）；无 manifest 图片时保持 JSON 定义。
 */

const MAPPER_CLIPS = new Set([
  'death', 'soul', 'climb_back',
  'walk_down', 'walk_up', 'walk_side',
  'idle_down', 'idle_up', 'idle_side'
]);

/** framesKey 按组件实例缓存（模块级函数无法持有闭包变量）。 */
const BODY_FRAMES_KEY_CACHE = new WeakMap();

/**
 * @param {Entity} entity
 * @param {Object} deps - { getAssetManager }
 * @returns {(skeletonComponent: Object, deltaTime: number) => void} stateHook
 */
export function createPlayerSkeletonStateMapper(entity, { getAssetManager = null } = {}) {
  let lastClip = '';
  let mapperHold = '';

  return (skeletonComponent) => {
    const asset = skeletonComponent.skeletonAsset;
    if (!asset) return;
    const sprite = entity.getComponent?.('sprite');
    if (!sprite) return;

    // 外部 playClip（系统触发的离散动作：attack/gather/sleep/stretcher…）：
    //   循环剪辑保持到下一次外部切换；非循环剪辑播完自动回归连续状态映射
    const current = skeletonComponent.currentClip;
    if (current !== lastClip) {
      lastClip = current;
      mapperHold = MAPPER_CLIPS.has(current) ? '' : current;
    }
    if (mapperHold) {
      const holdClip = asset.clips.get(mapperHold);
      if (!holdClip || (!holdClip.loop && skeletonComponent.clipTime >= holdClip.durationMs)) {
        mapperHold = '';
      } else {
        return;
      }
    }

    // 连续状态 → 剪辑名（优先级从上到下）
    let targetClip;
    if (entity.isDead || entity.isDying) targetClip = 'death';
    else if (entity.isSoulState === true) targetClip = 'soul';
    else if (entity._climbing === true) targetClip = 'climb_back';
    else if (sprite.isWalking === true || (Number(sprite.walkFrame) > 0 && sprite.isStopping !== true)) {
      targetClip = `walk_${directionKey(sprite)}`;
    } else {
      targetClip = `idle_${directionKey(sprite)}`;
    }

    if (!asset.clips.has(targetClip)) {
      targetClip = asset.defaultClip;
      if (!targetClip) return;
    }

    if (targetClip !== lastClip) {
      skeletonComponent.playClip(targetClip);
      lastClip = targetClip;
      mapperHold = '';
    }

    // 身体槽位帧表：方向行帧矩形（贴图布局来自实体 sprite 配置）
    syncBodyFrames(entity, skeletonComponent, sprite, targetClip);
  };
}

function directionKey(sprite) {
  const direction = sprite?.direction || 'down';
  if (direction === 'up') return 'up';
  if (direction === 'left' || direction === 'right') return 'side';
  return 'down';
}

/** 计算方向行帧矩形并写入 body 槽位（缓存键避免每帧重建数组）。 */
function syncBodyFrames(entity, skeletonComponent, sprite, targetClip) {
  const slot = skeletonComponent.skeletonAsset?.slots?.find(candidate => candidate.id === 'body');
  if (!slot?.attachment || slot.attachment.type !== 'sequence') return;
  // 身体图源：JSON 声明的 assetId 优先；未声明（占位）回退实体自身 spriteSheet 稳定 ID
  const stableId = slot.attachment.assetId || sprite.spriteSheet;
  if (!stableId) return;
  const manager = skeletonComponent.deps?.getAssetManager?.();
  if (!manager) return;
  const key = manager.resolveManifestAsset?.(stableId, '2d')?.key || stableId;
  const image = manager.getImage?.(key) || null;
  if (!image || !(image.naturalWidth > 0)) return;

  const cols = Math.max(1, sprite.spriteColumns || 1);
  const rows = Math.max(1, sprite.spriteRows || 1);
  const cellWidth = image.naturalWidth / cols;
  const cellHeight = image.naturalHeight / rows;
  const walking = targetClip.startsWith('walk');
  const rowMap = sprite.directionRowMap || {};
  const rowIndex = Math.max(0, Math.min(rows - 1, walking
    ? (rowMap[sprite.direction] ?? rowMap.idle ?? 0)
    : (rowMap.idle ?? 0)));
  const frameCount = walking ? Math.max(1, cols) : 1;
  const framesKey = `${stableId}|${cellWidth.toFixed(1)}|${cellHeight.toFixed(1)}|${rowIndex}|${frameCount}`;
  if (BODY_FRAMES_KEY_CACHE.get(skeletonComponent) === framesKey) return;
  BODY_FRAMES_KEY_CACHE.set(skeletonComponent, framesKey);

  const frames = [];
  for (let index = 0; index < frameCount; index += 1) {
    frames.push({
      sx: Math.round(index * cellWidth),
      sy: Math.round(rowIndex * cellHeight),
      sw: Math.round(cellWidth),
      sh: Math.round(cellHeight)
    });
  }
  skeletonComponent.setSlotFrames('body', frames, walking ? 8 : 4);
}
