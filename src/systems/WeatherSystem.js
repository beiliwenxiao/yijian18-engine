const BASE_VIEWPORT_WIDTH = 1280;
const BASE_VIEWPORT_HEIGHT = 720;
const BASE_VIEWPORT_AREA = BASE_VIEWPORT_WIDTH * BASE_VIEWPORT_HEIGHT;
const MAX_COUNT_SCALE = 4;
const MAX_FOG_CLOUDS = 10;
const PARTICLE_SPAWN_PADDING = 80;
const PARTICLE_CULL_PADDING = 140;
const SUNBEAM_PADDING = 120;

function normalizeBounds(value) {
  if (!value || typeof value !== 'object') return null;
  const left = Number(value.left);
  const right = Number(value.right);
  const top = Number(value.top);
  const bottom = Number(value.bottom);
  if (![left, right, top, bottom].every(Number.isFinite)
    || right <= left || bottom <= top) return null;
  return { left, right, top, bottom };
}

function resolveViewBounds(runtime, width, height, fallback = null) {
  const source = runtime?.viewBounds ?? runtime;
  const normalized = normalizeBounds(source);
  if (normalized) return normalized;
  const previous = normalizeBounds(fallback);
  if (previous) return previous;
  const resolvedWidth = Math.max(1, Number(width) || BASE_VIEWPORT_WIDTH);
  const resolvedHeight = Math.max(1, Number(height) || BASE_VIEWPORT_HEIGHT);
  return { left: 0, top: 0, right: resolvedWidth, bottom: resolvedHeight };
}

function expandBounds(bounds, padding) {
  return {
    left: bounds.left - padding,
    right: bounds.right + padding,
    top: bounds.top - padding,
    bottom: bounds.bottom + padding
  };
}

