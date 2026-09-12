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
import { DebugPanel } from '../../ui/DebugPanel.js';
import { normalizeRuntimeDebugMode } from '../CanonicalSnapshot.js';
import { PerformanceOptimizer } from '../../systems/PerformanceOptimizer.js';
import { PerformanceMonitor } from '../PerformanceMonitor.js';

const DRAW_METHODS = Object.freeze([
  'drawImage', 'fillRect', 'strokeRect', 'fill', 'stroke', 'fillText', 'strokeText'
]);

export class SceneDiagnostics {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.runtimeConfig = options.runtimeConfig || null;
    this.records = [];
    scene.debugPanel = null;
    scene.performanceOptimizer = new PerformanceOptimizer({
      cellSize: options.cellSize || 128,
      spatialGrid: true,
      batching: true,
      pooling: true,
      lod: true
    });
    scene.performanceMonitor = new PerformanceMonitor({
      enabled: false,
      showGraph: false
    });
    scene._drawCallCount = 0;
    scene._drawCallProxied = false;
    scene._drawCallOriginals = null;
    scene._drawCallProxyContext = null;
    this._terrainCollisionSignature = null;
    this._collisionDebugRenderCount = 0;
    this._collisionEntered = false;
    this._noTerrainLogged = false;
    this._collisionInitLogged = false;
  }

  setRuntimeConfig(runtimeConfig = null) {
    this.runtimeConfig = runtimeConfig;
    const enabled = normalizeRuntimeDebugMode(runtimeConfig?.debug);
    this.scene.debugMode = enabled;
    if (!enabled) {
      const panel = this.scene.debugPanel;
      if (typeof panel?.dispose === 'function') panel.dispose();
      else panel?.hide?.();
    }
    return enabled;
  }

  isDebugEnabled() {
    return normalizeRuntimeDebugMode(this.runtimeConfig?.debug);
  }

  recordTriggerFailure(envelope, { openPanel = true } = {}) {
    if (!this.isDebugEnabled()) return false;
    return this._recordDiagnostic(envelope, { openPanel });
  }

  recordEventConflict(record, { openPanel = record?.status === 'failed' } = {}) {
    const failed = record?.status === 'failed' || (record?.failedTriggerIds?.length || 0) > 0;
    return this._recordDiagnostic({ ...record, type: 'eventConflict' }, {
      openPanel,
      retainWithoutDebug: failed
    });
  }

  recordApplicationEventConsumerFailure(record, { openPanel = false } = {}) {
    return this._recordDiagnostic({ ...record, type: 'applicationEventConsumerFailure' }, {
      openPanel,
      retainWithoutDebug: true
    });
  }

  _recordDiagnostic(record, { openPanel = false, retainWithoutDebug = false } = {}) {
    const debugEnabled = this.isDebugEnabled();
    if (!debugEnabled && !retainWithoutDebug) return false;
    this.records.push(record);
    const limit = debugEnabled ? 128 : 16;
    if (this.records.length > limit) this.records.splice(0, this.records.length - limit);
    if (!debugEnabled) return true;
    const panel = this._ensureDebugPanel();
    panel.setDiagnosticRecords(this.records);
    panel.recordFailure(record);
    if (openPanel) panel.show();
    return true;
  }

  getRecords() {
    return this.records.slice();
  }

  _ensureDebugPanel() {
    const scene = this.scene;
    if (!scene.debugPanel) {
      scene.debugPanel = new DebugPanel({
        getScene: () => scene,
        getSceneManager: () => {
          const engine = typeof window !== 'undefined' ? window.gameEngine : null;
          return engine?.sceneManager || scene.sceneManager || null;
        },
        isDebugEnabled: () => this.isDebugEnabled()
      });
    }
    scene.debugPanel.setDiagnosticRecords(this.records);
    return scene.debugPanel;
  }

  togglePerformance() {
    const monitor = this.scene.performanceMonitor;
    monitor.toggle();
    console.log('性能监控:', monitor.enabled ? '开启' : '关闭');
    return monitor.enabled;
  }

  /**
   * 启动 P6.2 的真实性能采样。调用方必须在真实浏览器或设备中执行场景负载；
   * 此方法只记录数据，不把任何阈值自动标记为通过。
   */
  startPerformanceMeasurement(metadata = {}) {
    const engine = typeof window !== 'undefined' ? window.gameEngine : null;
    return this.scene.performanceMonitor.startMeasurement({
      ...metadata,
      sceneId: metadata.sceneId ?? this.scene.currentSceneId ?? this.scene.editorSceneId ?? null,
      resolution: metadata.resolution ?? {
        width: this.scene.logicalWidth ?? null,
        height: this.scene.logicalHeight ?? null
      },
      requestedBackendMode: metadata.requestedBackendMode ?? engine?.requestedBackendMode ?? null,
      actualBackendMode: metadata.actualBackendMode ?? engine?.actualBackendMode ?? null
    });
  }

  stopPerformanceMeasurement() {
    return this.scene.performanceMonitor.stopMeasurement();
  }

  getPerformanceMeasurement() {
    return this.scene.performanceMonitor.getMeasurementSnapshot();
  }

  _captureReleaseState(runtime = this.scene.sceneRuntime, resourceScope = this.scene.resourceScope) {
    return {
      runtimeDisposed: runtime?.disposed ?? null,
      container: runtime?.container?.getLifecycleSnapshot?.() ?? null,
      resourceScope: resourceScope?.getLifecycleSnapshot?.() ?? null,
      drawCallProxyActive: this.scene._drawCallProxied === true,
      particleCount: this.scene.particleSystem?.getActiveCount?.() ?? null
    };
  }

  /** 记录场景释放前的可追踪资源基线；不检查全局浏览器资源。 */
  beginReleaseAudit() {
    if (this._releaseAudit?.status === 'capturing') return this._releaseAudit.before;
    const runtime = this.scene.sceneRuntime;
    const resourceScope = this.scene.resourceScope;
    const before = this._captureReleaseState(runtime, resourceScope);
    this._releaseAudit = { status: 'capturing', before, runtime, resourceScope };
    return before;
  }

  /**
   * 在场景的正式释放事务完成后取样。结果只覆盖容器、ResourceScope、Canvas 代理和粒子；
   * 浏览器内存与其他宿主资源仍须结合 P6.2 的真实 profile 记录审查。
   */
  finalizeReleaseAudit() {
    const audit = this._releaseAudit || (this.beginReleaseAudit(), this._releaseAudit);
    const after = this._captureReleaseState(audit.runtime, audit.resourceScope);
    const trackedResidue = {
      ownerRegistrations: after.container?.ownedCount ?? null,
      pendingTimers: after.resourceScope?.pendingTimerCount ?? null,
      trackedDisposers: after.resourceScope?.disposerCount ?? null,
      asyncTokensInvalidated: after.resourceScope ? after.resourceScope.disposed === true : null,
      drawCallProxyActive: after.drawCallProxyActive,
      activeParticles: after.particleCount
    };
    const report = {
      baseline: audit.before,
      after,
      trackedResidue,
      trackedReleaseComplete: after.container?.registeredCount === 0
        && after.resourceScope?.disposed === true
        && after.resourceScope?.pendingTimerCount === 0
        && after.resourceScope?.disposerCount === 0
        && after.drawCallProxyActive === false
        && (after.particleCount === null || after.particleCount === 0)
    };
    this._releaseAudit = { ...audit, status: 'completed', report };
    this.lastReleaseAudit = report;
    return report;
  }

  toggleDebugPanel() {
    const scene = this.scene;
    if (!this.isDebugEnabled()) {
      scene.debugPanel?.hide?.();
      return false;
    }
    console.log('[BaseGameScene][DebugPanel] 收到切换请求', {
      scene: scene.name,
      isActive: scene.isActive,
      isPaused: scene.isPaused,
      panelExists: !!scene.debugPanel,
      visibleBefore: scene.debugPanel?.visible ?? false,
      elementConnectedBefore: scene.debugPanel?._el?.isConnected || false,
      existingDomCount: typeof document !== 'undefined'
        ? document.querySelectorAll('#debug-panel').length : 0
    });

    const panel = this._ensureDebugPanel();
    if (!scene.debugPanel.visible) console.log('[BaseGameScene][DebugPanel] 已创建或复用 DebugPanel 实例');

    const visible = panel.toggle();
    console.log('[BaseGameScene][DebugPanel] 切换调用结束', {
      visibleAfter: scene.debugPanel.visible,
      elementConnectedAfter: scene.debugPanel._el?.isConnected || false,
      domElement: typeof document !== 'undefined'
        ? document.getElementById('debug-panel') : null
    });
    return visible;
  }

  setupDrawCallCounter(ctx) {
    const scene = this.scene;
    if (scene._drawCallProxied) return;
    scene._drawCallOriginals = new Map();
    scene._drawCallProxyContext = ctx;
    for (let i = 0; i < DRAW_METHODS.length; i++) {
      const method = DRAW_METHODS[i];
      const original = ctx[method];
      if (!original) continue;
      scene._drawCallOriginals.set(method, original);
      ctx[method] = (...args) => {
        scene._drawCallCount++;
        return original.apply(ctx, args);
      };
    }
    scene._drawCallProxied = true;
  }

  teardownDrawCallCounter() {
    const scene = this.scene;
    const context = scene._drawCallProxyContext;
    if (!scene._drawCallProxied || !context) return;
    for (const [method, original] of scene._drawCallOriginals || []) {
      context[method] = original;
    }
    scene._drawCallOriginals = null;
    scene._drawCallProxyContext = null;
    scene._drawCallProxied = false;
  }
  observeTerrainCollision({ terrains = [], terrain = null, playerEntity = null, label = 'Scene' } = {}) {
    const state = terrains.map((entry, index) => ({
      index,
      sceneId: entry?._editorSceneId || null,
      worldOffset: entry?.worldOffset || null,
      collisionShapeCount: entry?._collisionShapes?.length || 0
    }));
    const signature = JSON.stringify(state);
    if (signature === this._terrainCollisionSignature) return false;
    const transform = playerEntity?.getComponent?.('transform');
    console.log(`[${label}][Collision] 地形碰撞数据状态变化`, {
      terrains: state,
      mainTerrainSceneId: terrain?._editorSceneId || null,
      playerPosition: transform
        ? { x: transform.position.x, y: transform.position.y }
        : null
    });
    this._terrainCollisionSignature = signature;
    return true;
  }

  renderCollisionShapes(ctx, {
    enabled = false,
    camera = null,
    terrains = [],
    label = 'Scene'
  } = {}) {
    if (!enabled || !camera || !Array.isArray(terrains)) return false;

    this._collisionDebugRenderCount++;
    if (this._collisionDebugRenderCount % 120 === 1) {
      const shapeInfo = terrains.map((terrain, index) => {
        const collisionShapes = terrain?._collisionShapes || [];
        const walkableShapes = terrain?._walkableShapes || [];
        const first = collisionShapes[0] || walkableShapes[0];
        return `[${index}] ${terrain?._editorSceneId}: collision=${collisionShapes.length}, walkable=${walkableShapes.length}`
          + (first ? `, first.points[0..1]=${JSON.stringify(first.points?.slice(0, 2))}` : '');
      });
      const bounds = camera.getViewBounds();
      console.log(`[${label}][CollisionDebug]`, shapeInfo.join(' | '),
        `| view: L=${Math.round(bounds.left)} T=${Math.round(bounds.top)} R=${Math.round(bounds.right)} B=${Math.round(bounds.bottom)}`);
    }

    ctx.save();
    const viewBounds = camera.getViewBounds();
    ctx.translate(-viewBounds.left, -viewBounds.top);
    for (const terrain of terrains) {
      if (typeof terrain?.renderCollisionShapesDebug === 'function') {
        terrain.renderCollisionShapesDebug(ctx, 0.7);
        continue;
      }
      const shapes = terrain?._collisionShapes;
      if (!shapes || shapes.length === 0) continue;
      for (const shape of shapes) {
        if (shape.shapeType === 'polygon' && Array.isArray(shape.points) && shape.points.length > 2) {
          ctx.beginPath();
          ctx.moveTo(shape.points[0][0], shape.points[0][1]);
          for (let index = 1; index < shape.points.length; index++) {
            ctx.lineTo(shape.points[index][0], shape.points[index][1]);
          }
          ctx.closePath();
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = '#ff9800';
          ctx.fill();
          ctx.strokeStyle = '#ff3b30';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (shape.shapeType === 'rect' || (shape.x !== undefined && shape.width)) {
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = '#ff9800';
          ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
          ctx.strokeStyle = '#ff3b30';
          ctx.lineWidth = 2;
          ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
        } else if (shape.shapeType === 'ellipse' || shape.shapeType === 'circle') {
          const cx = (shape.x || 0) + (shape.width || 0) / 2;
          const cy = (shape.y || 0) + (shape.height || 0) / 2;
          const rx = (shape.width || 0) / 2;
          const ry = (shape.height || 0) / 2;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = '#ff9800';
          ctx.fill();
          ctx.strokeStyle = '#ff3b30';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    return true;
  }

  /** 绘制空间 trigger 的只读热点快照，不执行条件动作或修改交互状态。 */
  renderTriggerHotspots(ctx, {
    enabled = false,
    camera = null,
    hotspots = []
  } = {}) {
    if (!enabled || !camera || !Array.isArray(hotspots) || hotspots.length === 0) return false;

    ctx.save();
    const viewBounds = camera.getViewBounds();
    ctx.translate(-viewBounds.left, -viewBounds.top);
    ctx.lineWidth = 2;
    ctx.font = '12px sans-serif';
    ctx.textBaseline = 'bottom';

    for (const hotspot of hotspots) {
      const anchor = hotspot?.anchor;
      if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) continue;
      const color = hotspot.inside ? '#00e5ff' : hotspot.active ? '#39d353' : '#ff5d5d';
      const radius = Math.max(0, Number(hotspot.radius) || 0);
      const pointerRadius = Math.max(0, Number(hotspot.pointerRadius) || 0);

      ctx.setLineDash([]);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      if (radius > 0) {
        ctx.beginPath();
        ctx.arc(anchor.x, anchor.y, radius, 0, Math.PI * 2);
        ctx.globalAlpha = hotspot.active ? 0.12 : 0.06;
        ctx.fill();
        ctx.globalAlpha = hotspot.active ? 0.9 : 0.45;
        ctx.stroke();
      } else if (hotspot.bounds) {
        ctx.globalAlpha = hotspot.active ? 0.9 : 0.45;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(hotspot.bounds.x, hotspot.bounds.y, hotspot.bounds.width, hotspot.bounds.height);
      }

      if (pointerRadius > 0 && pointerRadius !== radius) {
        ctx.beginPath();
        ctx.arc(anchor.x, anchor.y, pointerRadius, 0, Math.PI * 2);
        ctx.globalAlpha = hotspot.active ? 0.85 : 0.35;
        ctx.strokeStyle = '#ffb020';
        ctx.setLineDash([5, 4]);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(anchor.x - 5, anchor.y);
      ctx.lineTo(anchor.x + 5, anchor.y);
      ctx.moveTo(anchor.x, anchor.y - 5);
      ctx.lineTo(anchor.x, anchor.y + 5);
      ctx.stroke();

      const label = hotspot.prompt || hotspot.bindingId || hotspot.triggerId;
      if (label) {
        const text = `${hotspot.active ? '' : '[未激活] '}${label}`;
        const width = ctx.measureText(text).width + 8;
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = '#101418';
        ctx.fillRect(anchor.x + 7, anchor.y - 21, width, 18);
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.fillText(text, anchor.x + 11, anchor.y - 6);
      }
    }

    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.restore();
    return true;
  }

  checkTerrainCollision({
    terrainBinding = null,
    terrains = [],
    terrain = null,
    secondaryTerrain = null,
    playerEntity = null,
    label = 'Scene'
  } = {}) {
    if (!this._collisionEntered) {
      console.log(`%c[${label}] checkTerrainCollision 进入方法体`, 'color:lime;font-size:14px');
      this._collisionEntered = true;
    }
    if (terrains.length === 0) {
      if (!this._noTerrainLogged) {
        console.warn(`[${label}] checkTerrainCollision: 地形未加载`);
        this._noTerrainLogged = true;
      }
      return false;
    }
    const current = terrain || terrains[0];
    if (!this._collisionInitLogged) {
      console.log(`[${label}] checkTerrainCollision, collisionShapes:`, current?._collisionShapes?.length,
        'secondary terrain shapes:', secondaryTerrain?._collisionShapes?.length);
      for (let index = 0; index < Math.min(3, current?._collisionShapes?.length || 0); index++) {
        const shape = current._collisionShapes[index];
        console.log(`[${label}] shape[${index}]: type=${shape.shapeType}, points前3个=`,
          shape.points ? shape.points.slice(0, 3) : 'NO POINTS');
      }
      const transform = playerEntity?.getComponent?.('transform');
      console.log(`[${label}] 玩家位置:`, transform
        ? `(${Math.round(transform.position.x)},${Math.round(transform.position.y)})`
        : 'null');
      this._collisionInitLogged = true;
    }
    terrainBinding?.checkTerrainCollision?.();
    return true;
  }


  estimateTextureMemory() {
    const scene = this.scene;
    let bytes = 0;
    const terrains = scene._terrains || (scene.terrain ? [scene.terrain] : []);
    for (let i = 0; i < terrains.length; i++) {
      const terrain = terrains[i];
      if (terrain._combinedGroundCache) {
        bytes += terrain._combinedGroundCache.width * terrain._combinedGroundCache.height * 4;
      }
      if (terrain._groundDecoCache) {
        bytes += terrain._groundDecoCache.width * terrain._groundDecoCache.height * 4;
      }
      if (terrain._bgImageCache) {
        bytes += terrain._bgImageCache.width * terrain._bgImageCache.height * 4;
      }
      const images = terrain.images || {};
      const keys = Object.keys(images);
      for (let j = 0; j < keys.length; j++) {
        const image = images[keys[j]];
        if (image?.naturalWidth) bytes += image.naturalWidth * image.naturalHeight * 4;
      }
    }
    const mapCache = scene.minimap?._mapCache;
    if (mapCache) bytes += mapCache.width * mapCache.height * 4;
    return bytes;
  }

  dispose() {
    this.beginReleaseAudit();
    this.scene.performanceMonitor?.dispose?.();
    this.teardownDrawCallCounter();
    // 诊断记录在 dispose 后保留（最多 128/16 条上限），供场景退出后仍可查询失败诊断。
    const scene = this.scene;
    if (!scene.debugPanel) return;
    console.log('[BaseGameScene][DebugPanel] 场景退出，清理调试面板', {
      visible: scene.debugPanel.visible,
      elementConnected: scene.debugPanel._el?.isConnected || false
    });
    if (typeof scene.debugPanel.dispose === 'function') scene.debugPanel.dispose();
    else scene.debugPanel.hide?.();
    scene.debugPanel = null;
  }
}

export default SceneDiagnostics;