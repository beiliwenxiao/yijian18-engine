/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PerformanceMonitor } from './PerformanceMonitor.js';

describe('PerformanceMonitor', () => {
  let monitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor({ enabled: true });
  });

  it('应该正确初始化', () => {
    expect(monitor.enabled).toBe(true);
    expect(monitor.metrics.fps).toBe(0);
    expect(monitor.metrics.frameTime).toBe(0);
  });

  it('应该能够启用和禁用', () => {
    monitor.setEnabled(false);
    expect(monitor.enabled).toBe(false);
    
    monitor.setEnabled(true);
    expect(monitor.enabled).toBe(true);
  });

  it('应该能够切换显示状态', () => {
    const initialState = monitor.enabled;
    monitor.toggle();
    expect(monitor.enabled).toBe(!initialState);
  });

  it('应该能够开始和结束计时', () => {
    monitor.startTimer('test');
    expect(monitor.timers.has('test')).toBe(true);
    
    const elapsed = monitor.endTimer('test');
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(monitor.timers.has('test')).toBe(false);
  });

  it('应该能够更新性能指标', () => {
    const gameState = {
      entityCount: 100,
      visibleEntityCount: 50,
      drawCalls: 25,
      particleCount: 200
    };
    
    monitor.update(0.016, gameState);
    
    expect(monitor.metrics.entityCount).toBe(100);
    expect(monitor.metrics.visibleEntityCount).toBe(50);
    expect(monitor.metrics.drawCalls).toBe(25);
    expect(monitor.metrics.particleCount).toBe(200);
  });

  it('应该能够计算 FPS', () => {
    // 模拟 60 帧
    for (let i = 0; i < 60; i++) {
      monitor.update(0.016, {});
    }
    
    // FPS 应该接近 60
    expect(monitor.metrics.fps).toBeGreaterThan(50);
    expect(monitor.metrics.fps).toBeLessThan(70);
  });

  it('应该能够记录帧时间历史', () => {
    monitor.update(0.016, {});
    monitor.update(0.017, {});
    monitor.update(0.015, {});
    
    expect(monitor.frameTimes.length).toBe(3);
  });

  it('应该限制历史数据长度', () => {
    // 添加超过最大长度的数据
    for (let i = 0; i < 150; i++) {
      monitor.update(0.5, {}); // 快速更新以触发历史记录
    }
    
    expect(monitor.history.fps.length).toBeLessThanOrEqual(monitor.history.maxHistoryLength);
  });

  it('应该能够获取性能指标', () => {
    const metrics = monitor.getMetrics();
    
    expect(metrics).toHaveProperty('fps');
    expect(metrics).toHaveProperty('frameTime');
    expect(metrics).toHaveProperty('entityCount');
  });

  it('应该能够重置性能监控', () => {
    monitor.update(0.016, { entityCount: 100 });
    monitor.startTimer('test');
    
    monitor.reset();
    
    expect(monitor.frameCount).toBe(0);
    expect(monitor.frameTimes.length).toBe(0);
    expect(monitor.history.fps.length).toBe(0);
    expect(monitor.timers.size).toBe(0);
  });

  it('应该能够导出性能数据', () => {
    monitor.update(0.016, { entityCount: 100 });
    
    const data = monitor.exportData();
    
    expect(data).toHaveProperty('metrics');
    expect(data).toHaveProperty('history');
    expect(data).toHaveProperty('timestamp');
  });

  it('应该能够切换图表显示', () => {
    const initialState = monitor.showGraph;
    monitor.toggleGraph();
    expect(monitor.showGraph).toBe(!initialState);
  });

  it('禁用时不应该记录计时器', () => {
    monitor.setEnabled(false);
    monitor.startTimer('test');
    
    expect(monitor.timers.size).toBe(0);
  });

  it('应该能够获取显示行', () => {
    monitor.metrics.fps = 60;
    monitor.metrics.entityCount = 100;
    
    const lines = monitor.getDisplayLines();
    
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toHaveProperty('label');
    expect(lines[0]).toHaveProperty('value');
  });

  it('应该根据 FPS 返回正确的颜色', () => {
    expect(monitor.getColorForMetric('fps', '60')).toBe('#4CAF50'); // 绿色
    expect(monitor.getColorForMetric('fps', '45')).toBe('#FFC107'); // 黄色
    expect(monitor.getColorForMetric('fps', '20')).toBe('#F44336'); // 红色
  });
});


describe('P6.2 实测采样', () => {
  let monitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor({ enabled: true });
  });

  it('显式采样会记录平均 FPS、1% low、实体下限和 draw calls', () => {
    monitor.startMeasurement({ sceneId: 'S11', maxSamples: 200, memorySampleEveryFrames: 1000 });
    for (let index = 0; index < 99; index++) {
      monitor.update(0.01, { entityCount: 100, drawCallsPerFrame: 12 });
    }
    monitor.update(0.04, { entityCount: 100, drawCallsPerFrame: 18 });

    const sample = monitor.stopMeasurement();
    expect(sample.status).toBe('completed');
    expect(sample.frame.count).toBe(100);
    expect(sample.frame.activeEntityMin).toBe(100);
    expect(sample.frame.averageFps).toBeGreaterThan(90);
    expect(sample.frame.onePercentLowFps).toBe(25);
    expect(sample.frame.drawCallsMax).toBe(18);
  });

  it('长帧会作为采样长任务保留，而非由平均 FPS 掩盖', () => {
    monitor.startMeasurement({ longTaskThresholdMs: 30, memorySampleEveryFrames: 1000 });
    monitor.update(0.05, { entityCount: 100 });

    const sample = monitor.stopMeasurement();
    expect(sample.longTasks.count).toBeGreaterThan(0);
    expect(sample.longTasks.entries[0]).toMatchObject({ source: 'frameTime', duration: 50 });
  });
});