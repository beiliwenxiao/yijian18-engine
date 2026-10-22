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
import {
  SKELETON_HEAD_SLOT_PLAN,
  SKELETON_DIAGONAL_FALLBACK,
  resolveDirectionKey,
  isMirroredFacing
} from './SkeletonDirection.js';

const MAPPER_CLIPS = new Set([
  'death', 'soul', 'climb_back',
  'walk_down', 'walk_up', 'walk_side',
  'walk_SE', 'walk_SW', 'walk_NE', 'walk_NW',
  'idle_down', 'idle_up', 'idle_side'
]);

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
 * 解析武器来源（主手装备 + 背包库存）。
 * - mainhandKey：主手装备的武器 key（未装备为空）
 * - bagKeys：背包武器 key 列表（背包槽顺序，确定性）
 * - ownedKeys：背挂来源 = 背包武器 + 已装备主手武器（装备时物品移出背包，需补回，
 *   否则非战斗时已装备武器无处可挂）
 */
function resolveWeaponInventory(entity) {
  const mainhand = entity?.getComponent?.('equipment')?.getEquipment?.('mainhand');
  const mainhandKey = weaponKeyOf(mainhand) || '';
  const bagKeys = [...collectInventoryWeaponKeys(entity)];
  const ownedKeys = new Set(bagKeys);
  if (mainhandKey) ownedKeys.add(mainhandKey);
  return { mainhandKey, bagKeys, ownedKeys };
}

/**
 * 武器槽位联动写入实体本地覆盖层（不触碰共享资产）。
 * 共享 asset 的 attachment 全局唯一：直接改写会让同骨架的多个实体互相覆盖
 * （有斧头的 NPC 写的 visible=true 被没斧头的 NPC 写回 false）。
 * @param {Entity} entity
 * @param {Object} skeletonComponent - 覆盖层宿主
 * @param {Object} asset - parseSkeletonAsset 产物（只读）
 * @param {string} heldKey - 当前应手持的武器 key（空=不持握）
 * @param {Set<string>} ownedKeys - 背挂来源武器 key 集合
 */
