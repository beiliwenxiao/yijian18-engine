/**
 * TimeSystem - 游戏时间系统
 *
 * 时间段：dawn(凌晨), earlyMorning(清晨), morning(上午), noon(中午),
 *         afternoon(下午), dusk(黄昏), night(夜晚), lateNight(深夜)
 * 每个时间段有 brightness、fogOpacity、tintColor。
 * 时间自动推进，段与段之间平滑过渡。
 * 可通过触发器 setTime 跳转到指定时间段。
 */
const DARKNESS_PERIODS = new Set(['dawn', 'dusk', 'night', 'lateNight']);

export class TimeSystem {
  static PERIODS = ['dawn', 'earlyMorning', 'morning', 'noon', 'afternoon', 'dusk', 'night', 'lateNight'];

  static PERIOD_NAMES = {
    dawn: '凌晨', earlyMorning: '清晨', morning: '上午', noon: '中午',
    afternoon: '下午', dusk: '黄昏', night: '夜晚', lateNight: '深夜'
  };

  static DEFAULTS = {
    // darknessOpacity 仅属于 Canvas atmosphere 表现：黄昏/凌晨轻微，夜晚/深夜很深。
    dawn:         { duration: 60, brightness: 0.4,  darknessOpacity: 0.25, fogOpacity: 0.6,  tintColor: 'rgba(80,60,120,0.2)' },
    earlyMorning: { duration: 60, brightness: 0.6,  darknessOpacity: 0,    fogOpacity: 0.3,  tintColor: 'rgba(255,200,100,0.1)' },
    morning:      { duration: 60, brightness: 0.9,  darknessOpacity: 0,    fogOpacity: 0.1,  tintColor: 'rgba(0,0,0,0)' },
    noon:         { duration: 60, brightness: 1.0,  darknessOpacity: 0,    fogOpacity: 0.0,  tintColor: 'rgba(0,0,0,0)' },
    afternoon:    { duration: 60, brightness: 0.85, darknessOpacity: 0,    fogOpacity: 0.1,  tintColor: 'rgba(255,180,50,0.05)' },
    dusk:         { duration: 60, brightness: 0.5,  darknessOpacity: 0.25, fogOpacity: 0.4,  tintColor: 'rgba(255,100,50,0.15)' },
    night:        { duration: 60, brightness: 0.25, darknessOpacity: 0.65, fogOpacity: 0.7,  tintColor: 'rgba(20,20,80,0.3)' },
    lateNight:    { duration: 60, brightness: 0.15, darknessOpacity: 0.65, fogOpacity: 0.8,  tintColor: 'rgba(10,10,40,0.4)' }
  };

  constructor(config = {}) {
    this.enabled = config.enabled !== false;
    this.paused = false;

    // 从配置加载各时间段参数
    this.periods = {};
    for (const p of TimeSystem.PERIODS) {
      this.periods[p] = { ...TimeSystem.DEFAULTS[p], ...(config.periods?.[p] || {}) };
    }

    // 计算总周期
    this.cycleDuration = 0;
    for (const p of TimeSystem.PERIODS) this.cycleDuration += this.periods[p].duration;

    // 当前时间（秒，0 ~ cycleDuration）与从 1 开始的游戏日。
    this.elapsed = Number.isFinite(config.startTime) ? Number(config.startTime) : 0;
    this.currentDay = Math.max(1, Math.floor(Number(config.currentDay) || 1));

    // 过渡缓存
    this._currentBrightness = 1;
    this._currentDarknessOpacity = 0;
    this._currentFogOpacity = 0;
    this._currentTintColor = 'rgba(0,0,0,0)';
    this._update(0); // 初始化
  }

  /** 获取当前时间段名 */
  getCurrentPeriod() {
    return this._getPeriodAt(this.elapsed).name;
  }

  /** 获取当前时间段内进度 0~1 */
  getProgress() {
    const info = this._getPeriodAt(this.elapsed);
    return info.progress;
  }

  /** 获取当前明暗度 0~1 */
  getBrightness() { return this._currentBrightness; }

  /**
   * 获取当前黑暗蒙版透明度。黑幕只在凌晨、黄昏、夜晚和深夜启用，
   * 强度完全由当前时间段的表现配置决定，不保留开场专用黑幕状态。
   */
  getDarknessOpacity() {
    if (!this.enabled || !DARKNESS_PERIODS.has(this.getCurrentPeriod())) return 0;
    return Math.max(0, Math.min(1, this._currentDarknessOpacity));
  }

  /** 当前是否存在需要参与 atmosphere 合成的时间覆盖层。 */
  hasAtmosphereOverlay() {
    if (!this.enabled) return false;
    return this.getDarknessOpacity() > 0.01 || this._parseRgba(this._currentTintColor)[3] > 0.001;
  }

  /** 获取当前雾透明度 0~1 */
  getFogOpacity() { return this._currentFogOpacity; }

  /** 获取当前色调 */
  getTintColor() { return this._currentTintColor; }

  /** 获取当前游戏日（从 1 开始）。 */
  getCurrentDay() { return this.currentDay; }

