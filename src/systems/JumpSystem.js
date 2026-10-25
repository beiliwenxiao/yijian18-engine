/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * @project YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 ************************************************************/

import { RNG } from '../core/RNG.js';
import { resolveEntityJumpClipName } from '../animation/SkeletonJumpClip.js';

// 表现层随机：起跳/落地烟雾粒子（非玩法结算，非权威）
const fxRng = new RNG();

const DEFAULT_CONFIG = Object.freeze({
  // 未显式指定距离时的默认落点距离；蓄力跳跃会显式传入 30~120 的距离。
  distance: 84, duration: 0.62, peakHeight: 46, deadzone: 0.2,
  // 距离→高度/时长的参考上限（px）
  distanceReference: 120,
  // 起跳/落地烟雾（类似轻功）：由场景注入 particleSystem 后生效
  smokeParticleCount: 10, smokeRadius: 14, smokeLife: 520,
  smokeSize: { min: 5, max: 9 }, smokeColor: '#d8d8d8', smokeAlpha: 0.5,
  smokeFriction: 0.96, takeoffGravity: -60, landingGravity: 30
});

/**
 * 通用跳跃系统：elevation 负责视觉高度，地面位移按增量推进，
 * 因而仍可由现有碰撞系统逐帧修正，不会穿透静态障碍。
 * 落点由起跳瞬间的方向与距离决定；距离越长，起跳越高、滞空越久。
 */