function updateWeaponSlots(entity, skeletonComponent, asset, heldKey, ownedKeys) {
  for (const slot of asset.slots) {
    const parsed = parseWeaponSlot(slot);
    if (!parsed) continue;
    if (!slot.attachment) continue;
    const visible = parsed.pos === 'hand'
      ? parsed.key === heldKey
      : parsed.key !== heldKey && ownedKeys.has(parsed.key);
    skeletonComponent.setSlotOverride?.(slot.id, { visible });
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
  let lastWeaponState = ''; // 武器槽位联动守卫：heldKey|ownedKeys 签名变化才写覆盖层
  let autoDrawnKey = '';     // 战斗中自动上手的武器（进战斗瞬间主手空 → 背包里挑一把拔出）
  let wasInCombat = false;   // 上一帧是否处于战斗态（用于判定「进战斗瞬间」）

  return (skeletonComponent) => {
    const asset = skeletonComponent.skeletonAsset;
    if (!asset) return;
    const sprite = entity.getComponent?.('sprite');
    if (!sprite) return;

    // 武器槽位联动：必须先于离散剪辑保持（mapperHold）执行——
    // 采集（logging/gather）/攻击（attack）等离散动作播放期间，斧头也要正确上手/回背
    const { mainhandKey, bagKeys, ownedKeys } = resolveWeaponInventory(entity);
    // 战斗中背包有武器未装备 → 自动上手（拔出）。
    // 只在「进战斗瞬间」评估一次并锁定到本次战斗结束：
    //   - 进战斗时主手为空 → 从背包取第一把武器上手；
    //   - 进战斗时主手已有武器 → 不产生自动上手候选（玩家中途卸下就是空手，不自动捡回）；
    //   - 中途背包变化不换手上武器，避免武器跳变。
    const inCombat = entity._weaponDrawn === true;
    if (inCombat && !wasInCombat && !mainhandKey && bagKeys.length > 0) {
      autoDrawnKey = bagKeys[0];
    }
    if (!inCombat) autoDrawnKey = '';
    wasInCombat = inCombat;
    const combatHeldKey = mainhandKey || autoDrawnKey;
    // 持握优先级：采集工具 > 战斗中拔出（主手装备 > 进战斗时自动上手）> 空（非战斗收刀回背）
    const heldKey = entity._handToolOverride
      || (inCombat ? combatHeldKey : '')
      || '';
    const weaponState = `${heldKey}|${[...ownedKeys].sort().join(',')}`;
    if (weaponState !== lastWeaponState) {
      lastWeaponState = weaponState;
      updateWeaponSlots(entity, skeletonComponent, asset, heldKey, ownedKeys);
    }

    // 头部槽位切换 + 侧向镜像 + 背挂换边（方向键变化时才写覆盖层，避免每帧触碰）。
    // 提取为闭包函数：跳跃 hold 保持期间也调用——空中改变方向时头部/背挂跟随变化
    const applyFacing = () => {
      const facing = sprite?.direction || 'down';
      const key = resolveDirectionKey(facing);
      // 左系朝向（left / 斜左下 SW / 斜左上 NW）由整体 flipX 镜像
      const wantFlip = isMirroredFacing(facing);
      if (sprite.flipX !== wantFlip) sprite.flipX = wantFlip;
      // side 键下 left/right 共用剪辑与侧脸头，头的翻转依赖 facing → 守卫需区分两者
      const facingKey = key === 'side' ? `${key}|${facing}` : key;
      if (facingKey !== lastFacingKey) {
        lastFacingKey = facingKey;
        const plan = SKELETON_HEAD_SLOT_PLAN[key];
        if (plan) {
          for (const slot of asset.slots) {
            // 背挂槽泛化判定：挂 back 骨骼即背挂（axeBack/spearBack 及未来盾牌/箭袋等），
            // 背面视角自动水平换边，策划新增背挂槽零代码；头部三态挂 head 骨骼不受影响
            const isBackMount = slot.bone === WEAPON_BACK_BONE;
            if (!(slot.id in plan) && !isBackMount) continue;
            if (!slot.attachment) continue;
            // 侧脸基准图朝左（鼻梁在左缘）：附件恒翻为「朝右基准」，
            // 最终朝向由实体 flipX 决定（右行 flip=false→朝右；左行 flip=true→镜像回朝左）
            if (slot.id === 'headSide' || slot.id === 'hairSide') {
              skeletonComponent.setSlotOverride?.(slot.id, { flipX: true });
            }
            // 背面类形态（背面 + 斜后）时背挂武器水平翻转（斧头/长矛换边：正面朝右上 → 背面朝左上）
            if (isBackMount) {
              const wantBackFlip = key === 'up' || key === 'NE' || key === 'NW';
              skeletonComponent.setSlotOverride?.(slot.id, { flipX: wantBackFlip });
              continue;
            }
            skeletonComponent.setSlotOverride?.(slot.id, { visible: plan[slot.id] });
          }
        }
      }
    };

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
        // 非循环离散剪辑播完：仍在跳跃中则保持末帧（人还在空中，不切回待机）；
        // 落地（JumpSystem 清 _jumping）后回归连续状态映射。
        // 保持期间仍执行朝向处理——空中改变方向时头部三态/背挂换边跟随
        if (mapperHold === 'jump' && entity._jumping === true) {
          applyFacing();
          return;
        }
        mapperHold = '';
      } else {
        applyFacing();
        return;
      }
    }

    // 连续状态 → 剪辑名（优先级从上到下）；斜向回退：对角 idle 复用正/背待机，剪辑缺失回退基本向
    let targetClip;
    const moveKey = resolveDirectionKey(sprite?.direction || 'down');
    if (entity.isDead || entity.isDying) targetClip = 'death';
    else if (entity.isSoulState === true) targetClip = 'soul';
    else if (entity._climbing === true) targetClip = 'climb_back';
    // isStopping（松开方向）立即回待机：骨骼模式下 SpriteComponent 帧归零逻辑不跑
    else if (sprite.isWalking === true && sprite.isStopping !== true) {
      targetClip = `walk_${moveKey}`;
    } else {
      targetClip = `idle_${moveKey}`;
    }
    if (!asset.clips.has(targetClip)) {
      targetClip = `${targetClip.startsWith('walk_') ? 'walk_' : 'idle_'}${SKELETON_DIAGONAL_FALLBACK[moveKey] || moveKey}`;
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

    applyFacing();
  };
}
