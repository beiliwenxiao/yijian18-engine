/************************************************************
 * 场景火堆、时间氛围、天气粒子、深度绘制与碰撞服务。
 * 只消费调用方传入的世界坐标，不读取或应用 worldOffset。
 ************************************************************/

import { InputHints } from '../input/InputHints.js';
import { cloneCanonicalValue, deepFreeze } from '../CanonicalSnapshot.js';

function requirePositive(value, path) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new TypeError(`${path} must be a positive number`);
  return number;
}

function createFuelConfiguration(config = {}) {
  const enabled = config?.enabled === true;
  if (!enabled) {
    return {
      enabled: false, itemId: null, secondsPerUnit: 0, initialUnits: 0, maxUnits: 0,
      startOnIgnite: false
    };
  }
  if (typeof config.itemId !== 'string' || !config.itemId.trim()) {
    throw new TypeError('campfire.fuel.itemId must be a non-empty string');
  }
  const secondsPerUnit = requirePositive(config.secondsPerUnit, 'campfire.fuel.secondsPerUnit');
  const maxUnits = Math.max(1, Math.floor(requirePositive(config.maxUnits, 'campfire.fuel.maxUnits')));
  const initialUnits = Math.min(maxUnits, Math.max(0, Math.floor(Number(config.initialUnits) || 0)));
  return {
    enabled: true,
    itemId: config.itemId,
    secondsPerUnit,
    initialUnits,
    maxUnits,
    startOnIgnite: config.startOnIgnite === true
  };
}

function normalizeVisualLayer(layer = {}, path) {
  const imageId = typeof layer.imageId === 'string' ? layer.imageId.trim() : '';
  if (!imageId) throw new TypeError(`${path}.imageId must be a non-empty string`);
  const pivot = layer.pivot || {};
  const pivotX = Number.isFinite(Number(pivot.x)) ? Number(pivot.x) : 0.5;
  const pivotY = Number.isFinite(Number(pivot.y)) ? Number(pivot.y) : 1;
  if (pivotX < 0 || pivotX > 1 || pivotY < 0 || pivotY > 1) {
    throw new RangeError(`${path}.pivot must be between 0 and 1`);
  }
  return Object.freeze({
    imageId,
    width: requirePositive(layer.width, `${path}.width`),
    height: requirePositive(layer.height, `${path}.height`),
    pivot: Object.freeze({ x: pivotX, y: pivotY }),
    offsetX: Number.isFinite(Number(layer.offsetX)) ? Number(layer.offsetX) : 0,
    offsetY: Number.isFinite(Number(layer.offsetY)) ? Number(layer.offsetY) : 0
  });
}

function normalizeVisualLayers(source = {}) {
  return deepFreeze({
    base: normalizeVisualLayer(source.base, 'campfire.base'),
    logs: normalizeVisualLayer(source.logs, 'campfire.logs'),
    stoneRing: normalizeVisualLayer(source.stoneRing, 'campfire.stoneRing'),
    flame: normalizeVisualLayer(source.flame, 'campfire.flame')
  });
}

function drawVisualLayer(ctx, layer, image, x, y) {
  if (!layer || !image) return false;
  ctx.drawImage(
    image,
    x - layer.width * layer.pivot.x + layer.offsetX,
    y - layer.height * layer.pivot.y + layer.offsetY,
    layer.width,
    layer.height
  );
  return true;
}