  /** 设置游戏日；用于从 StoryState/存档恢复。 */
  setCurrentDay(day) {
    const normalized = Math.max(1, Math.floor(Number(day) || 1));
    const changed = normalized !== this.currentDay;
    this.currentDay = normalized;
    return changed;
  }

  /** 显式推进游戏日；休息、章节推进等玩法可复用。 */
  advanceDays(days = 1) {
    const amount = Math.max(0, Math.floor(Number(days) || 0));
    this.currentDay += amount;
    return this.currentDay;
  }

  /** 手动跳转到某时间段开头；暂停状态下也允许显式修改。 */
  setTimePeriod(period) {
    let offset = 0;
    for (const p of TimeSystem.PERIODS) {
      if (p === period) {
        this.elapsed = offset;
        this._update(0);
        return true;
      }
      offset += this.periods[p].duration;
    }
    return false;
  }

  /** 暂停/继续 */
  setPaused(v) { this.paused = v; }

  update(deltaTime) {
    if (!this.enabled || this.paused) return;
    this._update(deltaTime);
  }

  _update(deltaTime) {
    const duration = Math.max(0.001, this.cycleDuration);
    const total = this.elapsed + (Number(deltaTime) || 0);
    const crossedDays = Math.floor(total / duration);
    this.elapsed = ((total % duration) + duration) % duration;
    if (crossedDays > 0) this.currentDay += crossedDays;
    else if (crossedDays < 0) this.currentDay = Math.max(1, this.currentDay + crossedDays);

    // 当前时间段和下一个时间段的 lerp
    const info = this._getPeriodAt(this.elapsed);
    const curDef = this.periods[info.name];
    const nextIdx = (TimeSystem.PERIODS.indexOf(info.name) + 1) % TimeSystem.PERIODS.length;
    const nextDef = this.periods[TimeSystem.PERIODS[nextIdx]];

    // 在当前段后 80% 开始向下一段过渡（20% 过渡区）
    const transStart = 0.8;
    let t = 0;
    if (info.progress > transStart) {
      t = (info.progress - transStart) / (1 - transStart);
    }

    this._currentBrightness = this._lerp(curDef.brightness, nextDef.brightness, t);
    this._currentDarknessOpacity = this._lerp(curDef.darknessOpacity, nextDef.darknessOpacity, t);
    this._currentFogOpacity = this._lerp(curDef.fogOpacity, nextDef.fogOpacity, t);
    this._currentTintColor = this._lerpColor(curDef.tintColor, nextDef.tintColor, t);
  }

  _getPeriodAt(elapsed) {
    let offset = 0;
    for (const p of TimeSystem.PERIODS) {
      const dur = this.periods[p].duration;
      if (elapsed < offset + dur) {
        return { name: p, progress: (elapsed - offset) / dur };
      }
      offset += dur;
    }
    return { name: TimeSystem.PERIODS[0], progress: 0 };
  }

  _lerp(a, b, t) { return a + (b - a) * t; }

  _lerpColor(c1, c2, t) {
    const p1 = this._parseRgba(c1);
    const p2 = this._parseRgba(c2);
    const r = Math.round(this._lerp(p1[0], p2[0], t));
    const g = Math.round(this._lerp(p1[1], p2[1], t));
    const b = Math.round(this._lerp(p1[2], p2[2], t));
    const a = this._lerp(p1[3], p2[3], t).toFixed(3);
    return `rgba(${r},${g},${b},${a})`;
  }

  _parseRgba(str) {
    const m = (str || '').match(/[\d.]+/g);
    if (!m || m.length < 4) return [0, 0, 0, 0];
    return [parseFloat(m[0]), parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
  }

  serialize() {
    return {
      enabled: this.enabled,
      paused: this.paused,
      currentDay: this.currentDay,
      elapsed: this.elapsed
    };
  }

  deserialize(data = {}) {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.enabled === 'boolean') this.enabled = data.enabled;
    if (typeof data.paused === 'boolean') this.paused = data.paused;
    if (Number.isFinite(data.currentDay)) this.setCurrentDay(data.currentDay);
    if (Number.isFinite(data.elapsed)) {
      const duration = Math.max(0.001, this.cycleDuration);
      this.elapsed = ((Number(data.elapsed) % duration) + duration) % duration;
    }
    this._update(0);
    return true;
  }

  /** 渲染时间系统的明暗/色调层（屏幕坐标，可绘制到独立 atmosphere Canvas）。 */
  render(ctx, width, height) {
    if (!this.enabled) return false;
    let rendered = false;

    const darknessOpacity = this.getDarknessOpacity();
    if (darknessOpacity > 0.01) {
      ctx.save();
      ctx.globalAlpha = darknessOpacity;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
      rendered = true;
    }

    // 色调与黑暗门禁分离：白天不画黑幕，但仍保留清晨/下午的环境色。
    if (this._currentTintColor && this._currentTintColor !== 'rgba(0,0,0,0)') {
      ctx.save();
      ctx.fillStyle = this._currentTintColor;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
      rendered = true;
    }
    return rendered;
  }
}

export default TimeSystem;
