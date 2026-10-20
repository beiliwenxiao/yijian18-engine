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

import { RNG } from '../core/RNG.js';

// 表现层随机：闪避烟尘粒子（非玩法结算，非权威）
const fxRng = new RNG();

const DEFAULT_CONFIG = Object.freeze({
  // 闪避距离：3 个身位（玩家精灵宽 64px × 3）
  distance: 192,
  // 位移时长（秒）：快速滑步，短促干脆
  duration: 0.25,
  // 冷却时间（毫秒）：与主动格挡一致（CombatSystem._activeBlock.cooldownMs = 8000）
  cooldownMs: 8000,
  // 触发烟尘参数（起/收各一次）
  smokeParticleCount: 8, smokeRadius: 12, smokeLife: 420,
  smokeSize: { min: 4, max: 8 }, smokeColor: '#d8d8d8', smokeAlpha: 0.45,
  smokeFriction: 0.96, smokeGravity: 20,
  // 头顶飘字（触发瞬间）
  labelText: '闪避', labelColor: '#9fdcff', labelOffsetY: -46
});

/**
 * DodgeSystem - 闪避系统
 *
 * 玩家向指定方向快速滑出一段固定距离（地面位移，逐帧增量推进，
 * 与 JumpSystem 同模式——由现有碰撞系统逐帧修正，不穿静态障碍）。
 * 冷却与主动格挡一致；触发时头顶显示「闪避」飘字。
 *
 * 输入映射：PC=F（闪向鼠标方向）· 手柄=B（左摇杆方向/面向）· 触屏=闪避按钮。
 */
export class DodgeSystem {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.particleSystem = config.particleSystem || null;
    this.floatingTextManager = config.floatingTextManager || null;
    this.now = typeof config.now === 'function' ? config.now : () => performance.now();
    /** @type {Map<Entity, object>} 闪避中的实体 → 位移数据 */
    this._active = new Map();
    this._lastDodgeTime = -Infinity;
  }

  setParticleSystem(particleSystem) {
    this.particleSystem = particleSystem;
  }

  setFloatingTextManager(floatingTextManager) {
    this.floatingTextManager = floatingTextManager;
  }

  /**
   * 开始闪避：向方向单位向量滑出 config.distance。
   * @param {Entity} entity
   * @param {{x:number,y:number}} direction - 单位方向（调用方保证非零）
   * @returns {boolean} 是否成功触发（冷却中/已在闪避中返回 false）
   */
  startDodge(entity, direction = { x: 0, y: 0 }) {
    const transform = entity?.getComponent?.('transform');
    if (!transform || this._active.has(entity)) return false;
    const now = this.now();
    if (now - this._lastDodgeTime < this.config.cooldownMs) return false;
    const magnitude = Math.hypot(direction.x || 0, direction.y || 0);
    if (magnitude < 0.01) return false;

    const startX = transform.position.x;
    const startY = transform.position.y;
    const ratio = this.config.distance / magnitude;
    entity.getComponent?.('movement')?.stop?.();

    this._active.set(entity, {
      transform,
      startX, startY,
      targetX: startX + direction.x * ratio,
      targetY: startY + direction.y * ratio,
      progress: 0
    });
    this._lastDodgeTime = now;

    // 起步烟尘 + 头顶「闪避」飘字
    this._emitSmoke(startX, startY);
    if (this.floatingTextManager) {
      this.floatingTextManager.addText(
        startX, startY + this.config.labelOffsetY,
        this.config.labelText, this.config.labelColor
      );
    }
    return true;
  }

  isDodging(entity) {
    return this._active.has(entity);
  }

  /**
   * 帧推进：easeOut 插值位置（快速出发、平滑收步）。
   * @param {number} deltaTime - 秒
   */
  update(deltaTime) {
    if (this._active.size === 0) return;
    for (const [entity, data] of this._active) {
      if (!entity.getComponent?.('transform')) {
        this._active.delete(entity);
        continue;
      }
      data.progress = Math.min(1, data.progress + deltaTime / this.config.duration);
      const t = data.progress;
      const k = 1 - (1 - t) * (1 - t); // easeOutQuad
      data.transform.position.x = data.startX + (data.targetX - data.startX) * k;
      data.transform.position.y = data.startY + (data.targetY - data.startY) * k;
      if (data.progress >= 1) {
        this._active.delete(entity);
        this._emitSmoke(data.targetX, data.targetY);
      }
    }
  }

  _emitSmoke(x, y) {
    if (!this.particleSystem) return;
    const c = this.config;
    for (let i = 0; i < c.smokeParticleCount; i++) {
      const angle = Math.PI * (i / c.smokeParticleCount);
      const offsetX = Math.cos(angle) * c.smokeRadius;
      const offsetY = Math.sin(angle) * c.smokeRadius;
      this.particleSystem.emit({
        position: { x: x + offsetX, y: y + offsetY },
        velocity: { x: Math.cos(angle) * 40, y: Math.sin(angle) * 20 + 8 },
        life: c.smokeLife,
        size: c.smokeSize.min + fxRng.next() * (c.smokeSize.max - c.smokeSize.min),
        color: c.smokeColor, alpha: c.smokeAlpha, friction: c.smokeFriction, gravity: c.smokeGravity
      });
    }
  }

  /** 闪避冷却剩余时间（毫秒），0 表示就绪。 */
  getDodgeCooldownRemaining() {
    const elapsed = this.now() - this._lastDodgeTime;
    return Math.max(0, this.config.cooldownMs - elapsed);
  }

  /** 闪避冷却总时长（毫秒）。 */
  getDodgeCooldownTotal() {
    return this.config.cooldownMs;
  }

  isOnCooldown() {
    return this.getDodgeCooldownRemaining() > 0;
  }

  cleanup() {
    this._active.clear();
    this.particleSystem = null;
    this.floatingTextManager = null;
  }
}

export default DodgeSystem;
