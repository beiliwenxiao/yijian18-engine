/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * @project YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 ************************************************************/

import { RNG } from '../core/RNG.js';

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
    const ratio = Math.min(1, distance / Math.max(1, this.config.distanceReference || 120));
    const duration = Number(options.duration) > 0
      ? Number(options.duration)
      : Math.max(0.28, this.config.duration * (0.45 + 0.75 * ratio));
    const peakHeight = Number(options.peakHeight) > 0
      ? Number(options.peakHeight)
      : Math.max(14, this.config.peakHeight * (0.4 + 0.7 * ratio));
    // startProgress：从跳跃进度的某一时刻开始播放（0.5 = 只播后半段下落，用于"跳下"跌落表现）。
    // 水平位移已按 easeOut 在该进度处的累计值折算，落点仍为 direction * distance。
    const startProgress = Math.min(0.99, Math.max(0, Number(options.startProgress) || 0));
    this._active.set(entity, {
      transform,
      mode: options.mode === 'power' ? 'power' : 'normal',
      elapsed: duration * startProgress,
      chargeDuration: Math.max(0, Number(options.chargeDuration) || 0),
      // AIR_AIM 重定位跳：从悬停高度续跳（起始高度高于落点地面时按线性落差回落）。
      baseElevation: Number.isFinite(Number(options.baseElevation))
        ? Number(options.baseElevation)
        : (transform.position.elevation || 0),
      startElevationOffset: Math.max(0, Number(options.startElevationOffset) || 0),
      startPos: { x: transform.position.x, y: transform.position.y },
      relocate: options.relocate === true,
      hover: false,
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
    const sprite = entity?.getComponent?.('sprite');
    if (sprite?.isSkeleton) sprite.playAnimation('jump');
    return true;
  }

  isJumping(entity) {
    return this._active.has(entity);
  }

  /** 注册落地回调：entity 落地时调用（含 AIR_AIM 重定位跳；from/to 为起跳/落地地面坐标）。 */
  setLandCallback(fn) {
    this.onLand = typeof fn === 'function' ? fn : null;
  }

  /** 悬停（AIR_AIM）：冻结当前跳跃进度，速度=0、重力挂起；resumeFromHover 恢复剩余弧线。 */
  hoverJump(entity) {
    const data = this._active.get(entity);
    if (!data || data.hover) return false;
    data.hover = true;
    return true;
  }

  isHovering(entity) {
    const data = this._active.get(entity);
    return !!data && data.hover === true;
  }

  /** 解除悬停：从冻结进度继续播放原跳跃剩余段（超时/打断恢复）。 */
  resumeFromHover(entity) {
    const data = this._active.get(entity);
    if (!data || !data.hover) return false;
    data.hover = false;
    return true;
  }

  /** AIR_AIM 重定位：解除悬停条目，从悬停点重新起跳到新落点（不重置 elevation，避免瞬移）。 */
  relocateJump(entity, direction = { x: 0, y: 0 }, options = {}) {
    const data = this._active.get(entity);
    if (!data || !data.hover) return this.startJump(entity, direction, options);
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
      // 悬停（AIR_AIM）：推进全部冻结，位置与高度保持不变。
      if (data.hover) continue;
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
      transform.position.elevation = data.baseElevation
        + data.startElevationOffset * (1 - progress)
        + data.peakHeight * 4 * progress * (1 - progress);
      data.horizontalProgress = horizontal;
      if (progress >= 1) {
        transform.position.elevation = data.baseElevation;
        this._emitLandingSmoke(transform.position.x, transform.position.y);
        this._active.delete(entity);
        this.onLand?.(entity, {
          from: data.startPos || null,
          to: { x: transform.position.x, y: transform.position.y },
          relocate: data.relocate === true
        });
      }
    }
  }

  cleanup() {
    for (const data of this._active.values()) {
      data.transform.position.elevation = data.baseElevation;
    }
    this._active.clear();
  }
}

export default JumpSystem;
