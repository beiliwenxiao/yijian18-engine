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

import { describe, it, expect, beforeEach } from 'vitest';
import { FlightSystem } from './FlightSystem.js';
import { TransformComponent } from '../ecs/components/TransformComponent.js';
import { LayerComponent } from '../ecs/components/LayerComponent.js';

function makePlayerEntity(x = 0, y = 0) {
  const transform = new TransformComponent(x, y);
  const layer = new LayerComponent({ worldLayer: 'entity' });
  return {
    id: 'p1',
    getComponent(name) {
      if (name === 'transform') return transform;
      if (name === 'layer') return layer;
      return null;
    }
  };
}

describe('FlightSystem - elevation 化', () => {
  let fs;

  beforeEach(() => {
    fs = new FlightSystem({});
    // 覆盖默认参数让测试更可控
    fs.config.chargeDuration = 0.1;
    fs.config.flyDuration = 0.1;
    fs.config.landDuration = 0.1;
    fs.config.peakHeight = 100;
  });

  it('起飞时把 LayerComponent 切到 aerial', () => {
    const player = makePlayerEntity(0, 0);
    fs.startFlight(player, 200, 0);
    expect(player.getComponent('layer').worldLayer).toBe('aerial');
  });

  it('飞行中 elevation 应呈现正弦弧线（中段最高）', () => {
    const player = makePlayerEntity(0, 0);
    fs.startFlight(player, 200, 0);

    // 经过蓄力阶段（0.1s）
    fs.update(0.1, player);
    expect(fs.flyingData?.phase).toBe('fly');

    // 飞行中段（progress ~ 0.5）
    fs.update(0.05, player);
    const midElevation = player.getComponent('transform').position.elevation;
    expect(midElevation).toBeGreaterThan(50);  // 半程应该接近 peakHeight
    expect(midElevation).toBeLessThanOrEqual(100);
  });

  it('完整过一轮飞行后，elevation 归零且 layer 恢复', () => {
    const player = makePlayerEntity(0, 0);
    fs.startFlight(player, 200, 0);

    // 蓄力 0.1s → fly 阶段
    fs.update(0.1, player);
    // 飞行 0.1s → land 阶段
    fs.update(0.1, player);
    // 落地 0.1s → 结束
    fs.update(0.1, player);

    expect(fs.isFlying).toBe(false);
    expect(player.getComponent('transform').position.elevation).toBe(0);
    expect(player.getComponent('layer').worldLayer).toBe('entity');
  });

  it('cancelFlight 中途取消也恢复 elevation / layer', () => {
    const player = makePlayerEntity(0, 0);
    fs.startFlight(player, 200, 0);
    fs.update(0.1, player); // charge done
    fs.update(0.05, player); // mid-fly

    fs.cancelFlight(player);
    expect(fs.isFlying).toBe(false);
    expect(player.getComponent('transform').position.elevation).toBe(0);
    expect(player.getComponent('layer').worldLayer).toBe('entity');
  });

  it('飞行不修改 sprite.offsetY（仅 elevation）', () => {
    const player = makePlayerEntity(0, 0);
    fs.startFlight(player, 200, 0);
    fs.update(0.1, player);
    fs.update(0.05, player);
    const t = player.getComponent('transform');
    // position.y 不再被当成"视觉 Y"，仍是地面坐标
    expect(t.position.y).toBeGreaterThanOrEqual(0);
    expect(t.position.y).toBeLessThanOrEqual(0); // startY=0, targetY=0 所以线性插值也 0
  });
});
