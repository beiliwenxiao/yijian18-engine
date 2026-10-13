/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 ************************************************************/

import { Logger } from './Logger.js';

const MB = 1024 * 1024;

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function clone(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function rounded(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/**
 * PerformanceMonitor - 场景性能监控与 P6.2 实测采样器。
 *
 * 常规 HUD 指标继续保持轻量；只有显式 startMeasurement() 才保存完整帧样本、
 * 长任务与内存峰值。采样结果仅是浏览器/设备实测记录，不替代验收结论。
 */
export class PerformanceMonitor {
  constructor(options = {}) {
    this.enabled = options.enabled !== undefined ? options.enabled : true;
    this.position = options.position || { x: 10, y: 10 };
    this.updateInterval = options.updateInterval || 0.5;
    this.metrics = {
      fps: 0,
      frameTime: 0,
      updateTime: 0,
      renderTime: 0,
      entityCount: 0,
      visibleEntityCount: 0,
      drawCalls: 0,
      drawCallsPerFrame: 0,
      textureMemory: 0,
      memoryUsage: 0,
      particleCount: 0,
      poolStats: {},
      onePercentLowFps: 0,
      longTaskCount: 0
    };
    this.frameCount = 0;
    this.lastUpdateTime = 0;
    this.frameTimes = [];
    this.maxFrameTimeSamples = 60;
    this.timers = new Map();
    this.history = { fps: [], frameTime: [], maxHistoryLength: 100 };
    this.showGraph = options.showGraph !== undefined ? options.showGraph : false;
    this.graphHeight = 60;
    this.graphWidth = 200;
    this.measurement = null;
    this.drawCallTracking = options.drawCallTracking === true;
    this._longTaskObserver = null;
    this._memoryRequestInFlight = false;
    this._metricsRevision = 0;
    this._renderedMetricsRevision = -1;
    this._fpsElement = null;
    this._lastFpsText = null;
    this._lastFpsColor = null;
  }

  setEnabled(enabled) {
    this.enabled = enabled === true;
    if (this.enabled) this._renderedMetricsRevision = -1;
  }

  toggle() {
    this.setEnabled(!this.enabled);
  }

  setDrawCallTracking(enabled) {
    this.drawCallTracking = enabled === true;
  }

  shouldTrackDrawCalls() {
    return this.drawCallTracking
      || (this.measurement?.status === 'running'
        && this.measurement?.metadata?.captureDrawCalls === true);
  }

  /** 开始一次明确标识的真实运行采样；不会创建测试页面或模拟设备数据。 */
  startMeasurement(metadata = {}) {
    this.stopMeasurement();
    const start = now();
    this.measurement = {
      status: 'running',
      metadata: clone(metadata),
      startedAt: start,
      endedAt: null,
      maxSamples: Math.max(1, Math.floor(metadata.maxSamples || 36_000)),
      memorySampleEveryFrames: Math.max(1, Math.floor(metadata.memorySampleEveryFrames || 120)),
      longTaskThresholdMs: Math.max(1, Number(metadata.longTaskThresholdMs) || 50),
      frameTimes: [],
      entityCounts: [],
      drawCalls: [],
      memorySamples: [],
      longTasks: [],
      droppedFrameSamples: 0
    };
    this._captureMemorySample(this.measurement);
    this._observeLongTasks(this.measurement);
    return this.getMeasurementSnapshot();
  }

  /** 结束采样并断开 Long Task observer；异步 UA memory 结果仍会归入本次样本。 */
  stopMeasurement() {
    if (!this.measurement) return null;
    const measurement = this.measurement;
    if (measurement.status === 'running') {
      measurement.status = 'completed';
      measurement.endedAt = now();
      this._captureMemorySample(measurement);
    }
    this._disconnectLongTaskObserver();
    return this.getMeasurementSnapshot();
  }

  _observeLongTasks(measurement) {
    const Observer = globalThis.PerformanceObserver;
    if (typeof window === 'undefined' || typeof Observer !== 'function') return;
    try {
      const observer = new Observer(list => {
        if (this.measurement !== measurement) return;
        for (const entry of list.getEntries()) {
          measurement.longTasks.push({
            source: 'performanceObserver',
            startTime: rounded(Number(entry.startTime) || 0),
            duration: rounded(Number(entry.duration) || 0)
          });
        }
        this.metrics.longTaskCount = measurement.longTasks.length;
      });
      observer.observe({ type: 'longtask', buffered: true });
      this._longTaskObserver = observer;
    } catch (_) {
      // 浏览器或策略不支持 longtask 时，帧时间样本仍提供卡顿证据。
    }
  }

  _disconnectLongTaskObserver() {
    this._longTaskObserver?.disconnect?.();
    this._longTaskObserver = null;
  }

  _captureMemorySample(measurement) {
    if (this.measurement !== measurement) return;
    const memory = globalThis.performance?.memory;
    const sample = { capturedAt: rounded(now() - measurement.startedAt) };
    if (Number.isFinite(memory?.usedJSHeapSize)) {
      sample.usedJsHeapMb = rounded(memory.usedJSHeapSize / MB);
      if (Number.isFinite(memory.totalJSHeapSize)) sample.totalJsHeapMb = rounded(memory.totalJSHeapSize / MB);
      if (Number.isFinite(memory.jsHeapSizeLimit)) sample.jsHeapLimitMb = rounded(memory.jsHeapSizeLimit / MB);
    }
    if (Object.keys(sample).length > 1) measurement.memorySamples.push(sample);
    this._captureUaSpecificMemory(measurement);
  }

  _captureUaSpecificMemory(measurement) {
    const measure = globalThis.performance?.measureUserAgentSpecificMemory;
    if (typeof measure !== 'function' || this._memoryRequestInFlight) return;
    this._memoryRequestInFlight = true;
    Promise.resolve()
      .then(() => measure.call(globalThis.performance))
      .then(result => {
        if (this.measurement !== measurement || !Number.isFinite(result?.bytes)) return;
        measurement.memorySamples.push({
          capturedAt: rounded(now() - measurement.startedAt),
          userAgentSpecificMb: rounded(result.bytes / MB)
        });
      })
      .catch(() => {
        // 该 API 需要浏览器权限；不可用不是低内存证明。
      })
      .finally(() => { this._memoryRequestInFlight = false; });
  }

  _recordMeasurementFrame(frameTime, gameState) {
    const measurement = this.measurement;
    if (!measurement || measurement.status !== 'running' || !Number.isFinite(frameTime) || frameTime < 0) return;
    if (measurement.frameTimes.length >= measurement.maxSamples) {
      measurement.droppedFrameSamples++;
      return;
    }
    measurement.frameTimes.push(frameTime);
    measurement.entityCounts.push(Number(gameState.entityCount) || 0);
    measurement.drawCalls.push(Number(gameState.drawCallsPerFrame ?? gameState.drawCalls) || 0);
    if (frameTime >= measurement.longTaskThresholdMs) {
      measurement.longTasks.push({ source: 'frameTime', startTime: rounded(now() - measurement.startedAt), duration: rounded(frameTime) });
      this.metrics.longTaskCount = measurement.longTasks.length;
    }
    if (measurement.frameTimes.length % measurement.memorySampleEveryFrames === 0) this._captureMemorySample(measurement);
  }

  startTimer(name) {
    if (!this.enabled && this.measurement?.status !== 'running') return;
    this.timers.set(name, now());
  }

  endTimer(name) {
    if (!this.enabled && this.measurement?.status !== 'running') return 0;
    const startTime = this.timers.get(name);
    if (startTime === undefined) return 0;
    const elapsed = now() - startTime;
    this.timers.delete(name);
    return elapsed;
  }

  update(deltaTime, gameState = {}) {
    const isMeasuring = this.measurement?.status === 'running';
    if (!this.enabled && !isMeasuring) return;
    const frameTime = Math.max(0, Number(deltaTime) || 0) * 1000;
    this.frameCount++;
    this.frameTimes.push(frameTime);
    if (this.frameTimes.length > this.maxFrameTimeSamples) this.frameTimes.shift();
    this.lastUpdateTime += Math.max(0, Number(deltaTime) || 0);
    let metricsUpdated = false;
    if (this.lastUpdateTime >= this.updateInterval) {
      this.metrics.fps = Math.round(this.frameCount / this.lastUpdateTime);
      this.metrics.frameTime = average(this.frameTimes);
      this.history.fps.push(this.metrics.fps);
      this.history.frameTime.push(this.metrics.frameTime);
      if (this.history.fps.length > this.history.maxHistoryLength) {
        this.history.fps.shift();
        this.history.frameTime.shift();
      }
      this.frameCount = 0;
      this.lastUpdateTime = 0;
      this._metricsRevision++;
      metricsUpdated = true;
    }
    for (const key of [
      'entityCount', 'visibleEntityCount', 'drawCalls', 'drawCallsPerFrame', 'textureMemory',
      'particleCount', 'poolStats', 'updateTime', 'renderTime'
    ]) {
      if (gameState[key] !== undefined) this.metrics[key] = gameState[key];
    }
    const usedHeapSize = globalThis.performance?.memory?.usedJSHeapSize;
    if (Number.isFinite(usedHeapSize)) this.metrics.memoryUsage = Math.round(usedHeapSize / MB);
    this._recordMeasurementFrame(frameTime, gameState);
    // 1% low 需要排序样本，只随 HUD 指标刷新周期计算，不进入每帧热路径。
    if (metricsUpdated && this.measurement) {
      const snapshot = this.getMeasurementSnapshot();
      if (snapshot) {
        this.metrics.onePercentLowFps = snapshot.frame.onePercentLowFps;
        this.metrics.longTaskCount = snapshot.longTasks.count;
      }
    }
  }

  getMeasurementSnapshot() {
    const measurement = this.measurement;
    if (!measurement) return null;
    const frameTimes = measurement.frameTimes;
    const frameTotal = frameTimes.reduce((total, value) => total + value, 0);
    const sorted = frameTimes.slice().sort((left, right) => left - right);
    const worstCount = Math.max(1, Math.ceil(sorted.length * 0.01));
    const worstOnePercent = sorted.slice(Math.max(0, sorted.length - worstCount));
    const usedHeap = measurement.memorySamples
      .map(sample => sample.userAgentSpecificMb ?? sample.usedJsHeapMb)
      .filter(Number.isFinite);
    const durationMs = (measurement.endedAt ?? now()) - measurement.startedAt;
    return {
      status: measurement.status,
      metadata: clone(measurement.metadata),
      sample: {
        startedAt: measurement.startedAt,
        endedAt: measurement.endedAt,
        durationMs: rounded(Math.max(0, durationMs)),
        droppedFrameSamples: measurement.droppedFrameSamples
      },
      frame: {
        count: frameTimes.length,
        averageFps: frameTotal > 0 ? rounded(frameTimes.length * 1000 / frameTotal) : 0,
        onePercentLowFps: worstOnePercent.length ? rounded(1000 / average(worstOnePercent)) : 0,
        averageFrameTimeMs: rounded(average(frameTimes)),
        p99FrameTimeMs: sorted.length ? rounded(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1)]) : 0,
        maxFrameTimeMs: sorted.length ? rounded(sorted[sorted.length - 1]) : 0,
        activeEntityMin: measurement.entityCounts.length ? Math.min(...measurement.entityCounts) : 0,
        activeEntityMax: measurement.entityCounts.length ? Math.max(...measurement.entityCounts) : 0,
        drawCallsAverage: rounded(average(measurement.drawCalls)),
        drawCallsMax: measurement.drawCalls.length ? Math.max(...measurement.drawCalls) : 0
      },
      memory: {
        sampleCount: measurement.memorySamples.length,
        peakMb: usedHeap.length ? rounded(Math.max(...usedHeap)) : null,
        samples: clone(measurement.memorySamples)
      },
      longTasks: {
        count: measurement.longTasks.length,
        maxDurationMs: measurement.longTasks.length
          ? rounded(Math.max(...measurement.longTasks.map(task => task.duration)))
          : 0,
        entries: clone(measurement.longTasks)
      }
    };
  }

  render(_ctx) {
    if (!this.enabled || typeof document === 'undefined') return;
    if (this._renderedMetricsRevision === this._metricsRevision) return;
    if (!this._fpsElement || this._fpsElement.isConnected === false) {
      this._fpsElement = document.getElementById('fps');
    }
    const fpsEl = this._fpsElement;
    if (!fpsEl) return;
    const text = String(this.metrics.fps);
    const color = this.metrics.fps >= 50 ? '#4CAF50' : (this.metrics.fps >= 30 ? '#FFC107' : '#F44336');
    if (text !== this._lastFpsText) {
      fpsEl.textContent = text;
      this._lastFpsText = text;
    }
    if (color !== this._lastFpsColor) {
      fpsEl.style.color = color;
      this._lastFpsColor = color;
    }
    this._renderedMetricsRevision = this._metricsRevision;
  }

  getDisplayLines() {
    const lines = [
      { label: 'FPS:', metric: 'fps', value: this.metrics.fps.toString() },
      { label: 'Frame Time:', metric: 'frameTime', value: this.metrics.frameTime.toFixed(2) + ' ms' },
      { label: 'Update Time:', metric: 'updateTime', value: this.metrics.updateTime.toFixed(2) + ' ms' },
      { label: 'Render Time:', metric: 'renderTime', value: this.metrics.renderTime.toFixed(2) + ' ms' },
      { label: 'Entities:', metric: 'entityCount', value: this.metrics.entityCount.toString() },
      { label: 'Visible:', metric: 'visibleEntityCount', value: this.metrics.visibleEntityCount.toString() },
      { label: 'Draw Calls:', metric: 'drawCalls', value: this.metrics.drawCalls.toString() },
      { label: 'Draw/Frame:', metric: 'drawCallsPerFrame', value: this.metrics.drawCallsPerFrame.toString() },
      { label: 'Tex Memory:', metric: 'textureMemory', value: this._formatBytes(this.metrics.textureMemory) },
      { label: 'Particles:', metric: 'particleCount', value: this.metrics.particleCount.toString() }
    ];
    if (this.metrics.memoryUsage > 0) lines.push({ label: 'Memory:', metric: 'memoryUsage', value: this.metrics.memoryUsage + ' MB' });
    return lines;
  }

  getColorForMetric(metric, value) {
    if (metric !== 'fps') return '#4CAF50';
    const fps = parseInt(value, 10);
    return fps >= 55 ? '#4CAF50' : (fps >= 30 ? '#FFC107' : '#F44336');
  }

  renderGraph(ctx, x, y) {
    const width = this.graphWidth;
    const height = this.graphHeight;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, height);
    if (this.history.fps.length > 1) {
      ctx.strokeStyle = '#4CAF50';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const step = width / (this.history.maxHistoryLength - 1);
      for (let index = 0; index < this.history.fps.length; index++) {
        const graphX = x + index * step;
        const graphY = y + height - (Math.min(this.history.fps[index], 60) / 60) * height;
        if (index === 0) ctx.moveTo(graphX, graphY);
        else ctx.lineTo(graphX, graphY);
      }
      ctx.stroke();
    }
  }

  toggleGraph() {
    this.showGraph = !this.showGraph;
  }

  getMetrics() {
    return { ...this.metrics };
  }

  reset() {
    this.stopMeasurement();
    this.frameCount = 0;
    this.lastUpdateTime = 0;
    this.frameTimes = [];
    this.history.fps = [];
    this.history.frameTime = [];
    this.timers.clear();
    this._metricsRevision++;
    this._renderedMetricsRevision = -1;
  }

  exportData() {
    return {
      metrics: this.getMetrics(),
      history: { fps: [...this.history.fps], frameTime: [...this.history.frameTime] },
      measurement: this.getMeasurementSnapshot(),
      timestamp: Date.now()
    };
  }

  logToConsole() {
    console.group('Performance Metrics');
    console.table(this.getMetrics());
    if (this.measurement) Logger.log('Measurement:', this.getMeasurementSnapshot());
    console.groupEnd();
  }

  dispose() {
    this.stopMeasurement();
    this.timers.clear();
    this._fpsElement = null;
  }

  _formatBytes(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < MB) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / MB).toFixed(1) + ' MB';
  }
}
