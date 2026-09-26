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
 * TaskMarkerBeacon - 任务点引导闪光信标
 *
 * 在世界空间为当前场景的任务目标点持续发射金色闪光粒子，
 * 引导玩家走过去。标记点数据由 SceneHudUpdater 每帧喂送
 * （与小地图任务投影同一份 taskGraph 投影，坐标为世界坐标）。
 *
 * 表现：萤火虫式发光点 + 星形闪光，明暗错落持续闪烁；周期性一簇星形
 * 萤光轻轻弹起（节奏感"看这里"）。纯表现组件：authority 'client'，不写回任何工程数据。
 *
 * 使用方式：
 *   const beacon = new TaskMarkerBeacon(scene.particleSystem);
 *   // 每帧（SceneHudUpdater 喂点后）
 *   beacon.update(deltaTime);
 */

const finite = value => Number.isFinite(value) ? value : null;

export class TaskMarkerBeacon {
  /**
   * @param {import('./ParticleSystem.js').ParticleSystem|null} particleSystem
   * @param {Object} [options]
   * @param {number} [options.rate=6] - 每个任务点的常驻发射率（粒子/秒）
   * @param {number} [options.pulseInterval=2.5] - 脉冲爆发间隔（秒）
   * @param {string} [options.color='#ffd54f'] - 主色（与任务标记同色系）
   * @param {string} [options.highlightColor='#fff8dc'] - 高亮色（少量混入）
   */
  constructor(particleSystem, options = {}) {
    this.particleSystem = particleSystem || null;
    this.rate = Number(options.rate) > 0 ? Number(options.rate) : 6;
    this.pulseInterval = Number(options.pulseInterval) > 0 ? Number(options.pulseInterval) : 2.5;
    this.color = options.color || '#ffd54f';
    this.highlightColor = options.highlightColor || '#fff8dc';
    /** @type {Array<{key:string, x:number, y:number, accumulator:number, pulseTimer:number}>} */
    this._points = [];
  }

  /**
   * 每帧喂送任务点（SceneHudUpdater 调用）。按 currentSceneId 过滤出当前场景的点。
   * 相同 key 的点保留累积器状态（数据刷新不会重置发射节奏与脉冲相位）。
   * @param {Array<{x:number, y:number, sceneId?:string, targetId?:string}>} markers
   * @param {string} [currentSceneId]
   */
  setMarkers(markers = [], currentSceneId = '') {
    const list = Array.isArray(markers) ? markers : [];
    const previous = new Map(this._points.map(point => [point.key, point]));
    const points = [];
    for (const marker of list) {
      const x = finite(marker?.x);
      const y = finite(marker?.y);
      if (x === null || y === null) continue;
      if (currentSceneId && String(marker?.sceneId ?? '') !== String(currentSceneId)) continue;
      const key = `${marker?.sceneId ?? ''}:${marker?.targetId ?? ''}:${x}:${y}`;
      const reused = previous.get(key);
      points.push(reused || {
        key,
        x,
        y,
        accumulator: Math.random() / this.rate, // 首帧随机相位，避免多点同拍闪烁
        pulseTimer: Math.random() * this.pulseInterval
      });
    }
    this._points = points;
  }

  /** 当前世界空间任务点数（诊断用）。 */
  getPointCount() {
    return this._points.length;
  }

  /**
   * 每帧更新：按 rate 发射常驻闪光，脉冲计时到点后爆发一簇。
   * @param {number} deltaTime - 秒
   */
  update(deltaTime) {
    if (!this.particleSystem || this._points.length === 0) return;
    const dt = Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0;
    for (const point of this._points) {
      point.accumulator += dt;
      const interval = 1 / this.rate;
      let guard = 0;
      while (point.accumulator >= interval && guard < 16) {
        point.accumulator -= interval;
        this._emitSpark(point);
        guard++;
      }
      point.pulseTimer -= dt;
      if (point.pulseTimer <= 0) {
        point.pulseTimer = this.pulseInterval;
        this._emitPulse(point);
      }
    }
  }

  /** 清空任务点（场景切换时调用；已发射粒子随生命自然消亡）。 */
  clear() {
    this._points = [];
  }

  /** 萤火虫萤光：小发光点/星形闪光，明暗与寿命各自随机，群体验闪烁感。 */
  _emitSpark(point) {
    const highlight = Math.random() < 0.3;
    const star = Math.random() < 0.3;
    const x = point.x + (Math.random() - 0.5) * 28;
    const y = point.y - Math.random() * 24;
    this.particleSystem.emit({
      position: { x, y },
      velocity: { x: (Math.random() - 0.5) * 7, y: -(6 + Math.random() * 8) },
      gravity: -1.5, // 极轻微上浮，飘忽感
      friction: 0.99,
      life: (0.8 + Math.random() * 0.7) * 1000,
      size: star ? 1.2 + Math.random() * 1.2 : 1.4 + Math.random() * 1.1,
      shape: star ? 'star' : 'circle',
      color: highlight ? this.highlightColor : this.color,
      alpha: 0.35 + Math.random() * 0.6, // 各自明暗错落 → 萤火虫式闪烁
      blendMode: 'lighter', // 叠加发光，暗处更亮
      renderLayer: 'effects',
      sortY: y
    });
  }

  /** 脉冲：一簇星形萤光轻轻弹起，节奏感"看这里"。 */
  _emitPulse(point) {
    for (let index = 0; index < 8; index++) {
      const star = Math.random() < 0.6;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 3); // 向上 ±30°
      const speed = 26 + Math.random() * 26;
      const y = point.y - Math.random() * 14;
      this.particleSystem.emit({
        position: { x: point.x + (Math.random() - 0.5) * 12, y },
        velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        gravity: 10, // 轻微下落弧线
        friction: 0.985,
        life: (0.6 + Math.random() * 0.4) * 1000,
        size: star ? 1.4 + Math.random() * 1.4 : 1.3 + Math.random() * 1.1,
        shape: star ? 'star' : 'circle',
        color: Math.random() < 0.35 ? this.highlightColor : this.color,
        alpha: 0.55 + Math.random() * 0.45,
        blendMode: 'lighter',
        renderLayer: 'effects',
        sortY: y
      });
    }
  }
}

export default TaskMarkerBeacon;
