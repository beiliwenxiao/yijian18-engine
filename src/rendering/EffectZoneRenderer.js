/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-08-02
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

import { Logger } from '../core/Logger.js';
import { SceneObjectProjector } from '../core/scene/SceneObjectProjector.js';

/**
 * EffectZoneRenderer - 特效区域粒子渲染器
 *
 * 从场景数据中收集所有 type:'effectZone' 的多边形区域，
 * 在其内部持续生成粒子（复用 ParticleSystem），按 effectType 应用不同的运动预设。
 *
 * 典型 effectType 预设：
 *   fire    — 粒子从区域底部升起，颜色从红到黄，有重力上浮
 *   water   — 粒子沿水平方向流动，蓝色，带摩擦减速
 *   lake    — 粒子缓慢扩散，半透明蓝绿，模拟涟漪
 *   ice     — 粒子小而亮，缓慢上飘，白/浅蓝闪烁
 *   smoke   — 粒子灰白大块，缓慢上升，高摩擦
 *   sparkle — 粒子随机方向，金色小点，短生命快闪
 *
 * 使用方式：
 *   const renderer = new EffectZoneRenderer(particleSystem);
 *   renderer.loadFromSceneData(sceneData, worldOffset);
 *   // 每帧
 *   renderer.update(deltaTime);
 *
 * authority: 'client'  // 纯表现
 */

/**
 * 预设参数生成器：根据 effectType + 用户自定义参数 → 每帧发射的粒子配置
 * 返回 { velocity, gravity, friction, life, size, color, alpha, spawnBias }
 * spawnBias: 'bottom'(火焰从底部升)/'random'(均匀分布)/'surface'(湖面顶部)
 */
const EFFECT_PRESETS = {
  fire: (zone) => ({
    velocity: { x: () => (Math.random() - 0.5) * 20, y: () => -(zone.particleSpeed || 40) * (0.7 + Math.random() * 0.6) },
    gravity: -30,   // 负重力 = 上浮
    friction: 0.96,
    life: (zone.particleLife || 1.2) * 1000,
    size: zone.particleSize || 6,
    color: zone.particleColor || '#ff6622',
    alpha: zone.particleAlpha || 0.8,
    isFire: true,
    spawnBias: 'bottom'
  }),
  water: (zone) => ({
    velocity: { x: () => (zone.particleSpeed || 25) * (0.3 + Math.random() * 0.4), y: () => (Math.random() - 0.5) * 4 },
    gravity: 0,
    friction: 0.99,
    life: (zone.particleLife || 2.5) * 1000,
    size: zone.particleSize || 2.5,
    color: zone.particleColor || '#88ccee',
    alpha: zone.particleAlpha || 0.5,
    spawnBias: 'random',
    shape: 'streak'    // 水平拉伸条纹
  }),
  lake: (zone) => ({
    velocity: { x: () => (Math.random() - 0.5) * 5, y: () => (Math.random() - 0.5) * 3 },
    gravity: 0,
    friction: 0.95,
    life: (zone.particleLife || 3) * 1000,
    size: zone.particleSize || 3,
    color: zone.particleColor || '#aaddee',
    alpha: zone.particleAlpha || 0.3,
    spawnBias: 'random',
    shape: 'ripple'    // 扁平椭圆涟漪
  }),
  ice: (zone) => ({
    velocity: { x: () => (Math.random() - 0.5) * 12, y: () => -(5 + Math.random() * 15) },
    gravity: -5,
    friction: 0.97,
    life: (zone.particleLife || 1.5) * 1000,
    size: zone.particleSize || 3,
    color: zone.particleColor || '#cceeFF',
    alpha: zone.particleAlpha || 0.9,
    spawnBias: 'random'
  }),
  smoke: (zone) => ({
    velocity: { x: () => (Math.random() - 0.5) * 15, y: () => -(zone.particleSpeed || 20) * (0.4 + Math.random() * 0.4) },
    gravity: -8,
    friction: 0.94,
    life: (zone.particleLife || 2.5) * 1000,
    size: zone.particleSize || 12,
    color: zone.particleColor || '#888888',
    alpha: zone.particleAlpha || 0.4,
    spawnBias: 'bottom'
  }),
  sparkle: (zone) => ({
    velocity: { x: () => (Math.random() - 0.5) * (zone.particleSpeed || 60), y: () => (Math.random() - 0.5) * (zone.particleSpeed || 60) },
    gravity: 0,
    friction: 0.9,
    life: (zone.particleLife || 0.6) * 1000,
    size: zone.particleSize || 3,
    color: zone.particleColor || '#ffdd44',
    alpha: zone.particleAlpha || 1,
    spawnBias: 'random'
  })
};

export class EffectZoneRenderer {
  /**
   * @param {import('./ParticleSystem.js').ParticleSystem} particleSystem - 场景的粒子系统实例
   */
  constructor(particleSystem, { projector = null } = {}) {
    this.particleSystem = particleSystem;
    this.projector = projector || new SceneObjectProjector();
    /** @type {Array<Object>} 当前场景的特效区域列表 */
    this.zones = [];
    /** 每个 zone 的发射累积器 */
    this._accumulators = [];
  }

