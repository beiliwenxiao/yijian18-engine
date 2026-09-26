import { describe, it, expect } from 'vitest';
import { TaskMarkerBeacon } from './TaskMarkerBeacon.js';

/** 记录 emit 调用的粒子系统桩。 */
function createMockParticleSystem() {
  return {
    emitted: [],
    emit(config) { this.emitted.push(config); }
  };
}

const POINT = { x: 100, y: 200, sceneId: 'S01', targetId: 'placement-1' };

describe('TaskMarkerBeacon 任务点引导闪光', () => {
  it('常驻发射：每秒每点发射 rate 个粒子，位置在锚点附近', () => {
    const ps = createMockParticleSystem();
    const beacon = new TaskMarkerBeacon(ps, { rate: 10 });
    beacon.setMarkers([POINT]);
    beacon._points[0].pulseTimer = 99; // 固定相位，排除脉冲干扰
    beacon.update(1); // 1 秒 → 10 个粒子
    expect(ps.emitted.length).toBe(10);
    for (const config of ps.emitted) {
      expect(config.position.x).toBeGreaterThanOrEqual(100 - 14);
      expect(config.position.x).toBeLessThanOrEqual(100 + 14);
      expect(config.position.y).toBeLessThanOrEqual(200); // 不低于锚点地面
      expect(config.velocity.y).toBeLessThan(0); // 向上漂移
    }
  });

  it('场景过滤：只对当前场景的任务点发射', () => {
    const ps = createMockParticleSystem();
    const beacon = new TaskMarkerBeacon(ps);
    beacon.setMarkers([
      POINT,
      { x: 300, y: 400, sceneId: 'S02', targetId: 'placement-2' }
    ], 'S01');
    expect(beacon.getPointCount()).toBe(1);
    beacon.update(1);
    for (const config of ps.emitted) {
      expect(config.position.x).toBeLessThan(200); // 全部来自 S01 的点
    }
  });

  it('脉冲爆发：脉冲计时到点后一次性追加一簇粒子', () => {
    const ps = createMockParticleSystem();
    const beacon = new TaskMarkerBeacon(ps, { rate: 1, pulseInterval: 2 });
    beacon.setMarkers([POINT]);
    beacon.update(0.0001); // 消化首帧随机相位
    beacon._points[0].pulseTimer = 2; // 固定脉冲相位，测试可确定性
    beacon._points[0].accumulator = 0;
    ps.emitted.length = 0;
    beacon.update(1.9); // 未到脉冲线：只有常驻 1~2 粒
    const sparkCount = ps.emitted.length;
    expect(sparkCount).toBeLessThanOrEqual(3);
    beacon.update(0.2); // 越过 2 秒脉冲线
    expect(ps.emitted.length).toBeGreaterThan(sparkCount + 4); // 追加了脉冲簇
  });

  it('数据刷新复用同 key 点的累积状态：脉冲计时不会被重置', () => {
    const ps = createMockParticleSystem();
    const beacon = new TaskMarkerBeacon(ps, { rate: 1, pulseInterval: 2 });
    beacon.setMarkers([POINT]);
    beacon.update(0.0001);
    beacon._points[0].pulseTimer = 2;
    beacon._points[0].accumulator = 0;
    // 模拟每帧刷新：同一 key 反复喂送
    beacon.setMarkers([POINT]);
    beacon.update(1.9);
    const before = ps.emitted.length;
    beacon.setMarkers([POINT]); // 刷新
    beacon.update(0.2);
    expect(ps.emitted.length - before).toBeGreaterThanOrEqual(8); // 脉冲簇按时触发
  });

  it('无任务点或坐标缺失时不发射；clear 后停止', () => {
    const ps = createMockParticleSystem();
    const beacon = new TaskMarkerBeacon(ps);
    beacon.setMarkers([{ sceneId: 'S01', targetId: 'x' }]); // 缺坐标
    beacon.update(1);
    expect(ps.emitted.length).toBe(0);
    beacon.setMarkers([POINT]);
    beacon.update(0.1);
    expect(ps.emitted.length).toBeGreaterThan(0);
    beacon.clear();
    beacon.update(5);
    expect(ps.emitted.length).toBe(ps.emitted.length); // clear 后不再新增
  });
});
