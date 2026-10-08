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
 * PlayerSkeletonStateMapper - 玩家骨骼状态映射器（完整全身骨骼方案）
 *
 * 每帧把实体连续状态映射为骨骼剪辑：
 *   死亡 > 灵魂 > 攀爬(背向) > 行走(按方向) > 待机(按方向)
 * 离散动作剪辑（attack/gather/logging/mining/fishing/sleep/stretcher/jump）
 * 由各系统经 sprite.playAnimation → playClip 触发，映射器不抢占；
 * 非循环离散剪辑播完后自动回到连续状态剪辑。
 *
 * 方向表达（全身骨骼无帧表）：
 *   - 头部三态：headFront/headSide/headBack 槽位按朝向切 visible（正/侧/背）
 *   - 侧向左右：sprite.flipX 整体镜像（side 姿态 + flip=左）
 */

import { weaponKeyOf } from './SkeletonPartResolver.js';

const MAPPER_CLIPS = new Set([
  'death', 'soul', 'climb_back',
  'walk_down', 'walk_up', 'walk_side',
  'idle_down', 'idle_up', 'idle_side'
]);

/** 头部三态槽位可见性（key: 方向键 down/side/up） */
const HEAD_SLOTS = {
  down: { headFront: true, headSide: false, headBack: false },
  side: { headFront: false, headSide: true, headBack: false },
  up: { headFront: false, headSide: false, headBack: true }
};

/** 手持位挂点骨骼（右前臂） */
const WEAPON_HAND_BONE = 'armFR';
/** 背挂位挂点骨骼（背部） */
const WEAPON_BACK_BONE = 'back';

/**
 * 解析武器槽位的 weaponKey 与位置。
 * 约定：assetId 或槽位 id 含 weapon-{key}；位置由槽位 id 的 -back 后缀或挂 back 骨骼判定。
 * @returns {{key:string, pos:'hand'|'back'}|null} 非武器槽位返回 null
 */
function parseWeaponSlot(slot) {
  const assetId = slot?.attachment?.assetId || '';
  const slotId = slot?.id || '';
  const match = assetId.match(/weapon-([a-z0-9_]+)/i) || slotId.match(/weapon-([a-z0-9_]+?)(-back)?$/i);
  if (!match) return null;
  const key = match[1];
  const isBack = /-back$/i.test(slotId) || slot?.bone === WEAPON_BACK_BONE;
  return { key, pos: isBack ? 'back' : 'hand' };
}

/** 收集背包中所有武器的 weaponKey 集合（weaponKey 取自已装备的武器定义）。 */
function collectInventoryWeaponKeys(entity) {
  const keys = new Set();
  const inventory = entity?.getComponent?.('inventory');
  for (const stack of inventory?.slots || []) {
    const key = weaponKeyOf(stack?.item);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * 武器槽位联动：手持位显示当前装备的武器，背挂位显示「背包里有但手上没拿」的武器。
 * 装备 weaponKey=W → weapon-W 显示、weapon-W-back 隐藏（拔刀）；
 * 卸下 W → weapon-W 隐藏、weapon-W-back 显示（收刀回背）。
 */
function updateWeaponSlots(entity, asset) {
  const mainhand = entity?.getComponent?.('equipment')?.getEquipment?.('mainhand');
  const equippedKey = weaponKeyOf(mainhand);
  const ownedKeys = collectInventoryWeaponKeys(entity);
  for (const slot of asset.slots) {
    const parsed = parseWeaponSlot(slot);
    if (!parsed) continue;
    const attachment = slot.attachment;
    if (!attachment) continue;
    const visible = parsed.pos === 'hand'
      ? parsed.key === equippedKey
      : parsed.key !== equippedKey && ownedKeys.has(parsed.key);
    if (attachment.visible !== visible) attachment.visible = visible;
  }
}

/**
 * @param {Entity} entity
 * @param {Object} deps - { getAssetManager }
 * @returns {(skeletonComponent: Object, deltaTime: number) => void} stateHook
 */
export function createPlayerSkeletonStateMapper(entity, { getAssetManager = null } = {}) {
  let lastClip = '';
  let mapperHold = '';
  let lastFacingKey = '';
  let lastWeaponState = ''; // 武器槽位联动守卫：equippedKey|ownedKeys 签名变化才写共享资产

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
    // isStopping（松开方向）立即回待机：骨骼模式下 SpriteComponent 帧归零逻辑不跑
    else if (sprite.isWalking === true && sprite.isStopping !== true) {
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

    // 头部三态 + 侧向镜像（方向键变化时才写共享资产，避免每帧触碰）
    const facing = sprite?.direction || 'down';
    const key = directionKey(sprite);
    // 侧向左右共用 side 姿态与侧面头：left 由整体 flipX 镜像
    const wantFlip = facing === 'left';
    if (sprite.flipX !== wantFlip) sprite.flipX = wantFlip;
    if (key !== lastFacingKey) {
      lastFacingKey = key;
      const plan = HEAD_SLOTS[key];
      if (plan) {
        for (const slot of asset.slots) {
          if (!(slot.id in plan) && slot.id !== 'spearBack') continue;
          const attachment = slot.attachment;
          if (!attachment) continue;
          // 背面时长矛水平翻转（枪头换边：正面朝右上 → 背面朝左上）
          if (slot.id === 'spearBack') {
            const wantFlip = key === 'up';
            if (attachment.flipX !== wantFlip) attachment.flipX = wantFlip;
            continue;
          }
          if (attachment.visible !== plan[slot.id]) attachment.visible = plan[slot.id];
        }
      }
    }

    // 武器槽位联动：手持位 = 当前主手装备；背挂位 = 背包里有但没装备
    const mainhand = entity.getComponent?.('equipment')?.getEquipment?.('mainhand');
    const equippedKey = weaponKeyOf(mainhand) || '';
    const ownedKeys = [...collectInventoryWeaponKeys(entity)].sort().join(',');
    const weaponState = `${equippedKey}|${ownedKeys}`;
    if (weaponState !== lastWeaponState) {
      lastWeaponState = weaponState;
      updateWeaponSlots(entity, asset);
    }
  };
}

function directionKey(sprite) {
  const direction = sprite?.direction || 'down';
  if (direction === 'up') return 'up';
  if (direction === 'left' || direction === 'right') return 'side';
  return 'down';
}