function boundsOverlap(a, b) {
  return a.left < b.right && a.right > b.left
    && a.top < b.bottom && a.bottom > b.top;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function normalizeFogImageIds(imageIds) {
  const ids = [];
  const seen = new Set();
  for (const value of Array.isArray(imageIds) ? imageIds : []) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return Object.freeze(ids);
}

function normalizeFogCloudLimit(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return MAX_FOG_CLOUDS;
  return Math.min(MAX_FOG_CLOUDS, Math.max(0, Math.floor(count)));
}

function isDrawableImage(image) {
  if (!image || typeof image !== 'object') return false;
  const width = Number(image.naturalWidth || image.videoWidth || image.width);
  const height = Number(image.naturalHeight || image.videoHeight || image.height);
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
}

function normalizeFogImages(images) {
  const drawables = [];
  for (const image of Array.isArray(images) ? images : []) {
    if (isDrawableImage(image)) drawables.push(image);
  }
  return drawables;
}

/**
 * 把 core 投影的 coverage 规范成仅供当前帧使用的查找结构。
 * 任何非法或空 coverage 都表示雾不允许出现，绝不退化为 Region 或视口边界。
 */
function normalizeFogCoverage(coverage) {
  const rects = [];
  const byKey = new Map();
  for (const candidate of Array.isArray(coverage?.rects) ? coverage.rects : []) {
    const key = typeof candidate?.key === 'string' ? candidate.key.trim() : '';
    const left = Number(candidate?.left);
    const right = Number(candidate?.right);
    const top = Number(candidate?.top);
    const bottom = Number(candidate?.bottom);
    if (!key || byKey.has(key) || ![left, right, top, bottom].every(Number.isFinite)
      || right <= left || bottom <= top) continue;
    const rect = { key, left, right, top, bottom };
    rects.push(rect);
    byKey.set(key, rect);
  }
  const signature = rects.map(rect => [
    rect.key, rect.left, rect.top, rect.right, rect.bottom
  ].join(':')).join('|');
  return { rects, byKey, signature };
}

function fogCloudFitsRect(cloud, rect) {
  return !!cloud && !!rect
    && Number.isFinite(cloud.x) && Number.isFinite(cloud.y)
    && Number.isFinite(cloud.width) && Number.isFinite(cloud.height)
    && cloud.width > 0 && cloud.height > 0
    && cloud.x >= rect.left && cloud.y >= rect.top
    && cloud.x + cloud.width <= rect.right
    && cloud.y + cloud.height <= rect.bottom;
}

export class WeatherSystem {
  constructor(config = null) {
    this.currentWeather = config?.default ?? null;
    this.targetWeather = this.currentWeather;
    this.debugOverrideWeather = null;
    this.transitionProgress = 1;
    this.transitionSpeed = Number.isFinite(Number(config?.transitionSpeed))
      ? Number(config.transitionSpeed)
      : 0;

    this.weatherDefs = {
      clear:     {},
      breeze:    { count: 12, windX: 40, windY: 3 },
      wind:      { count: 35, windX: 120, windY: 8 },
      lightRain: { count: 80, windX: 8, windY: 350 },
      heavyRain: { count: 180, windX: 30, windY: 520 },
      lightFog:  { count: 8 },
      heavyFog:  { count: MAX_FOG_CLOUDS },
      storm:     { count: 140, windX: 55, windY: 480, lightning: true }
    };

    if (config?.particles) {
      for (const [key, val] of Object.entries(config.particles)) {
        if (this.weatherDefs[key]) Object.assign(this.weatherDefs[key], val);
      }
    }

    this._fogImageIds = normalizeFogImageIds(config?.fog?.imageIds);
    this.maxFogClouds = normalizeFogCloudLimit(config?.fog?.maxClouds);
    this._fogImages = [];
    this._fogCoverageSignature = '';
    this._particles = [];
    this._fogClouds = [];
    this._lightningTimer = 0;
    this._lightningFlash = 0;
    this._sunbeamTimer = 0;
    this._sunbeams = [];
    this._time = 0;
    this._viewBounds = null;

    this.regions = [];
  }

  _clearSpatialEffects({ resetSunbeamTimer = false } = {}) {
    this._particles.length = 0;
    this._fogClouds.length = 0;
    this._sunbeams.length = 0;
    if (resetSunbeamTimer) this._sunbeamTimer = 0;
  }

  /** 返回天气配置引用的稳定图片 ID；调用方负责通过既有 AssetManager 预载。 */
  getFogImageIds() {
    return Object.freeze([...this._fogImageIds]);
  }

  /**
   * 注入已由 AssetManager 成功加载的可绘制图片。
   * 不接收路径、不创建 AssetManager，也不为缺图构造程序化雾后备。
   */
  setFogImages(images = []) {
    this._fogImages = normalizeFogImages(images);
    this._fogClouds.length = 0;
    return this._fogImages.length;
  }

  setWeather(type, options = {}) {
    if (!this.weatherDefs[type]) return false;
    this.targetWeather = type;
    this.transitionProgress = 0;
    this._clearSpatialEffects({ resetSunbeamTimer: true });
    if (options.immediate) {
      this.currentWeather = type;
      this.transitionProgress = 1;
    }
    return true;
  }

  setDebugWeatherOverride(type) {
    if (!this.weatherDefs[type]) return false;
    this.debugOverrideWeather = type;
    this._clearSpatialEffects({ resetSunbeamTimer: true });
    this._lightningTimer = 0;
    this._lightningFlash = 0;
    return true;
  }

  clearDebugWeatherOverride() {
    if (!this.debugOverrideWeather) return false;
    this.debugOverrideWeather = null;
    this._clearSpatialEffects({ resetSunbeamTimer: true });
    this._lightningTimer = 0;
    this._lightningFlash = 0;
    return true;
  }

  getVisualWeather() {
    return this.debugOverrideWeather || this.targetWeather;
  }

  setRegionWeather(regionId, weather) {
    const r = this.regions.find(region => region.id === regionId);
    if (r) r.weather = weather;
    else this.regions.push({ id: regionId, weather });
  }

  /** 只保存天气业务表现状态；粒子、coverage、图片、雾团、闪电和调试覆盖均为可重建瞬态。 */
  serialize() {
    return {
      currentWeather: this.currentWeather,
      targetWeather: this.targetWeather,
      transitionProgress: this.transitionProgress,
      regions: this.regions.map(region => ({ id: region.id, weather: region.weather }))
    };
  }

  /** 原子恢复天气状态；非法快照不修改当前天气。 */
  deserialize(data = {}) {
    if (!data || typeof data !== 'object') return false;
    const isWeather = value => value === null
      || (typeof value === 'string' && Object.prototype.hasOwnProperty.call(this.weatherDefs, value));
    const currentWeather = data.currentWeather ?? null;
    const targetWeather = data.targetWeather ?? null;
    const transitionProgress = Number(data.transitionProgress);
    const regions = data.regions ?? [];
    if (!isWeather(currentWeather) || !isWeather(targetWeather)
      || !Number.isFinite(transitionProgress) || transitionProgress < 0 || transitionProgress > 1
      || !Array.isArray(regions)) return false;

    const restoredRegions = [];
    for (const region of regions) {
      if (typeof region?.id !== 'string' || !region.id || !isWeather(region.weather ?? null)) return false;
      restoredRegions.push({ id: region.id, weather: region.weather ?? null });
    }

    this.currentWeather = currentWeather;
    this.targetWeather = targetWeather;
    this.transitionProgress = transitionProgress;
    this.regions = restoredRegions;
    this._clearSpatialEffects({ resetSunbeamTimer: true });
    this._fogCoverageSignature = '';
    this._lightningTimer = 0;
    this._lightningFlash = 0;
    this._time = 0;
    this._viewBounds = null;
    return true;
  }

  _syncViewBounds(runtime = {}) {
    const next = resolveViewBounds(runtime, BASE_VIEWPORT_WIDTH, BASE_VIEWPORT_HEIGHT, this._viewBounds);
    const previous = this._viewBounds;
    const cameraDelta = previous
      ? {
          x: (next.left + next.right - previous.left - previous.right) / 2,
          y: (next.top + next.bottom - previous.top - previous.bottom) / 2
        }
      : { x: 0, y: 0 };
    const jumped = previous !== null && !boundsOverlap(previous, next);
    this._viewBounds = next;
    if (jumped) this._clearSpatialEffects({ resetSunbeamTimer: true });
    return { bounds: next, cameraDelta };
  }

  _syncFogCoverage(coverage) {
    const normalized = normalizeFogCoverage(coverage);
    if (normalized.signature !== this._fogCoverageSignature) {
      this._fogCoverageSignature = normalized.signature;
      this._fogClouds.length = 0;
    }
    return normalized;
  }

  update(deltaTime, runtime = {}) {
    if (!this.targetWeather || !this.weatherDefs[this.targetWeather]) return;
    const dt = Math.max(0, Number(deltaTime) || 0);
    const { bounds, cameraDelta } = this._syncViewBounds(runtime);
    const fogCoverage = this._syncFogCoverage(runtime?.loadedCoverage);
    this._time += dt;

    if (this.transitionProgress < 1) {
      this.transitionProgress = Math.min(1, this.transitionProgress + this.transitionSpeed * dt);
      if (this.transitionProgress >= 1) this.currentWeather = this.targetWeather;
    }

    const weather = this.getVisualWeather();
    const def = this.weatherDefs[weather];

    if (weather === 'clear') this._updateSunbeams(dt, bounds);
    else this._sunbeams.length = 0;

    if (weather === 'breeze' || weather === 'wind'
      || weather === 'lightRain' || weather === 'heavyRain' || weather === 'storm') {
      this._updateParticles(dt, def, weather, bounds, cameraDelta);
    } else {
      this._particles.length = 0;
    }

    if (weather === 'lightFog' || weather === 'heavyFog') {
      this._updateFogClouds(dt, def, weather, fogCoverage);
    } else {
      this._fogClouds.length = 0;
    }

    if (def?.lightning) {
      this._lightningTimer -= dt;
      if (this._lightningTimer <= 0) {
        this._lightningFlash = 0.9;
        this._lightningTimer = 2 + Math.random() * 4;
      }
    }
    if (this._lightningFlash > 0) {
      this._lightningFlash = Math.max(0, this._lightningFlash - dt * 5);
    }
  }

  _getTargetCount(def, bounds, fallback) {
    const configured = Number(def?.count);
    const baseCount = Number.isFinite(configured) && configured >= 0
      ? Math.floor(configured)
      : fallback;
    if (baseCount <= 0) return 0;
    const area = (bounds.right - bounds.left) * (bounds.bottom - bounds.top);
    const scale = Math.max(0.25, Math.min(MAX_COUNT_SCALE, area / BASE_VIEWPORT_AREA));
    return Math.max(1, Math.round(baseCount * scale));
  }

  _getFogTargetCount(def, fallback = 8) {
    const configured = Number(def?.count);
    const baseCount = Number.isFinite(configured) && configured >= 0
      ? Math.floor(configured)
      : fallback;
    return Math.min(MAX_FOG_CLOUDS, this.maxFogClouds, Math.max(0, baseCount));
  }

  // ─── 晴天光束：位置与尺寸均保存在世界坐标。 ───
  _updateSunbeams(deltaTime, bounds) {
    this._sunbeamTimer -= deltaTime;
    if (this._sunbeamTimer <= 0) {
      this._sunbeamTimer = 4 + Math.random() * 6;
      const life = 2 + Math.random() * 1.5;
      const viewWidth = bounds.right - bounds.left;
      this._sunbeams.push({
        x: randomBetween(bounds.left - viewWidth * 0.1, bounds.right + viewWidth * 0.1),
        y: bounds.top - SUNBEAM_PADDING,
        width: 60 + Math.random() * 80,
        height: bounds.bottom - bounds.top + SUNBEAM_PADDING * 2,
        life,
        maxLife: life,
        speed: 30 + Math.random() * 20
      });
    }

    let writeIndex = 0;
    for (let readIndex = 0, len = this._sunbeams.length; readIndex < len; readIndex++) {
      const beam = this._sunbeams[readIndex];
      beam.x += beam.speed * deltaTime;
      beam.life -= deltaTime;
      if (beam.life > 0) {
        if (writeIndex !== readIndex) this._sunbeams[writeIndex] = beam;
        writeIndex++;
      }
    }
    this._sunbeams.length = writeIndex;
  }

  // ─── 风/雨粒子：只按天气速度修改世界坐标，不累加玩家或相机位移。 ───
  _updateParticles(deltaTime, def, weather, bounds, cameraDelta) {
    const target = this._getTargetCount(def, bounds, 50);
    while (this._particles.length < target) {
      this._particles.push(this._spawnParticle(weather, bounds));
    }

    const windX = Number(def.windX) || 0;
    const windY = Number(def.windY) || 0;
    const screenMotionX = windX * deltaTime - cameraDelta.x;
    const screenMotionY = windY * deltaTime - cameraDelta.y;
    const activeBounds = expandBounds(bounds, PARTICLE_CULL_PADDING);

    for (let i = this._particles.length - 1; i >= 0; i--) {
      const particle = this._particles[i];
      particle.x += windX * deltaTime;
      particle.y += windY * deltaTime;
      if (weather === 'breeze' || weather === 'wind') {
        particle.phase += deltaTime * particle.freq;
        particle.offsetY = Math.sin(particle.phase) * particle.amp;
      }
      if (particle.x < activeBounds.left || particle.x > activeBounds.right
        || particle.y < activeBounds.top || particle.y > activeBounds.bottom) {
        this._particles[i] = this._spawnParticle(weather, bounds, {
          motionX: screenMotionX,
          motionY: screenMotionY
        });
      }
    }
    while (this._particles.length > target) this._particles.pop();
  }

  _spawnParticle(weather, bounds, motion = null) {
    const spawnBounds = expandBounds(bounds, PARTICLE_SPAWN_PADDING);
    let x;
    let y;
    const motionX = Number(motion?.motionX) || 0;
    const motionY = Number(motion?.motionY) || 0;
    if (!motion || (Math.abs(motionX) < 0.001 && Math.abs(motionY) < 0.001)) {
      x = randomBetween(spawnBounds.left, spawnBounds.right);
      y = randomBetween(spawnBounds.top, spawnBounds.bottom);
    } else if (Math.abs(motionX) >= Math.abs(motionY)) {
      x = motionX >= 0 ? spawnBounds.left : spawnBounds.right;
      y = randomBetween(spawnBounds.top, spawnBounds.bottom);
    } else {
      x = randomBetween(spawnBounds.left, spawnBounds.right);
      y = motionY >= 0 ? spawnBounds.top : spawnBounds.bottom;
    }
    return {
      x,
      y,
      phase: Math.random() * Math.PI * 2,
      freq: 2 + Math.random() * 3,
      amp: weather === 'wind' ? (8 + Math.random() * 6) : (3 + Math.random() * 3),
      offsetY: 0,
      lengthJitter: Math.random(),
      hasCurl: Math.random() < 0.3
    };
  }

  /**
   * 雾团严格锚定在当前中心九宫格中已经提交的 physical chunk 内。
   * coverage 不变时只按天气速度漂移；越界后仅在当前 coverage 的合法 rect 中重生。
   */
  _updateFogClouds(deltaTime, def, weather, coverage) {
    if (!coverage?.rects?.length || this._fogImages.length === 0) {
      this._fogClouds.length = 0;
      return;
    }

    const target = this._getFogTargetCount(def);
    let writeIndex = 0;
    for (let readIndex = 0, length = this._fogClouds.length; readIndex < length; readIndex++) {
      let cloud = this._fogClouds[readIndex];
      let rect = coverage.byKey.get(cloud?.coverageKey);
      if (!fogCloudFitsRect(cloud, rect)) {
        cloud = this._spawnFogCloud(weather, coverage);
      } else {
        cloud.x += cloud.speedX * deltaTime;
        cloud.y += cloud.speedY * deltaTime;
        cloud.phase += deltaTime * 0.5;
        if (!fogCloudFitsRect(cloud, rect)) cloud = this._spawnFogCloud(weather, coverage);
      }
      if (!cloud) continue;
      this._fogClouds[writeIndex++] = cloud;
    }
    this._fogClouds.length = Math.min(writeIndex, target);

    while (this._fogClouds.length < target) {
      const cloud = this._spawnFogCloud(weather, coverage);
      if (!cloud) break;
      this._fogClouds.push(cloud);
    }
  }

  _spawnFogCloud(weather, coverage) {
    if (!coverage?.rects?.length || this._fogImages.length === 0) return null;
    const rect = coverage.rects[Math.floor(Math.random() * coverage.rects.length)];
    const isHeavy = weather === 'heavyFog';
    const availableWidth = rect.right - rect.left;
    const availableHeight = rect.bottom - rect.top;
    const desiredWidth = (isHeavy ? 330 : 230) + Math.random() * (isHeavy ? 150 : 120);
    const desiredHeight = (isHeavy ? 124 : 86) + Math.random() * (isHeavy ? 56 : 46);
    const width = Math.max(1, Math.min(desiredWidth, availableWidth));
    const height = Math.max(1, Math.min(desiredHeight, availableHeight));
    const x = randomBetween(rect.left, rect.right - width);
    const yMin = rect.top + Math.max(0, (availableHeight - height) * (isHeavy ? 0.36 : 0.08));
    const y = randomBetween(yMin, rect.bottom - height);

    return {
      coverageKey: rect.key,
      x,
      y,
      width,
      height,
      opacity: isHeavy ? (0.26 + Math.random() * 0.18) : (0.13 + Math.random() * 0.12),
      speedX: 5 + Math.random() * 10,
      speedY: (Math.random() - 0.5) * 2.5,
      phase: Math.random() * Math.PI * 2,
      imageIndex: Math.floor(Math.random() * this._fogImages.length),
      flipX: Math.random() < 0.5
    };
  }

  // ─── 渲染：空间天气统一按世界坐标绘制；全屏闪电仍是无位置的屏幕照明。 ───
  render(ctx, width, height, runtime = {}) {
    const logicalWidth = Math.max(1, Number(width) || BASE_VIEWPORT_WIDTH);
    const logicalHeight = Math.max(1, Number(height) || BASE_VIEWPORT_HEIGHT);
    const viewBounds = resolveViewBounds(runtime, logicalWidth, logicalHeight, this._viewBounds);
    const fogCoverage = normalizeFogCoverage(runtime?.loadedCoverage);
    const weather = this.getVisualWeather();
    const alpha = Math.max(0, Math.min(1, this.transitionProgress));
    let rendered = false;

    ctx.save();
    ctx.translate(-viewBounds.left, -viewBounds.top);

    if (weather === 'clear' && this._sunbeams.length > 0) {
      ctx.save();
      for (const beam of this._sunbeams) {
        const lifeRatio = Math.max(0, Math.min(1, beam.life / beam.maxLife));
        const beamAlpha = Math.sin(lifeRatio * Math.PI) * 0.15 * alpha;
        const bottom = beam.y + beam.height;
        const gradient = ctx.createLinearGradient(beam.x, beam.y, beam.x + beam.width, bottom);
        gradient.addColorStop(0, `rgba(255,240,180,${beamAlpha})`);
        gradient.addColorStop(0.5, `rgba(255,255,200,${beamAlpha * 0.6})`);
        gradient.addColorStop(1, 'rgba(255,240,180,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(beam.x, beam.y);
        ctx.lineTo(beam.x + beam.width * 0.3, beam.y);
        ctx.lineTo(beam.x + beam.width, bottom);
        ctx.lineTo(beam.x + beam.width * 0.7, bottom);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      rendered = true;
    }

    if ((weather === 'lightFog' || weather === 'heavyFog')
      && this._fogClouds.length > 0
      && fogCoverage.rects.length > 0
      && this._fogImages.length > 0) {
      ctx.save();
      ctx.beginPath();
      for (const rect of fogCoverage.rects) {
        ctx.rect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
      }
      ctx.clip();
      for (const cloud of this._fogClouds) {
        const rect = fogCoverage.byKey.get(cloud.coverageKey);
        const image = this._fogImages[cloud.imageIndex];
        if (!isDrawableImage(image) || !fogCloudFitsRect(cloud, rect)) continue;
        const cloudAlpha = alpha * cloud.opacity * (0.88 + Math.sin(cloud.phase) * 0.12);
        if (cloudAlpha <= 0) continue;
        ctx.save();
        ctx.globalAlpha = cloudAlpha;
        if (cloud.flipX) {
          ctx.translate(cloud.x + cloud.width, cloud.y);
          ctx.scale(-1, 1);
          ctx.drawImage(image, 0, 0, cloud.width, cloud.height);
        } else {
          ctx.drawImage(image, cloud.x, cloud.y, cloud.width, cloud.height);
        }
        ctx.restore();
        rendered = true;
      }
      ctx.restore();
    }

    if ((weather === 'breeze' || weather === 'wind') && this._particles.length > 0) {
      ctx.save();
      ctx.globalAlpha = alpha;
      const isStrong = weather === 'wind';
      ctx.strokeStyle = isStrong ? 'rgba(180,180,180,0.5)' : 'rgba(200,200,200,0.3)';
      ctx.lineWidth = isStrong ? 1.5 : 1;
      for (const particle of this._particles) {
        const length = isStrong
          ? 50 + particle.lengthJitter * 20
          : 30 + particle.lengthJitter * 10;
        const baseY = particle.y + particle.offsetY;
        ctx.beginPath();
        ctx.moveTo(particle.x, baseY);
        const controlX = particle.x + length * 0.5;
        const controlY = baseY + (isStrong ? 12 : 6) * Math.sin(particle.phase);
        ctx.quadraticCurveTo(controlX, controlY, particle.x + length, baseY + (isStrong ? 4 : 2));
        ctx.stroke();
        if (!isStrong && particle.hasCurl) {
          ctx.beginPath();
          ctx.arc(particle.x + length, baseY + 2, 3, 0, Math.PI * 1.5);
          ctx.stroke();
        }
        if (isStrong) {
          ctx.globalAlpha = alpha * 0.3;
          ctx.beginPath();
          ctx.moveTo(particle.x + length * 0.3, baseY + 3);
          ctx.lineTo(particle.x + length * 0.6, baseY - 2);
          ctx.stroke();
          ctx.globalAlpha = alpha;
        }
      }
      ctx.restore();
      rendered = true;
    }

    if ((weather === 'lightRain' || weather === 'heavyRain' || weather === 'storm')
      && this._particles.length > 0) {
      const def = this.weatherDefs[weather];
      const isLight = weather === 'lightRain';
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = isLight ? 'rgba(170,190,255,0.4)' : 'rgba(120,150,255,0.6)';
      ctx.lineWidth = isLight ? 0.8 : 1.8;
      const angle = Math.atan2(Number(def.windY) || 1, Number(def.windX) || 0);
      const cosAngle = Math.cos(angle);
      const sinAngle = Math.sin(angle);
      const length = isLight ? 8 : 16;
      for (const particle of this._particles) {
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(particle.x + cosAngle * length, particle.y + sinAngle * length);
        ctx.stroke();
      }
      ctx.restore();
      rendered = true;
    }

    ctx.restore();

    if (this._lightningFlash > 0) {
      ctx.save();
      ctx.globalAlpha = this._lightningFlash;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, logicalWidth, logicalHeight);
      ctx.restore();
      rendered = true;
    }
    return rendered;
  }
}

export default WeatherSystem;