  /**
   * 从场景数据中收集所有 effectZone 对象
   * @param {Object} sceneData - 场景 JSON（含 layers）
   * @param {{x:number, y:number}} [worldOffset] - 世界坐标偏移
   */
  loadFromSceneData(sceneData, worldOffset = { x: 0, y: 0 }) {
    this.zones = [];
    this._accumulators = [];
    if (!sceneData || !Array.isArray(sceneData.layers)) return;

    for (const layer of sceneData.layers) {
      if (!layer || !Array.isArray(layer.objects)) continue;
      for (const obj of layer.objects) {
        if (!obj || obj.type !== 'effectZone') continue;
        if (!Array.isArray(obj.points) || obj.points.length < 3) continue;
        const source = Number.isFinite(obj.sortY)
          ? obj
          : { ...obj, sortY: (Number(obj.y) || 0) + (Number(obj.height) || 0) };
        this.zones.push(this.projector.project(source, worldOffset));
        this._accumulators.push(0);
      }
    }

    if (this.zones.length > 0) {
      Logger.log(`[EffectZoneRenderer] 加载了 ${this.zones.length} 个特效区域`);
    }
  }

  /**
   * 每帧更新：按 rate 在区域内生成粒子
   * @param {number} deltaTime - 秒
   */
  update(deltaTime) {
    for (let i = 0; i < this.zones.length; i++) {
      const zone = this.zones[i];
      const rate = zone.particleRate || 12;
      const interval = 1 / rate;

      this._accumulators[i] += deltaTime;
      while (this._accumulators[i] >= interval) {
        this._accumulators[i] -= interval;
        this._emitOne(zone);
      }
    }
  }

  /** @private 在区域内生成一个粒子 */
  _emitOne(zone) {
    const presetFn = EFFECT_PRESETS[zone.effectType] || EFFECT_PRESETS.fire;
    const preset = presetFn(zone);
    const pos = this._randomPointInZone(zone, preset.spawnBias);

    this.particleSystem.emit({
      position: pos,
      velocity: {
        x: typeof preset.velocity.x === 'function' ? preset.velocity.x() : preset.velocity.x,
        y: typeof preset.velocity.y === 'function' ? preset.velocity.y() : preset.velocity.y
      },
      life: preset.life * (0.8 + Math.random() * 0.4),
      size: preset.size * (0.7 + Math.random() * 0.6),
      color: preset.color,
      alpha: preset.alpha,
      isFire: preset.isFire === true,
      gravity: preset.gravity,
      friction: preset.friction,
      shape: preset.shape || 'circle',  // circle / streak / ripple
      renderLayer: zone.depthSort === true ? 'worldDepth' : 'effects',
      sortY: Number.isFinite(zone.sortY) ? zone.sortY : pos.y
    });
  }

  /**
   * 在多边形区域内随机取一点
   * @param {Object} zone
   * @param {string} bias - 'random'|'bottom'|'surface'|'left'
   * @returns {{x:number, y:number}}
   * @private
   */
  _randomPointInZone(zone, bias) {
    const pts = zone.points;
    const bbox = { minX: zone.x, minY: zone.y, maxX: zone.x + zone.width, maxY: zone.y + zone.height };

    // 快速方法：先在包围盒内随机，然后 reject 不在多边形内的点（最多 20 次，否则用中心）
    for (let attempt = 0; attempt < 20; attempt++) {
      let x, y;
      if (bias === 'bottom') {
        // 底部 30% 区域
        x = bbox.minX + Math.random() * (bbox.maxX - bbox.minX);
        y = bbox.maxY - Math.random() * (bbox.maxY - bbox.minY) * 0.3;
      } else if (bias === 'surface') {
        // 顶部 20% 区域
        x = bbox.minX + Math.random() * (bbox.maxX - bbox.minX);
        y = bbox.minY + Math.random() * (bbox.maxY - bbox.minY) * 0.2;
      } else if (bias === 'left') {
        // 左侧 20% 区域
        x = bbox.minX + Math.random() * (bbox.maxX - bbox.minX) * 0.2;
        y = bbox.minY + Math.random() * (bbox.maxY - bbox.minY);
      } else {
        x = bbox.minX + Math.random() * (bbox.maxX - bbox.minX);
        y = bbox.minY + Math.random() * (bbox.maxY - bbox.minY);
      }
      if (this._pointInPolygon(pts, x, y)) return { x, y };
    }
    // 兜底：多边形质心
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; }
    return { x: cx / pts.length, y: cy / pts.length };
  }

  /**
   * 射线法判断点是否在多边形内
   * @private
   */
  _pointInPolygon(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1];
      const xj = pts[j][0], yj = pts[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  /** 清除所有区域（场景切换时） */
  clear() {
    this.zones = [];
    this._accumulators = [];
  }

  /** 获取当前区域数 */
  getZoneCount() {
    return this.zones.length;
  }
}

export default EffectZoneRenderer;