const campfireFeatureMethods = {
  _stopEmberParticles() {
    for (const emitter of this.campfire.emberEmitters || []) emitter.active = false;
    this.campfire.emberEmitters = [];
  },

  _startEmberParticles() {
    campfireFeatureMethods._stopEmberParticles.call(this);
    if (!this.particleSystem || this.campfire.lit || !this.campfire.hasBeenIgnited) return false;
    const offsets = this.embers.offsets.length > 0 ? this.embers.offsets : [[0, 0, 0]];
    const rate = Math.max(0.15, this.embers.frequency / offsets.length);
    const interval = 1 / rate;
    this.campfire.emberEmitters = offsets.map(([offsetX, offsetY, phase], index) => {
      const emitter = this.particleSystem.createEmitter({
        position: {
          x: this.campfire.x + this.embers.offsetX + offsetX,
          y: this.campfire.y + this.embers.offsetY + offsetY
        },
        rate,
        duration: Infinity,
        particleConfig: {
          position: { x: this.campfire.x, y: this.campfire.y },
          velocity: { x: 0, y: -4 - phase * 1.5 },
          life: Math.max(320, 360 + this.embers.radius * 80),
          size: this.embers.radius * (0.75 + (index % 3) * 0.18),
          color: this.embers.color,
          alpha: Math.min(1, this.embers.maxAlpha * 1.15),
          blendMode: 'lighter',
          gravity: 0,
          friction: 0.96,
          isFire: true,
          renderLayer: 'worldDepth',
          sortY: this.campfire.y
        }
      });
      // 首个余烬下一帧立即闪现，其余按相位错开，形成间歇闪烁而非连续火焰。
      emitter.accumulator = index === 0 ? interval : interval * index / offsets.length;
      return emitter;
    });
    return true;
  },

  _restoreCampfireState(lit) {
    if (lit) {
      if (!this.campfire.lit) this.lightCampfire({ emitEvent: false });
      return;
    }
    for (const emitter of this.campfire.emitters || []) emitter.active = false;
    this.campfire.emitters = [];
    if (this.campfire.emitterSmoke) this.campfire.emitterSmoke.active = false;
    this.campfire.emitterSmoke = null;
    this.campfire.lit = false;
    campfireFeatureMethods._startEmberParticles.call(this);
  },

  /** 点燃火堆，并按配置创建可选火焰粒子发射器。 */
  lightCampfire({ emitEvent = true } = {}) {
    if (this.campfire.lit) return;
    const relighting = this.campfire.hasBeenIgnited === true;
    campfireFeatureMethods._stopEmberParticles.call(this);
    this.campfire.lit = true;
    this.campfire.hasBeenIgnited = true;
    this.campfire.emitters = [];

    const fireBaseY = this.campfire.y - 15;
    const firePoint = { x: this.campfire.x, y: fireBaseY };
    const mk = (rate, vy, life, size, color, alpha) => this.campfire.emitters.push(
      this.particleSystem.createEmitter({
        position: { x: firePoint.x, y: firePoint.y },
        rate,
        duration: Infinity,
        particleConfig: {
          position: { x: firePoint.x, y: firePoint.y },
          velocity: { x: 0, y: vy },
          life, size, color, alpha,
          gravity: 0, friction: 0.95
        }
      })
    );
    for (const preset of this.particlePresets) {
      mk(preset.rate, preset.vy, preset.life, preset.size, preset.color, preset.alpha);
    }

    this.logger?.debug?.('SceneCampfireService: campfire particle emitters created');
    if (this.fuel.enabled === true && this.fuel.remainingSeconds > 0
      && (this.fuel.startOnIgnite === true || relighting)) {
      this.fuel.active = true;
    }
    if (emitEvent) this.onIgnited?.();
  },

  updateCampfireAnimation(deltaTime) {
    if (this.campfire.lit && this.campfire.imageLoaded) {
      this.campfire.frameTime += deltaTime;
      if (this.campfire.frameTime >= this.campfire.frameDuration) {
        this.campfire.frameTime = 0;
        this.campfire.currentFrame = (this.campfire.currentFrame + 1) % this.campfire.frameCount;
      }
    }
    if (!this.campfire.lit) {
      if (this.campfire.hasBeenIgnited && this.campfire.emberEmitters.length === 0) {
        campfireFeatureMethods._startEmberParticles.call(this);
      }
      this.campfire.emberEmitters.forEach((emitter, index) => {
        const [offsetX, offsetY] = this.embers.offsets[index] || [0, 0];
        emitter.position.x = this.campfire.x + this.embers.offsetX + offsetX;
        emitter.position.y = this.campfire.y + this.embers.offsetY + offsetY;
        emitter.particleConfig.sortY = this.campfire.y;
        this.particleSystem.updateEmitter(emitter, deltaTime);
      });
      return;
    }
    const time = this.now() / 1000;
    this.campfire.emitters.forEach((emitter, index) => {
      if (!emitter) return;
      const swayAmount = index < 2
        ? (this.random() - 0.5) * 10
        : Math.sin(time * 2 + index * 0.5) * 4 + (this.random() - 0.5) * 2;
      emitter.position.x = this.campfire.x + swayAmount;
      emitter.position.y = this.campfire.y - 13;
      emitter.particleConfig.velocity.x = (this.random() - 0.5) * 10;
      this.particleSystem.updateEmitter(emitter, deltaTime);
    });
  },
  /** TimeSystem 黑暗/色调 → 玩家与火堆透光 → WeatherSystem 粒子的固定表现顺序。 */
  renderAtmosphere(ctx) {
    const width = this.logicalWidth;
    const height = this.logicalHeight;
    const campfireConfigured = this.isConfigured();
    const hasTimeOverlay = this.timeSystem?.hasAtmosphereOverlay?.() === true;
    const viewBounds = this.viewBounds || this.camera?.getViewBounds?.() || { left: 0, top: 0 };

    if (hasTimeOverlay) {
      // 时间层必须在独立 atmosphere Canvas 合成后统一挖出玩家/火堆透光区；
      // 若先画到主 Canvas，再 destination-out 会连世界内容一起擦除。
      const renderScale = 0.5;
      const atmosphereWidth = Math.max(1, Math.ceil(width * renderScale));
      const atmosphereHeight = Math.max(1, Math.ceil(height * renderScale));
      if (!this._atmosphereCanvas) {
        this._atmosphereCanvas = this.createCanvas();
        this._atmosphereContext = this._atmosphereCanvas.getContext('2d');
      }
      if (this._atmosphereCanvas.width !== atmosphereWidth
        || this._atmosphereCanvas.height !== atmosphereHeight) {
        this._atmosphereCanvas.width = atmosphereWidth;
        this._atmosphereCanvas.height = atmosphereHeight;
      }
      const atmosphereCtx = this._atmosphereContext
        || (this._atmosphereContext = this._atmosphereCanvas.getContext('2d'));
      atmosphereCtx.setTransform?.(1, 0, 0, 1, 0, 0);
      atmosphereCtx.globalAlpha = 1;
      atmosphereCtx.globalCompositeOperation = 'copy';
      atmosphereCtx.fillStyle = 'rgba(0, 0, 0, 0)';
      atmosphereCtx.fillRect(0, 0, atmosphereWidth, atmosphereHeight);
      atmosphereCtx.globalCompositeOperation = 'source-over';
      this.timeSystem.render(atmosphereCtx, atmosphereWidth, atmosphereHeight);

      atmosphereCtx.globalCompositeOperation = 'destination-out';
      const yScale = 0.6;
      const playerTransform = this.playerEntity?.getComponent?.('transform');
      if (playerTransform) {
        const playerScreenX = (playerTransform.position.x - viewBounds.left) * renderScale;
        const playerScreenY = (playerTransform.position.y - viewBounds.top) * renderScale;
        const respawnRadius = campfireConfigured && this.campfire.respawnCountdownSeconds
          ? Math.max(0, Number(this.campfire.respawnApproachRadius) || 0)
          : 0;
        const playerLightRadius = Math.max(150, respawnRadius) * renderScale;
        const playerMask = this._getAtmosphereMask('player', playerLightRadius, yScale);
        atmosphereCtx.drawImage(
          playerMask,
          playerScreenX - playerMask.width / 2,
          playerScreenY - playerMask.height / 2
        );
      }

      const showCampfireOpening = campfireConfigured
        && (this.campfire.lit || this.campfire.respawnCountdownSeconds !== null);
      if (showCampfireOpening) {
        const campScreenX = (this.campfire.x - viewBounds.left) * renderScale;
        const campScreenY = (this.campfire.y - viewBounds.top) * renderScale;
        const campLightRadius = Math.max(
          Number(this.presentation.lightRadius) || 0,
          Number(this.campfire.respawnApproachRadius) || 0,
          1
        ) * renderScale;
        const campMask = this._getAtmosphereMask('campfire', campLightRadius, yScale);
        atmosphereCtx.drawImage(
          campMask,
          campScreenX - campMask.width / 2,
          campScreenY - campMask.height / 2
        );
      }

      atmosphereCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(
        this._atmosphereCanvas,
        0, 0, atmosphereWidth, atmosphereHeight,
        0, 0, width, height
      );
    }

    // 火堆点燃时在透光洞上叠加柔和光晕，使周围一圈仍有暖色层次。
    if (campfireConfigured && this.campfire.lit) {
      const campX = this.campfire.x - viewBounds.left;
      const campY = this.campfire.y - viewBounds.top;
      const campRadius = Math.max(1, this.presentation.lightRadius * 0.7);
      const light = ctx.createRadialGradient(campX, campY, 0, campX, campY, campRadius);
      light.addColorStop(0, 'rgba(255, 200, 100, 0.30)');
      light.addColorStop(0.5, 'rgba(255, 150, 50, 0.15)');
      light.addColorStop(1, 'rgba(255, 80, 0, 0)');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = light;
      ctx.beginPath();
      ctx.arc(campX, campY, campRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    this.weatherSystem?.render?.(ctx, width, height, {
      viewBounds,
      loadedCoverage: this.loadedCoverage
    });
  },

  renderCampfireBottom(ctx) {
    const x = this.campfire.x;
    const y = this.campfire.y;
    if (this.visualLayers?.base) {
      drawVisualLayer(ctx, this.visualLayers.stoneRing, this.layerImages.stoneRing, x, y);
      drawVisualLayer(ctx, this.visualLayers.base, this.layerImages.base, x, y);
      drawVisualLayer(ctx, this.visualLayers.logs, this.layerImages.logs, x, y);
      if (this.campfire.lit) {
        const flame = this.visualLayers.flame;
        const glowY = y - flame.height * 0.42 + flame.offsetY;
        const radius = this.presentation.lightRadius * 0.22;
        const glow = ctx.createRadialGradient(x, glowY, 0, x, glowY, radius);
        glow.addColorStop(0, 'rgba(255, 200, 0, 0.38)');
        glow.addColorStop(0.5, 'rgba(255, 100, 0, 0.18)');
        glow.addColorStop(1, 'rgba(255, 50, 0, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, glowY, radius, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const time = this.now() / 1000;
        const ember = this.embers;
        ctx.save();
        for (const [offsetX, offsetY, phase] of ember.offsets) {
          const alpha = ember.minAlpha + (ember.maxAlpha - ember.minAlpha)
            * Math.max(0, Math.sin(time * (ember.frequency + phase) + phase));
          const radius = ember.radius * (0.6 + 0.4 * Math.max(0, Math.sin(time * 3 + phase)));
          ctx.globalAlpha = alpha;
          ctx.fillStyle = ember.color;
          ctx.beginPath();
          ctx.arc(x + ember.offsetX + offsetX, y + ember.offsetY + offsetY, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      return;
    }
    const drawStoneRing = () => {
      const stoneCount = 12;
      ctx.save();
      for (let index = 0; index < stoneCount; index++) {
        const angle = (Math.PI * 2 * index) / stoneCount;
        const stoneX = x + Math.cos(angle) * 38;
        const stoneY = y - 6 + Math.sin(angle) * 13;
        const radiusX = 5 + (index % 3) * 0.8;
        const radiusY = 3.5 + (index % 2) * 0.6;
        ctx.fillStyle = index % 2 === 0 ? '#756b5a' : '#665d50';
        ctx.beginPath();
        ctx.ellipse(stoneX, stoneY, radiusX, radiusY, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(42, 35, 29, 0.72)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = 'rgba(198, 187, 161, 0.42)';
        ctx.beginPath();
        ctx.ellipse(stoneX - 1.2, stoneY - 0.9, Math.max(1.2, radiusX * 0.42), 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };
    drawStoneRing();
    if (!this.campfire.lit) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - 30, y - 15, 60, 15);
      ctx.clip();
      ctx.strokeStyle = '#5a4a3a';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - 20, y - 5); ctx.lineTo(x + 20, y - 25); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 20, y - 5); ctx.lineTo(x - 20, y - 25); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 18, y - 15); ctx.lineTo(x + 18, y - 15); ctx.stroke();
      ctx.strokeStyle = '#4a3a2a';
      ctx.beginPath(); ctx.moveTo(x - 15, y - 7); ctx.lineTo(x - 5, y - 27); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 15, y - 7); ctx.lineTo(x + 5, y - 27); ctx.stroke();
      ctx.restore();
      const time = this.now() / 1000;
      const blinkAlpha = 0.7 + 0.3 * Math.abs(Math.sin(time * 2.5));
      const dotRadius = 4 + Math.sin(time * 3);
      ctx.save();
      ctx.globalAlpha = blinkAlpha;
      const outerGlow = ctx.createRadialGradient(x, y - 15, 0, x, y - 15, dotRadius + 6);
      outerGlow.addColorStop(0, 'rgba(255, 100, 50, 0.8)');
      outerGlow.addColorStop(0.5, 'rgba(255, 50, 20, 0.4)');
      outerGlow.addColorStop(1, 'rgba(255, 0, 0, 0)');
      ctx.fillStyle = outerGlow;
      ctx.beginPath(); ctx.arc(x, y - 15, dotRadius + 6, 0, Math.PI * 2); ctx.fill();
      const dotGradient = ctx.createRadialGradient(x, y - 15, 0, x, y - 15, dotRadius);
      dotGradient.addColorStop(0, 'rgba(255, 255, 200, 1)');
      dotGradient.addColorStop(0.4, 'rgba(255, 120, 60, 1)');
      dotGradient.addColorStop(1, 'rgba(255, 50, 20, 0)');
      ctx.fillStyle = dotGradient;
      ctx.beginPath(); ctx.arc(x, y - 15, dotRadius, 0, Math.PI * 2); ctx.fill();
      const emberOffsets = [[-13, -8, 0.8], [8, -16, 1.1], [15, -6, 1.5], [-4, -23, 1.9]];
      for (const [offsetX, offsetY, phase] of emberOffsets) {
        const sparkAlpha = 0.2 + 0.65 * Math.max(0, Math.sin(time * (2.1 + phase) + phase));
        const sparkRadius = 1 + 0.8 * Math.max(0, Math.sin(time * 3.2 + phase));
        ctx.globalAlpha = sparkAlpha;
        ctx.fillStyle = '#ffb04a';
        ctx.beginPath();
        ctx.arc(x + offsetX, y - 15 + offsetY, sparkRadius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 30, y - 15, 60, 15);
    ctx.clip();
    ctx.strokeStyle = '#3a2a1a';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - 20, y - 5); ctx.lineTo(x + 20, y - 25); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 20, y - 5); ctx.lineTo(x - 20, y - 25); ctx.stroke();
    ctx.restore();

    const gradient = ctx.createRadialGradient(x, y - 15, 0, x, y - 15, 60);
    gradient.addColorStop(0, 'rgba(255, 200, 0, 0.4)');
    gradient.addColorStop(0.5, 'rgba(255, 100, 0, 0.2)');
    gradient.addColorStop(1, 'rgba(255, 50, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath(); ctx.arc(x, y - 15, 60, 0, Math.PI * 2); ctx.fill();

    const centerGlow = ctx.createRadialGradient(x, y - 15, 0, x, y - 15, 20);
    centerGlow.addColorStop(0, 'rgba(255, 255, 200, 0.6)');
    centerGlow.addColorStop(0.5, 'rgba(255, 150, 0, 0.3)');
    centerGlow.addColorStop(1, 'rgba(255, 100, 0, 0)');
    ctx.fillStyle = centerGlow;
    ctx.beginPath(); ctx.arc(x, y - 15, 20, 0, Math.PI * 2); ctx.fill();
  },
  renderCampfireTop(ctx) {
    const x = this.campfire.x;
    const y = this.campfire.y;
    if (this.visualLayers?.flame) {
      if (!this.campfire.lit) {
        if (!this.campfire.hasBeenIgnited) {
          ctx.save();
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 14px Arial';
          ctx.textAlign = 'center';
          ctx.shadowColor = '#000000';
          ctx.shadowBlur = 4;
          ctx.fillText(this.labels.unlit, x, y - 55);
          ctx.fillText(this.formatHint(this.labels.ignite), x, y - 40);
          ctx.restore();
        } else {
          // 已点燃过但熄灭：提示玩家添柴重燃
          ctx.save();
          ctx.fillStyle = '#ffd9a0';
          ctx.font = '12px Arial';
          ctx.textAlign = 'center';
          ctx.shadowColor = '#000000';
          ctx.shadowBlur = 4;
          ctx.fillText(this.formatHint('{interact}添柴重燃'), x, y - 40);
          ctx.restore();
        }
        return;
      }
      const flame = this.visualLayers.flame;
      if (this.campfire.imageLoaded && this.campfire.fireImage) {
        const col = this.campfire.currentFrame % this.campfire.frameCols;
        const row = Math.floor(this.campfire.currentFrame / this.campfire.frameCols);
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.drawImage(
          this.campfire.fireImage,
          col * this.campfire.frameWidth, row * this.campfire.frameHeight,
          this.campfire.frameWidth, this.campfire.frameHeight,
          x - flame.width * flame.pivot.x + flame.offsetX,
          y - flame.height * flame.pivot.y + flame.offsetY,
          flame.width, flame.height
        );
        ctx.restore();
      }
      campfireFeatureMethods.renderFuelStatus.call(this, ctx);
      return;
    }
    if (!this.campfire.lit) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - 30, y - 45, 60, 30);
      ctx.clip();
      ctx.strokeStyle = '#5a4a3a';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - 20, y - 5); ctx.lineTo(x + 20, y - 25); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 20, y - 5); ctx.lineTo(x - 20, y - 25); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 18, y - 15); ctx.lineTo(x + 18, y - 15); ctx.stroke();
      ctx.strokeStyle = '#4a3a2a';
      ctx.beginPath(); ctx.moveTo(x - 15, y - 7); ctx.lineTo(x - 5, y - 27); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 15, y - 7); ctx.lineTo(x + 5, y - 27); ctx.stroke();
      ctx.restore();

      if (!this.campfire.hasBeenIgnited) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 4;
        ctx.fillText(this.labels.unlit, x, y - 55);
        ctx.fillText(this.formatHint(this.labels.ignite), x, y - 40);
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = '#ffd9a0';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 4;
        ctx.fillText(this.formatHint('{interact}添柴重燃'), x, y - 40);
        ctx.shadowBlur = 0;
      }
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 30, y - 45, 60, 30);
    ctx.clip();
    ctx.strokeStyle = '#3a2a1a';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - 20, y - 5); ctx.lineTo(x + 20, y - 25); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 20, y - 5); ctx.lineTo(x - 20, y - 25); ctx.stroke();
    ctx.restore();

    if (this.campfire.imageLoaded && this.campfire.fireImage) {
      const col = this.campfire.currentFrame % this.campfire.frameCols;
      const row = Math.floor(this.campfire.currentFrame / this.campfire.frameCols);
      const frameX = col * this.campfire.frameWidth;
      const frameY = row * this.campfire.frameHeight;
      const fireWidth = this.presentation.fireWidth;
      const fireHeight = this.presentation.fireHeight;
      const fireX = x - fireWidth / 2;
      const fireY = y - fireHeight - 5;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(
        this.campfire.fireImage,
        frameX, frameY, this.campfire.frameWidth, this.campfire.frameHeight,
        fireX, fireY, fireWidth, fireHeight
      );
      ctx.globalAlpha = 1.0;
    }
    campfireFeatureMethods.renderFuelStatus.call(this, ctx);
  },

  renderFuelStatus(ctx) {
    if (this.fuel.enabled !== true || this.fuel.active !== true) return;
    const fuel = this.getFuelSnapshot();
    const seconds = Math.ceil(fuel.remainingSeconds);
    const x = this.campfire.x;
    const y = this.campfire.y - this.presentation.fireHeight - 20;
    ctx.save();
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const lines = [`燃烧 ${seconds} 秒`, `木材 ${fuel.units}/${fuel.maxUnits}`];
    const width = Math.max(...lines.map(line => ctx.measureText(line).width)) + 12;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.68)';
    ctx.fillRect(x - width / 2, y - 31, width, 34);
    ctx.fillStyle = '#ffe4a3';
    ctx.fillText(lines[0], x, y - 16);
    ctx.fillStyle = '#d7f0b1';
    ctx.fillText(lines[1], x, y - 2);
    ctx.restore();
  },

  renderRespawnCountdown(ctx) {
    const seconds = this.campfire.respawnCountdownSeconds;
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const x = this.campfire.x;
    const y = this.campfire.y;
    const radius = Math.max(0, Number(this.campfire.respawnApproachRadius) || 0);
    const radiusY = radius * 0.6;
    const duration = Math.max(1, Number(this.campfire.respawnDurationSeconds) || seconds);
    const remaining = Math.max(0, Math.min(
      duration,
      Number(this.campfire.respawnRemainingSeconds) || seconds
    ));
    const progress = Math.max(0, Math.min(1, 1 - remaining / duration));

    ctx.save();
    if (radius > 0) {
      ctx.fillStyle = 'rgba(92, 154, 255, 0.08)';
      ctx.beginPath();
      ctx.ellipse(x, y, radius, radiusY, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(143, 199, 255, 0.72)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.ellipse(x, y, radius, radiusY, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.strokeStyle = '#d9efff';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.ellipse(x, y, radius, radiusY, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.stroke();
    }

    const labelY = radiusY > 0 ? y - radiusY - 10 : y - 78;
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const label = `复活倒计时 ${seconds} 秒`;
    const width = ctx.measureText(label).width + 14;
    ctx.fillStyle = 'rgba(8, 10, 24, 0.82)';
    ctx.fillRect(x - width / 2, labelY - 20, width, 24);
    ctx.strokeStyle = 'rgba(126, 180, 255, 0.65)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - width / 2, labelY - 20, width, 24);
    ctx.fillStyle = '#bfe0ff';
    ctx.fillText(label, x, labelY);
    ctx.restore();
  },

  checkCampfireCollision() {
    if (this.flightSystem?.isPlayerFlying?.()) return;
    // 跳跃（滞空）期间不检查火堆碰撞，允许跳过火堆。
    if (this.jumpSystem?.isJumping?.(this.playerEntity)) return;
    const transform = this.playerEntity?.getComponent?.('transform');
    if (!transform) return;

    const playerX = transform.position.x;
    const playerY = transform.position.y;
    const playerRadius = 20;
    const collisionWidth = this.presentation.collisionWidth;
    const collisionHeight = this.presentation.collisionHeight;
    const campfireLeft = this.campfire.x - collisionWidth / 2;
    const campfireRight = this.campfire.x + collisionWidth / 2;
    const campfireTop = this.campfire.y - 15;
    const campfireBottom = campfireTop + collisionHeight;
    const playerLeft = playerX - playerRadius;
    const playerRight = playerX + playerRadius;
    const playerTop = playerY - playerRadius;
    const playerBottom = playerY + playerRadius;

    if (playerRight <= campfireLeft || playerLeft >= campfireRight
      || playerBottom <= campfireTop || playerTop >= campfireBottom) return;
    const dx = playerX - this.campfire.x;
    const dy = playerY - this.campfire.y;
    const overlapX = dx > 0 ? campfireRight - playerLeft : campfireLeft - playerRight;
    const overlapY = dy > 0 ? campfireBottom - playerTop : campfireTop - playerBottom;
    if (Math.abs(overlapX) < Math.abs(overlapY)) transform.position.x += overlapX;
    else transform.position.y += overlapY;
  }
};

export class SceneCampfireService {
  constructor(config = {}) {
    this.campfire = {
      x: Number(config.position?.x) || 0,
      y: Number(config.position?.y) || 0,
      lit: false,
      hasBeenIgnited: false,
      emitters: [],
      emberEmitters: [],
      emitterSmoke: null,
      fireImage: null,
      imageLoaded: false,
      frameWidth: 1,
      frameHeight: 1,
      frameCols: 1,
      frameRows: 1,
      frameCount: 1,
      currentFrame: 0,
      frameTime: 0,
      frameDuration: 1,
      respawnCountdownSeconds: null,
      respawnDurationSeconds: 20,
      respawnApproachRadius: 0,
      respawnRemainingSeconds: null
    };
    this.fuel = {
      enabled: false, itemId: null, secondsPerUnit: 0, initialUnits: 0, maxUnits: 0,
      startOnIgnite: false, remainingSeconds: 0, active: false
    };
    this.particlePresets = Object.freeze([]);
    this.labels = Object.freeze({});
    this.presentation = Object.freeze({ lightRadius: 1, fireWidth: 1, fireHeight: 1, collisionWidth: 1, collisionHeight: 1 });
    this.visualLayers = Object.freeze({});
    this.layerImages = Object.create(null);
    this.embers = Object.freeze({ color: '#ffb04a', radius: 1, frequency: 1, minAlpha: 0, maxAlpha: 1, offsetX: 0, offsetY: 0, offsets: [] });
    this.configView = null;
    this.loadedCoverage = null;
    this.formatHint = config.formatHint || (text => InputHints.format(text));
    this.createCanvas = config.createCanvas || (() => {
      if (typeof document !== 'undefined') return document.createElement('canvas');
      if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(1, 1);
      throw new Error('SceneCampfireService requires createCanvas outside browser hosts');
    });
    this.now = config.now || (() => performance.now());
    this.random = config.random || Math.random;
    this.onIgnited = config.onIgnited || null;
    this.onExtinguished = config.onExtinguished || null;
    this.logger = config.logger || console;
    this._atmosphereCanvas = null;
    this._atmosphereContext = null;
    this._atmosphereMasks = new Map();
    this._renderContext = null;
    this._campfireRenderItems = [
      {
        type: 'campfire_bottom', y: this.campfire.y, sortPriority: 0,
        render: () => campfireFeatureMethods.renderCampfireBottom.call(this, this._renderContext)
      },
      {
        // 与 bottom 使用同一 Y，再以 priority 保证火焰绘制在木柴之上、同脚点实体之前。
        type: 'campfire_top', y: this.campfire.y, sortPriority: 1,
        render: () => campfireFeatureMethods.renderCampfireTop.call(this, this._renderContext)
      },
      {
        // 灵魂状态复活倒计时（玩家灵魂靠近篝火时由 PlayerSoulRespawn 驱动显示）。
        type: 'campfire_countdown', y: this.campfire.y, sortPriority: 2,
        render: () => campfireFeatureMethods.renderRespawnCountdown.call(this, this._renderContext)
      }
    ];
    if (config.configView) this.configure(config.configView);
  }

  configure(configView) {
    const source = configView?.get && typeof configView.get === 'function'
      ? configView.get('scene.gameplay.campfire', configView.get('gameplay.campfire'))
      : configView;
    if (!source || typeof source !== 'object') throw new TypeError('campfire config view is required');
    const flame = source.flame || {};
    const sprite = flame.sprite || source.sprite;
    const presentation = source.presentation;
    const fuelConfiguration = createFuelConfiguration(source.fuel);
    if (!sprite || !presentation || !Array.isArray(source.particlePresets)) {
      throw new TypeError('campfire config view is incomplete');
    }

    const next = deepFreeze(cloneCanonicalValue(source));
    const visualLayers = normalizeVisualLayers(next);
    const ember = next.embers || {};
    if (!Array.isArray(ember.offsets) || ember.offsets.length === 0) {
      throw new TypeError('campfire.embers.offsets must contain at least one ember');
    }
    const emberState = deepFreeze({
      color: typeof ember.color === 'string' && ember.color ? ember.color : '#ffb04a',
      radius: requirePositive(ember.radius, 'campfire.embers.radius'),
      frequency: requirePositive(ember.frequency, 'campfire.embers.frequency'),
      minAlpha: Math.max(0, Math.min(1, Number(ember.minAlpha))),
      maxAlpha: Math.max(0, Math.min(1, Number(ember.maxAlpha))),
      offsetX: Number.isFinite(Number(ember.offsetX)) ? Number(ember.offsetX) : 0,
      offsetY: Number.isFinite(Number(ember.offsetY)) ? Number(ember.offsetY) : -18,
      offsets: ember.offsets.map((entry, index) => {
        if (!Array.isArray(entry) || entry.length < 3 || !entry.slice(0, 3).every(Number.isFinite)) {
          throw new TypeError(`campfire.embers.offsets[${index}] must be [x, y, phase]`);
        }
        return Object.freeze([entry[0], entry[1], entry[2]]);
      })
    });
    if (emberState.minAlpha > emberState.maxAlpha) throw new RangeError('campfire.embers minAlpha cannot exceed maxAlpha');
    const spriteState = {
      frameWidth: requirePositive(sprite.frameWidth, 'campfire.sprite.frameWidth'),
      frameHeight: requirePositive(sprite.frameHeight, 'campfire.sprite.frameHeight'),
      frameCols: Math.floor(requirePositive(sprite.frameCols, 'campfire.sprite.frameCols')),
      frameRows: Math.floor(requirePositive(sprite.frameRows, 'campfire.sprite.frameRows')),
      frameCount: Math.floor(requirePositive(sprite.frameCount, 'campfire.sprite.frameCount')),
      frameDuration: requirePositive(sprite.frameDuration, 'campfire.sprite.frameDuration')
    };
    if (spriteState.frameCols * spriteState.frameRows < spriteState.frameCount) {
      throw new RangeError('campfire.sprite frame grid cannot cover frameCount');
    }
    next.particlePresets.forEach((preset, index) => {
      const path = `campfire.particlePresets[${index}]`;
      requirePositive(preset.rate, `${path}.rate`);
      requirePositive(preset.life, `${path}.life`);
      requirePositive(preset.size, `${path}.size`);
      if (!Number.isFinite(Number(preset.vy))) throw new TypeError(`${path}.vy must be a finite number`);
      const alpha = Number(preset.alpha);
      if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
        throw new TypeError(`${path}.alpha must be between 0 and 1`);
      }
      if (typeof preset.color !== 'string' || preset.color.length === 0) {
        throw new TypeError(`${path}.color must be a non-empty string`);
      }
    });
    const presentationState = deepFreeze({
      lightRadius: requirePositive(presentation.lightRadius, 'campfire.presentation.lightRadius'),
      fireWidth: requirePositive(presentation.fireWidth, 'campfire.presentation.fireWidth'),
      fireHeight: requirePositive(presentation.fireHeight, 'campfire.presentation.fireHeight'),
      collisionWidth: requirePositive(presentation.collisionWidth, 'campfire.presentation.collisionWidth'),
      collisionHeight: requirePositive(presentation.collisionHeight, 'campfire.presentation.collisionHeight')
    });
    const keepsCurrentImage = this.visualLayers?.flame?.imageId === visualLayers.flame.imageId;
    if (keepsCurrentImage && this.campfire.fireImage) {
      this._validateFireImageDimensions(this.campfire.fireImage, spriteState);
    }

    Object.assign(this.campfire, spriteState, {
      currentFrame: this.campfire.currentFrame % spriteState.frameCount,
      frameTime: 0
    });
    if (!keepsCurrentImage) {
      this.campfire.fireImage = null;
      this.campfire.imageLoaded = false;
    }
    const previousFuel = this.fuel;
    const preserveFuel = previousFuel.enabled === true
      && fuelConfiguration.enabled === true
      && previousFuel.itemId === fuelConfiguration.itemId
      && previousFuel.secondsPerUnit === fuelConfiguration.secondsPerUnit;
    const initialSeconds = fuelConfiguration.initialUnits * fuelConfiguration.secondsPerUnit;
    this.fuel = {
      ...fuelConfiguration,
      remainingSeconds: preserveFuel
        ? Math.min(fuelConfiguration.maxUnits * fuelConfiguration.secondsPerUnit, Math.max(0, previousFuel.remainingSeconds))
        : initialSeconds,
      active: preserveFuel ? previousFuel.active === true : false
    };
    this.particlePresets = next.particlePresets;
    this.labels = next.labels;
    this.presentation = presentationState;
    const previousLayers = this.visualLayers;
    const previousImages = this.layerImages;
    this.visualLayers = visualLayers;
    this.embers = emberState;
    campfireFeatureMethods._stopEmberParticles.call(this);
    if (!this.campfire.lit && this.campfire.hasBeenIgnited) {
      campfireFeatureMethods._startEmberParticles.call(this);
    }
    this.layerImages = Object.fromEntries(Object.entries(visualLayers).map(([key, layer]) => [
      key,
      previousImages?.[key] && previousLayers?.[key]?.imageId === layer.imageId ? previousImages[key] : null
    ]));
    this.configView = next;
    this._atmosphereCanvas = null;
    this._atmosphereContext = null;
    this._atmosphereMasks.clear();
    return this.configView;
  }

  _getAtmosphereMask(kind, radius, yScale) {
    const safeRadius = Math.max(1, Number(radius) || 1);
    const safeYScale = Math.max(0.01, Number(yScale) || 1);
    const key = `${kind}:${safeRadius}:${safeYScale}`;
    const cached = this._atmosphereMasks.get(key);
    if (cached) return cached;

    const canvas = this.createCanvas();
    canvas.width = Math.max(2, Math.ceil(safeRadius * 2) + 2);
    canvas.height = Math.max(2, Math.ceil(safeRadius * 2 * safeYScale) + 2);
    const maskCtx = canvas.getContext('2d');
    maskCtx.translate(canvas.width / 2, canvas.height / 2);
    maskCtx.scale(1, safeYScale);
    const gradient = maskCtx.createRadialGradient(0, 0, 0, 0, 0, safeRadius);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    if (kind === 'campfire') {
      gradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.8)');
    } else {
      gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.6)');
    }
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    maskCtx.fillStyle = gradient;
    maskCtx.beginPath();
    maskCtx.arc(0, 0, safeRadius, 0, Math.PI * 2);
    maskCtx.fill();
    this._atmosphereMasks.set(key, canvas);
    return canvas;
  }

  isConfigured() { return this.configView !== null; }

  _bindRuntime(runtime = {}) {
    this.particleSystem = runtime.particleSystem || this.particleSystem || null;
    this.timeSystem = runtime.timeSystem || null;
    this.weatherSystem = runtime.weatherSystem || null;
    this.playerEntity = runtime.playerEntity || null;
    this.camera = runtime.camera || null;
    this.viewBounds = runtime.viewBounds || null;
    this.loadedCoverage = runtime.loadedCoverage || null;
    this.flightSystem = runtime.flightSystem || null;
    this.jumpSystem = runtime.jumpSystem || null;
    this.logicalWidth = Number(runtime.width) || this.logicalWidth || 1280;
    this.logicalHeight = Number(runtime.height) || this.logicalHeight || 720;
  }

  setPosition(position = {}) {
    if (Number.isFinite(position.x)) this.campfire.x = position.x;
    if (Number.isFinite(position.y)) this.campfire.y = position.y;
    return this.getPosition();
  }

  getPosition() {
    return { x: this.campfire.x, y: this.campfire.y };
  }

  getPresentationImageIds() {
    return Object.freeze(Object.fromEntries(Object.entries(this.visualLayers)
      .map(([key, layer]) => [key, layer.imageId])));
  }

  setPresentationImages(images = {}) {
    for (const [key, layer] of Object.entries(this.visualLayers)) {
      const image = images[key] || null;
      if (key === 'flame') this.setFireImage(image);
      else this.layerImages[key] = image;
      if (!image) this.logger?.warn?.(`SceneCampfireService: missing configured ${key} image ${layer.imageId}`);
    }
  }

  _validateFireImageDimensions(image, sprite = this.campfire) {
    const width = Number(image?.naturalWidth || image?.videoWidth || image?.width);
    const height = Number(image?.naturalHeight || image?.videoHeight || image?.height);
    if (!(width > 0) || !(height > 0)) return;
    const requiredWidth = sprite.frameWidth * sprite.frameCols;
    const requiredHeight = sprite.frameHeight * sprite.frameRows;
    if (width < requiredWidth || height < requiredHeight) {
      throw new RangeError(
        `campfire image ${width}x${height} cannot cover sprite grid ${requiredWidth}x${requiredHeight}`
      );
    }
  }

  setFireImage(image) {
    if (image) this._validateFireImageDimensions(image);
    this.campfire.fireImage = image || null;
    this.layerImages.flame = image || null;
    this.campfire.imageLoaded = !!image;
  }

  isLit() {
    return this.campfire.lit === true;
  }

  /** 已点燃视为幂等成功；未点燃时，有燃料配置就必须至少剩余一份木柴。 */
  canIgnite() {
    if (!this.isConfigured()) return false;
    if (this.isLit()) return true;
    return this.fuel.enabled !== true || this.getFuelSnapshot().units > 0;
  }

  getFuelSnapshot() {
    const fuel = this.fuel;
    const units = fuel.enabled && fuel.secondsPerUnit > 0
      ? Math.min(fuel.maxUnits, Math.ceil(Math.max(0, fuel.remainingSeconds) / fuel.secondsPerUnit))
      : 0;
    return {
      enabled: fuel.enabled === true,
      itemId: fuel.itemId,
      secondsPerUnit: fuel.secondsPerUnit,
      maxUnits: fuel.maxUnits,
      units,
      remainingSeconds: Math.max(0, fuel.remainingSeconds),
      active: fuel.active === true
    };
  }

  startFuelCountdown() {
    if (!this.isLit() || this.fuel.enabled !== true || this.fuel.remainingSeconds <= 0) return false;
    this.fuel.active = true;
    return true;
  }

  canAddFuelUnits(units = 1) {
    const amount = Math.max(0, Math.floor(Number(units) || 0));
    if (amount <= 0 || this.fuel.enabled !== true || this.fuel.secondsPerUnit <= 0) return false;
    return this.fuel.remainingSeconds + amount * this.fuel.secondsPerUnit
      <= this.fuel.maxUnits * this.fuel.secondsPerUnit;
  }

  addFuelUnits(units = 1) {
    const amount = Math.max(0, Math.floor(Number(units) || 0));
    if (!this.canAddFuelUnits(amount)) return false;
    this.fuel.remainingSeconds += amount * this.fuel.secondsPerUnit;
    if (this.isLit()) this.fuel.active = true;
    return true;
  }

  snapshot() {
    return {
      lit: this.isLit(),
      hasBeenIgnited: this.campfire.hasBeenIgnited === true,
      fuel: this.getFuelSnapshot()
    };
  }

  restore({ lit = false, hasBeenIgnited = false, fuel = null } = {}, runtime = {}) {
    this._bindRuntime(runtime);
    campfireFeatureMethods._restoreCampfireState.call(this, lit === true);
    this.campfire.hasBeenIgnited = lit === true || hasBeenIgnited === true;
    if (!lit && this.campfire.hasBeenIgnited) {
      campfireFeatureMethods._startEmberParticles.call(this);
    }
    if (this.fuel.enabled !== true) return true;
    const maximumSeconds = this.fuel.maxUnits * this.fuel.secondsPerUnit;
    const legacySeconds = this.fuel.initialUnits * this.fuel.secondsPerUnit;
    const restoredSeconds = Number.isFinite(fuel?.remainingSeconds)
      ? fuel.remainingSeconds
      : legacySeconds;
    this.fuel.remainingSeconds = Math.min(maximumSeconds, Math.max(0, restoredSeconds));
    this.fuel.active = lit === true && fuel?.active === true && this.fuel.remainingSeconds > 0;
    return true;
  }

  ignite({ emitEvent = true, runtime = {} } = {}) {
    if (!this.canIgnite()) return false;
    this._bindRuntime(runtime);
    if (this.isLit()) return true;
    campfireFeatureMethods.lightCampfire.call(this, { emitEvent });
    return true;
  }

  lightCampfire(options = {}) {
    return this.ignite(options);
  }

  extinguish({ emitEvent = true, runtime = {} } = {}) {
    if (!this.isConfigured()) return false;
    this._bindRuntime(runtime);
    if (!this.isLit()) return true;
    campfireFeatureMethods._restoreCampfireState.call(this, false);
    if (emitEvent) this.onExtinguished?.(this.getPosition());
    return true;
  }

  update(deltaTime, runtime = {}) {
    if (!this.isConfigured()) return;
    this._bindRuntime(runtime);
    campfireFeatureMethods.updateCampfireAnimation.call(this, deltaTime);
    if (this.campfire.lit && this.fuel.enabled === true && this.fuel.active === true) {
      this.fuel.remainingSeconds = Math.max(0, this.fuel.remainingSeconds - Math.max(0, Number(deltaTime) || 0));
      if (this.fuel.remainingSeconds <= 0) {
        this.fuel.active = false;
        this.extinguish({ runtime });
      }
    }
  }

  renderAtmosphere(ctx, runtime = {}) {
    this._bindRuntime(runtime);
    return campfireFeatureMethods.renderAtmosphere.call(this, ctx);
  }

  appendRenderItems(queue, ctx, runtime = {}) {
    if (!this.isConfigured() || !Array.isArray(queue)) return false;
    this._bindRuntime(runtime);
    this._renderContext = ctx;
    const bottom = this._campfireRenderItems[0];
    const top = this._campfireRenderItems[1];
    const countdown = this._campfireRenderItems[2];
    bottom.y = this.campfire.y;
    top.y = this.campfire.y;
    countdown.y = this.campfire.y;
    queue.push(bottom, top, countdown);
    return true;
  }

  /** 灵魂状态复活倒计时及复活圈表现投影；传 null/0 隐藏。 */
  setRespawnCountdown(seconds = null, presentation = {}) {
    const value = Number.isFinite(Number(seconds)) && Number(seconds) > 0
      ? Math.ceil(Number(seconds))
      : null;
    const duration = Number(presentation.durationSeconds);
    const radius = Number(presentation.approachRadius);
    const remaining = Number(presentation.remainingSeconds);
    if (Number.isFinite(duration) && duration > 0) this.campfire.respawnDurationSeconds = duration;
    if (Number.isFinite(radius) && radius > 0) this.campfire.respawnApproachRadius = radius;
    this.campfire.respawnRemainingSeconds = value === null
      ? null
      : (Number.isFinite(remaining) ? Math.max(0, remaining) : value);
    this.campfire.respawnCountdownSeconds = value;
    return value;
  }

  resolvePlayerCollision(runtime = {}) {
    if (!this.isConfigured()) return;
    this._bindRuntime(runtime);
    return campfireFeatureMethods.checkCampfireCollision.call(this);
  }

  dispose() {
    for (const emitter of this.campfire.emitters || []) emitter.active = false;
    this.campfire.emitters.length = 0;
    campfireFeatureMethods._stopEmberParticles.call(this);
    if (this.campfire.emitterSmoke) this.campfire.emitterSmoke.active = false;
    this.campfire.emitterSmoke = null;
    this.campfire.fireImage = null;
    this.campfire.imageLoaded = false;
    this.configView = null;
    this.visualLayers = Object.freeze({});
    this.layerImages = Object.create(null);
    this._atmosphereCanvas = null;
    this._atmosphereContext = null;
    this._renderContext = null;
    this.loadedCoverage = null;
    this._atmosphereMasks.clear();
  }
}

export default SceneCampfireService;