export class JumpSystem {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.particleSystem = config.particleSystem || null;
    this._active = new Map();
    /** 落地追踪：entity -> { startX, startY, dirX, dirY }（落地帧供地形碰撞回退用） */
    this._lastLanding = new Map();
  }

  setParticleSystem(particleSystem) {
    this.particleSystem = particleSystem;
  }

  /** 起跳瞬间烟尘（轻功式下压尘土），需要粒子系统。 */
  _emitTakeoffSmoke(x, y) {
    if (!this.particleSystem) return;
    const c = this.config;
    for (let i = 0; i < c.smokeParticleCount; i++) {
      const angle = Math.PI * (i / c.smokeParticleCount);
      const offsetX = Math.cos(angle) * c.smokeRadius;
      const offsetY = Math.sin(angle) * c.smokeRadius;
      this.particleSystem.emit({
        position: { x: x + offsetX, y: y + offsetY },
        velocity: { x: Math.cos(angle) * 50, y: Math.sin(angle) * 25 - 30 },
        life: c.smokeLife,
        size: c.smokeSize.min + fxRng.next() * (c.smokeSize.max - c.smokeSize.min),
        color: c.smokeColor, alpha: c.smokeAlpha, friction: c.smokeFriction, gravity: c.takeoffGravity
      });
    }
  }

  /** 落地瞬间烟尘。 */
  _emitLandingSmoke(x, y) {
    if (!this.particleSystem) return;
    const c = this.config;
    for (let i = 0; i < c.smokeParticleCount; i++) {
      const angle = Math.PI * (i / c.smokeParticleCount);
      const offsetX = Math.cos(angle) * c.smokeRadius;
      const offsetY = Math.sin(angle) * c.smokeRadius;
      this.particleSystem.emit({
        position: { x: x + offsetX, y: y + offsetY },
        velocity: { x: Math.cos(angle) * 50, y: Math.sin(angle) * 25 + 10 },
        life: c.smokeLife,
        size: c.smokeSize.min + fxRng.next() * (c.smokeSize.max - c.smokeSize.min),
        color: c.smokeColor, alpha: c.smokeAlpha, friction: c.smokeFriction, gravity: c.landingGravity
      });
    }
  }

  /** 距离 → 跳跃峰值高度推导（距离越长跳越高）。 */
  _peakForDistance(distance) {
    const ratio = Math.min(1, distance / Math.max(1, this.config.distanceReference || 120));
    return Math.max(14, this.config.peakHeight * (0.4 + 0.7 * ratio));
  }

  startJump(entity, direction = { x: 0, y: 0 }, options = {}) {
    const transform = entity?.getComponent?.('transform');
    if (!transform || this._active.has(entity)) return false;
    const magnitude = Math.hypot(direction.x || 0, direction.y || 0);
    const moving = magnitude >= this.config.deadzone;
    const movement = entity.getComponent?.('movement');
    movement?.stop?.();
    // 起跳烟雾：落在玩家脚下（含短暂蓄力时在离地前就冒起）
    if (transform) {
      this._emitTakeoffSmoke(transform.position.x, transform.position.y);
    }
    const distance = moving ? Math.max(0, Number(options.distance) || this.config.distance) : 0;
    // 距离越长 → 起跳越高、滞空越久；未显式指定时按距离推导。
    const duration = Number(options.duration) > 0
      ? Number(options.duration)
      : Math.max(0.28, this.config.duration * (0.45 + 0.75 * (distance / Math.max(1, this.config.distanceReference || 120))));
    const peakHeight = Number(options.peakHeight) > 0
      ? Number(options.peakHeight)
      : this._peakForDistance(distance);
    // startProgress：从跳跃进度的某一时刻开始播放（0.5 = 只播后半段下落，用于"跳下"跌落表现）。
    // 水平位移已按 easeOut 在该进度处的累计值折算，落点仍为 direction * distance。
    const startProgress = Math.min(0.99, Math.max(0, Number(options.startProgress) || 0));
    this._active.set(entity, {
      transform,
      mode: options.mode === 'power' ? 'power' : 'normal',
      jumping: true,
      elapsed: duration * startProgress,
      chargeDuration: Math.max(0, Number(options.chargeDuration) || 0),
      // 二段跳/跳下：从空中高度续跳（起始高度高于落点地面时按线性落差回落）。
      baseElevation: Number.isFinite(Number(options.baseElevation))
        ? Number(options.baseElevation)
        : (transform.position.elevation || 0),
      startElevationOffset: Math.max(0, Number(options.startElevationOffset) || 0),
      startPos: { x: transform.position.x, y: transform.position.y },
      relocate: options.relocate === true,
      horizontalProgress: 1 - (1 - startProgress) * (1 - startProgress),
      direction: moving
        ? { x: direction.x / magnitude, y: direction.y / magnitude }
        : { x: 0, y: 0 },
      distance,
      duration,
      peakHeight
    });
    // 离散动作接线：骨骼实体播跳跃剪辑（非循环，播完由状态映射器自动回归行走/待机；
    // 普通帧动画实体无 jump 动画，不播避免警告刷屏）
    // 部件模式按当前朝向选形态剪辑（jump_down/jump_side/jump_up）——
    // 单一 jump 剪辑无法同时表达正/侧/背三种身体姿态（侧视膝盖会反关节）。
    const sprite = entity?.getComponent?.('sprite');
    if (sprite?.isSkeleton) {
      const clipName = resolveEntityJumpClipName(entity);
      if (clipName) sprite.playAnimation(clipName);
    }
    entity._jumping = true;   // 跳跃中标志：mapper 播完 jump 后保持末帧直到落地
    return true;
  }

  isJumping(entity) {
    return this._active.has(entity);
  }

  /**
   * 实体刚结束一次跳跃时，返回该次跳跃的起跳点与落点方向（供地形碰撞解算用）。
   * - 仅在落地后的那一帧有效（落地帧结束即清除）；
   * - 用途：跳跃落点若落在阻挡形状（如河道）内，应沿跳跃方向回退到「最后可落脚点」，
   *   而不是回退到跳跃前的旧位置（那会把玩家传送回出发点）。
   * @param {Object} entity - 实体
   * @returns {{startX:number,startY:number,dirX:number,dirY:number}|null}
   */
  getLastLanding(entity) {
    const info = this._lastLanding?.get(entity);
    return info ? { ...info } : null;
  }

  /** 清除实体的落地追踪信息（落地帧用毕即弃）。 */
  clearLastLanding(entity) {
    this._lastLanding?.delete(entity);
  }

  /** 注册落地回调：entity 落地时调用（含二段跳；from/to 为起跳/落地地面坐标）。 */
  setLandCallback(fn) {
    this.onLand = typeof fn === 'function' ? fn : null;
  }

  /**
   * 大跳升级（v3 设计）：落点总位移拉满到 totalDistance（已走部分不回退），
   * 并可扩展滞空时长（options.duration，大跳=1s——progress 推进变缓，弧线更舒展）。
   * 已过时间不回退，只改剩余水平距离与总时长。
   */
  extendJumpTo(entity, totalDistance, options = {}) {
    const data = this._active.get(entity);
    if (!data || !Number.isFinite(totalDistance) || totalDistance < 0) return false;
    const remaining = Math.max(0.05, 1 - data.horizontalProgress);
    const done = data.horizontalProgress * data.distance;
    data.distance = Math.max(0, (totalDistance - done) / remaining);
    // duration 扩展时 elapsed 同比例重映射，保持 progress 连续——
    // 否则 progress 瞬间倒退（如 0.7→0.35），step 变负导致角色回跳抖动
    if (Number(options.duration) > data.duration) {
      const progress = Math.min(1, data.elapsed / data.duration);
      data.duration = Number(options.duration);
      data.elapsed = data.duration * progress;
    }
    // 峰值高度提升：随剩余 progress 线性渐变过渡（peakFrom→peakTo），
    // 避免 peak 突变造成高度瞬跳
    if (Number(options.peakHeight) > 0 && Number(options.peakHeight) !== data.peakHeight) {
      data.peakFrom = data.peakHeight;
      data.peakTo = Number(options.peakHeight);
      data.peakBlendFrom = data.horizontalProgress;
    }
    return true;
  }

  /**
   * 空中启动位移（v3.1 设计）：原地小跳后，滞空中首次输入方向时向该方向「跳出」——
   * 方向立即对齐（blend=1，起跳后无历史惯性）+ 剩余段拉出 distance 总量。
   * 非跳跃中调用无效（launch 只作用于已在空中的原地跳）。
   */
  launchJump(entity, direction, distance = this.config.distance) {
    const data = this._active.get(entity);
    if (!data) return false;
    const mag = Math.hypot(direction?.x || 0, direction?.y || 0);
    if (mag < 0.01) return false;
    const aligned = this.steerJump(entity, { direction, blend: 1 });
    // 跳出后高度同步提升到该距离对应峰值（渐变过渡，避免瞬跳）
    const extended = this.extendJumpTo(entity, Math.max(0, Number(distance) || 0), {
      peakHeight: this._peakForDistance(Math.max(0, Number(distance) || 0))
    });
    return aligned || extended;
  }

  /**
   * 空中轻推转向（v2.2 设计 §6）：把当前跳跃方向向输入方向做矢量混合——
   * blend ∈ (0,1]：0=不变，1=完全对齐输入方向（行走式响应）。
   * - **距离守恒**：剩余水平总量不变，落点随方向缓慢旋转；
   * - **惯性**：blend<1 时原方向保留主导权（一阶响应，转向需要时间），
   *   与行走的区别仅在此——行走 blend=1 即时改向，空中由调用方传衰减 blend；
   * - **反向死区**：输入与当前方向正相反且 blend=0.5 时矢量抵消，保持原方向。
   * 原地跳（direction={0,0}）时轻推可把剩余段拉向输入方向。
   */
  steerJump(entity, { direction = null, blend = 0 } = {}) {
    const data = this._active.get(entity);
    if (!data || !direction) return false;
    const magnitude = Math.hypot(direction.x || 0, direction.y || 0);
    if (magnitude < 0.01) return false;
    const k = Math.min(1, Math.max(0, Number(blend) || 0));
    if (!(k > 0)) return false;
    const inputX = direction.x / magnitude;
    const inputY = direction.y / magnitude;
    const dx = data.direction.x * (1 - k) + inputX * k;
    const dy = data.direction.y * (1 - k) + inputY * k;
    const length = Math.hypot(dx, dy);
    if (length < 0.01) return false;   // 反向抵消：保持惯性方向
    data.direction = { x: dx / length, y: dy / length };
    return true;
  }

  /**
   * 跳中重跳（二段跳原语，v2 设计 §6）：删旧条目，从当前空中位置以新参数再起
   * 一段（baseElevation 继承 + startElevationOffset=当前高差，弧线从当前高度续起）。
   * 非跳跃中调用退化为普通 startJump。
   */
  relocateJump(entity, direction = { x: 0, y: 0 }, options = {}) {
    const data = this._active.get(entity);
    if (!data) return this.startJump(entity, direction, options);
    const transform = entity?.getComponent?.('transform');
    if (!transform) return false;
    const startElevationOffset = Math.max(0, (transform.position.elevation || 0) - data.baseElevation);
    this._active.delete(entity);
    return this.startJump(entity, direction, {
      ...options,
      baseElevation: data.baseElevation,
      startElevationOffset,
      relocate: true
    });
  }

  update(deltaTime) {
    for (const [entity, data] of this._active) {
      const transform = entity?.getComponent?.('transform');
      if (!transform) {
        this._active.delete(entity);
        continue;
      }
      data.elapsed += Math.max(0, deltaTime || 0);
      if (data.elapsed < data.chargeDuration) {
        transform.position.elevation = data.baseElevation;
        continue;
      }
      const airborneElapsed = data.elapsed - data.chargeDuration;
      const progress = Math.min(1, airborneElapsed / data.duration);
      // easeOutQuad：起跳立即开始前移，不保留起步预备缓动；落地自然减速。
      const horizontal = 1 - (1 - progress) * (1 - progress);
      const step = (horizontal - data.horizontalProgress) * data.distance;
      // 落点由起跳瞬间的方向与距离锁定，滞空期间不再调整位置。
      transform.position.x += data.direction.x * step;
      transform.position.y += data.direction.y * step;
      // 峰值高度渐变（大跳/跳出提升峰值时）：随 progress 从 peakFrom 线性过渡到 peakTo，
      // 避免 peak 突变造成高度瞬跳
      let peak = data.peakHeight;
      if (data.peakTo != null) {
        const blendSpan = Math.max(0.01, 1 - data.peakBlendFrom);
        const t = Math.min(1, Math.max(0, (progress - data.peakBlendFrom) / blendSpan));
        peak = data.peakFrom + (data.peakTo - data.peakFrom) * t;
        if (t >= 1) {
          data.peakHeight = data.peakTo;
          data.peakTo = null;
          peak = data.peakTo;
        }
      }
      transform.position.elevation = data.baseElevation
        + data.startElevationOffset * (1 - progress)
        + peak * 4 * progress * (1 - progress);
      data.horizontalProgress = horizontal;
      if (progress >= 1) {
        transform.position.elevation = data.baseElevation;
        entity._jumping = false;   // 落地：清除跳跃标志（mapper 恢复行走/待机）
        this._emitLandingSmoke(transform.position.x, transform.position.y);
        this._active.delete(entity);
        // 落地追踪：起跳点 + 跳跃方向（供落地帧地形碰撞把非法落点回退到最后可落脚点）
        this._lastLanding.set(entity, {
          startX: data.startPos?.x ?? transform.position.x,
          startY: data.startPos?.y ?? transform.position.y,
          dirX: data.direction.x,
          dirY: data.direction.y
        });
        this.onLand?.(entity, {
          from: data.startPos || null,
          to: { x: transform.position.x, y: transform.position.y },
          relocate: data.relocate === true
        });
      }
    }
  }

  cleanup() {
    for (const [entity, data] of this._active) {
      data.transform.position.elevation = data.baseElevation;
      entity._jumping = false;
    }
    this._active.clear();
  }
}

export default JumpSystem;
