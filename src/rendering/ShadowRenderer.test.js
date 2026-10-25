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

import { describe, it, expect, vi } from 'vitest';
import { ShadowRenderer } from './ShadowRenderer.js';

/** 离屏 Canvas 工厂假件：2d 上下文只记录渐变 stop，不真正光栅化。 */
function createFakeCanvasFactory() {
  const canvases = [];
  const factory = () => {
    const stops = [];
    const gradientLike = () => ({ addColorStop: (offset, color) => stops.push({ offset, color }) });
    const canvas = {
      width: 0,
      height: 0,
      recordedStops: stops,
      getContext: vi.fn(() => ({
        createRadialGradient: vi.fn(gradientLike),
        createLinearGradient: vi.fn(gradientLike),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
        bezierCurveTo: vi.fn(),
        ellipse: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        set fillStyle(value) { void value; },
        set globalAlpha(value) { void value; },
        get globalAlpha() { return 1; },
        fillRect: vi.fn()
      }))
    };
    canvases.push(canvas);
    return canvas;
  };
  factory.canvases = canvases;
  return factory;
}

/** 绘制命令记录用假 ctx。 */
function createFakeCtx() {
  const drawCalls = [];
  return {
    drawCalls,
    globalAlpha: 1,
    save: vi.fn(),
    restore: vi.fn(),
    drawImage: vi.fn((...args) => drawCalls.push(args))
  };
}

function createEntity(overrides = {}) {
  const components = new Map(overrides.components || []);
  return {
    id: overrides.id || 'e1',
    type: overrides.type || 'player',
    active: overrides.active !== false,
    isCorpse: overrides.isCorpse === true,
    isSoulState: overrides.isSoulState === true,
    getComponent: name => components.get(name) || null
  };
}

function spriteComponent(overrides = {}) {
  return { visible: true, width: 48, height: 64, scale: 1, ...overrides };
}

function transformComponent(overrides = {}) {
  return { position: { x: 500, y: 500, elevation: 0 }, ...overrides };
}

describe('ShadowRenderer resolveLighting', () => {
  it('缺省配置回退内置默认光照', () => {
    const renderer = new ShadowRenderer({ createCanvas: createFakeCanvasFactory() });
    const light = renderer.resolveLighting(null);
    expect(light.elevation).toBeCloseTo(0.72);
    expect(light.strength).toBeCloseTo(0.9);
    expect(Math.hypot(light.directionX, light.directionY)).toBeCloseTo(1);
    expect(light.pointLights).toEqual([]);
  });

  it('方向向量被归一化，非法点光源被过滤', () => {
    const renderer = new ShadowRenderer({ createCanvas: createFakeCanvasFactory() });
    const light = renderer.resolveLighting({
      directionX: 3,
      directionY: 4,
      elevation: 2,
      strength: -1,
      pointLights: [
        { x: 10, y: 20, radius: 200, strength: 0.9 },
        { x: NaN, y: 20, radius: 200 },
        { x: 1, y: 2, radius: 0 }
      ]
    });
    expect(light.directionX).toBeCloseTo(0.6);
    expect(light.directionY).toBeCloseTo(0.8);
    expect(light.elevation).toBe(1);
    expect(light.strength).toBe(0);
    expect(light.pointLights).toHaveLength(1);
    expect(light.pointLights[0]).toMatchObject({ x: 10, y: 20, radius: 200, strength: 0.9 });
  });
});

describe('ShadowRenderer computeShadowParams', () => {
  const renderer = new ShadowRenderer({ createCanvas: createFakeCanvasFactory() });

  it('正头顶光（elevation=1）影子几乎无偏移、贴近脚下', () => {
    const params = renderer.computeShadowParams(100, 100, 48, 64, 0, {
      directionX: -0.6, directionY: -0.8, elevation: 1, strength: 0.4, pointLights: []
    });
    expect(params.x).toBeCloseTo(100, 5);
    expect(params.y).toBeCloseTo(100, 5);
    expect(params.alpha).toBeCloseTo(0.4, 5);
    expect(params.longShadow).toBeNull();
  });

  it('斜射光影子朝光源反方向偏移，且偏移量随仰角降低而增大', () => {
    const highLight = { directionX: 1, directionY: 0, elevation: 0.8, strength: 0.32, pointLights: [] };
    const lowLight = { directionX: 1, directionY: 0, elevation: 0.2, strength: 0.32, pointLights: [] };
    const high = renderer.computeShadowParams(0, 0, 48, 64, 0, highLight);
    const low = renderer.computeShadowParams(0, 0, 48, 64, 0, lowLight);
    // 光从东来（+x），影子朝西（-x）偏
    expect(high.x).toBeLessThan(0);
    expect(low.x).toBeLessThan(high.x);
    expect(high.longShadow).toBeNull();
  });

  it('点光源半径内：贴地影背光偏移 + 双层影（贴地影变淡、长影按身高拉出）', () => {
    const light = {
      directionX: 0, directionY: 0, elevation: 1, strength: 0.32,
      pointLights: [{ x: 400, y: 500, radius: 200, strength: 1 }]
    };
    const near = renderer.computeShadowParams(500, 500, 48, 64, 0, light);
    const far = renderer.computeShadowParams(900, 500, 48, 64, 0, light);
    // 光源在西侧，近处实体影子朝东（+x）偏；远处实体不受点光影响（正顶光无偏移）
    expect(near.x).toBeGreaterThan(500);
    expect(far.x).toBeCloseTo(900, 5);
    // 锚定语义：脚底(500)必须落在椭圆跨度之内（中心偏移 ≤ 长半轴），而不是椭圆边缘之外
    expect(Math.abs(near.x - 500)).toBeLessThan(near.radiusX);
    expect(near.x - near.radiusX).toBeLessThan(500);
    // 双层影：近处实体产生背光长影（锥形，沿火-人连线发散），远处实体没有
    expect(far.longShadow).toBeNull();
    const ls = near.longShadow;
    expect(ls).not.toBeNull();
    // 长影朝光源平移，但近端不越过基础影中心 65% 半径：
    // 沿光-人连线（正东）的基础影半径 = radiusX=28.224 → shift = min(32, 28.224×0.65=18.35)
    // 锚点 x = 500 - 18.35 = 481.65（长影近端藏在基础影内，与基础影无缝衔接）
    expect(ls.x).toBeCloseTo(481.65, 1);
    expect(ls.y).toBe(500);
    expect(ls.angle).toBeCloseTo(0, 5);
    // 长影长度 ∝ 身高 × 点光权重：dist=100/radius=200 → weight 0.5 → 64×3.4×0.5=108.8
    expect(ls.length).toBeCloseTo(108.8, 1);
    // 发散高与长度等比锁定：108.8×1.2=130.56（近端窄、远端宽的卵形）
    expect(ls.height).toBeCloseTo(130.56, 1);
    // 贴地影因点光变淡：0.32 × (1 - 0.65×0.5) = 0.216
    expect(near.alpha).toBeCloseTo(0.216, 3);
    expect(near.alpha).toBeGreaterThan(ls.alpha); // 长影仍比贴地影淡（0.32×0.85×0.5=0.136）
  });

  it('点光源本体（光心严格重合的火堆实体）无长影、贴地影不被自身点光淡化', () => {
    const light = {
      directionX: 0, directionY: 0, elevation: 1, strength: 0.32,
      pointLights: [{ x: 400, y: 500, radius: 200, strength: 1 }]
    };
    // 实体与光心严格重合（dist<2px）→ 跳过点光效应：无长影、无变淡、无偏移
    const selfShadow = renderer.computeShadowParams(400, 500, 48, 64, 0, light);
    expect(selfShadow.longShadow).toBeNull();
    expect(selfShadow.alpha).toBeCloseTo(0.32, 5);
    expect(selfShadow.x).toBeCloseTo(400, 5);
    // 其他实体再近（15px）也保留点光效应：长影不消失且接近最长
    const adjacent = renderer.computeShadowParams(415, 500, 48, 64, 0, light);
    expect(adjacent.longShadow).not.toBeNull();
    expect(adjacent.longShadow.length).toBeGreaterThan(64 * 2.5);
  });

  it('跳跃时影子留在地面并缩小变淡', () => {
    const light = { directionX: -0.6, directionY: -0.8, elevation: 0.72, strength: 0.32, pointLights: [] };
    const grounded = renderer.computeShadowParams(0, 0, 48, 64, 0, light);
    const airborne = renderer.computeShadowParams(0, 0, 48, 64, 80, light);
    expect(airborne.y).toBeCloseTo(grounded.y, 5);
    expect(airborne.radiusX).toBeLessThan(grounded.radiusX);
    expect(airborne.alpha).toBeLessThan(grounded.alpha);
  });
});

describe('ShadowRenderer renderEntityShadows', () => {
  it('所有带可见 sprite 的实体都画影子（含道具/尸体），跳过灵魂/隐藏/出界实体', () => {
    const renderer = new ShadowRenderer({ createCanvas: createFakeCanvasFactory() });
    const ctx = createFakeCtx();
    const viewBounds = { left: 0, top: 0, right: 1280, height: undefined, bottom: 720 };
    const entities = [
      createEntity({ id: 'player', type: 'player', components: new Map([['sprite', spriteComponent()], ['transform', transformComponent()]]) }),
      createEntity({ id: 'npc', type: 'npc', components: new Map([['sprite', spriteComponent()], ['transform', transformComponent({ position: { x: 200, y: 300, elevation: 0 } })]]) }),
      createEntity({ id: 'enemy', type: 'enemy', components: new Map([['sprite', spriteComponent()], ['transform', transformComponent({ position: { x: 300, y: 400, elevation: 0 } })]]) }),
      createEntity({ id: 'loot', type: 'loot', components: new Map([['sprite', spriteComponent()], ['transform', transformComponent()]]) }),
      createEntity({ id: 'node', type: 'resourceNode', components: new Map([['sprite', spriteComponent()], ['transform', transformComponent()]]) }),
      createEntity({ id: 'corpse', type: 'enemy', isCorpse: true, components: new Map([['sprite', spriteComponent()], ['transform', transformComponent()]]) }),
      createEntity({ id: 'soul', type: 'player', isSoulState: true, components: new Map([['sprite', spriteComponent()], ['transform', transformComponent()]]) }),
      createEntity({ id: 'hidden', type: 'npc', components: new Map([['sprite', spriteComponent({ visible: false })], ['transform', transformComponent()]]) }),
      createEntity({ id: 'offscreen', type: 'enemy', components: new Map([['sprite', spriteComponent()], ['transform', transformComponent({ position: { x: 5000, y: 5000, elevation: 0 } })]]) }),
      createEntity({ id: 'inactive', type: 'enemy', active: false, components: new Map([['sprite', spriteComponent()], ['transform', transformComponent()]]) })
    ];
    renderer.renderEntityShadows(ctx, entities, { viewBounds, lighting: null });
    // player / npc / enemy / loot / resourceNode / corpse 六个可见在场实体各画一次
    // （尸体与道具/采集点不再被类型门槛跳过；灵魂/隐藏/出界/失活仍跳过）
    expect(ctx.drawImage).toHaveBeenCalledTimes(6);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
    // 默认光从左上来（directionY=-0.8）→ 影子朝南偏：底边落在脚底（y=500）之下
    const playerCall = ctx.drawCalls[0];
    expect(playerCall[2] + playerCall[4]).toBeGreaterThan(500); // dy + dh == 影子底边 y
    // 普通物品（loot/resourceNode）影子上移 1/3 影高：中心在脚底（y=500）上方
    const lootCall = ctx.drawCalls[3]; // 绘制顺序：player, npc, enemy, loot, node, corpse
    const lootCenterY = lootCall[2] + lootCall[4] / 2;
    expect(lootCenterY).toBeLessThan(500);
    // 角色类型（corpse 也是 enemy）不偏移：底边仍在脚底之下
    const corpseCall = ctx.drawCalls[5];
    expect(corpseCall[2] + corpseCall[4]).toBeGreaterThan(500);
  });

  it('shadowProfile.scale/liftPx 调节物品影子大小与上移量', () => {
    const renderer = new ShadowRenderer({ createCanvas: createFakeCanvasFactory() });
    const mk = (id, profile) => {
      const entity = createEntity({ id, type: 'prop', components: new Map([['sprite', spriteComponent()], ['transform', transformComponent()]]) });
      entity.shadowProfile = profile;
      return entity;
    };
    // 基准：prop 未配置时默认上移 1/3 影高（中心上移到脚底上方）
    const ctxBase = createFakeCtx();
    renderer.renderEntityShadows(ctxBase, [mk('base', undefined)], { viewBounds: null, lighting: null });
    const base = ctxBase.drawCalls[0];
    expect(base[2] + base[4] / 2).toBeLessThan(500);
    // scale=2：影子宽高翻倍；liftPx=0：不上移（中心回到脚底南方）
    const ctxBig = createFakeCtx();
    renderer.renderEntityShadows(ctxBig, [mk('big', { scale: 2, liftPx: 0 })], { viewBounds: null, lighting: null });
    const big = ctxBig.drawCalls[0];
    expect(big[3]).toBeCloseTo(base[3] * 2, 5);
    expect(big[4]).toBeCloseTo(base[4] * 2, 5);
    expect(big[2] + big[4] / 2).toBeGreaterThan(500);
    // liftPx 是像素值：上移量固定，不随影子大小缩放（scale=2 时上移仍是 10px）
    const ctxLift = createFakeCtx();
    renderer.renderEntityShadows(ctxLift, [mk('lift', { scale: 2, liftPx: 10 })], { viewBounds: null, lighting: null });
    const lifted = ctxLift.drawCalls[0];
    // 基准（无 shadowProfile）默认上移 1/3 影高；liftPx 是像素值，上移量固定不随影子大小缩放
    expect((base[2] + base[4] / 2) - (lifted[2] + lifted[4] / 2)).toBeCloseTo(10 - base[4] / 3, 5);
    // 旧数据兼容：比例字段 lift 仍按影高折算（lift:1 = 上移满影高）
    // 注意椭圆中心本身含光照锚点偏移，故与同尺寸 lift:0 的样本相减后再比影高
    const ctxZero = createFakeCtx();
    renderer.renderEntityShadows(ctxZero, [mk('zero', { lift: 0 })], { viewBounds: null, lighting: null });
    const zero = ctxZero.drawCalls[0];
    const ctxLegacy = createFakeCtx();
    renderer.renderEntityShadows(ctxLegacy, [mk('legacy', { lift: 1 })], { viewBounds: null, lighting: null });
    const legacy = ctxLegacy.drawCalls[0];
    expect((zero[2] + zero[4] / 2) - (legacy[2] + legacy[4] / 2)).toBeCloseTo(legacy[4], 5);
    // radius=60：横半径直接替换（直径 120），纵半径按椭圆扁率跟随
    const ctxFixed = createFakeCtx();
    renderer.renderEntityShadows(ctxFixed, [mk('fixed', { radius: 60 })], { viewBounds: null, lighting: null });
    const fixed = ctxFixed.drawCalls[0];
    expect(fixed[3]).toBeCloseTo(120, 1);
    expect(fixed[4]).toBeLessThan(fixed[3]); // 纵向仍为扁椭圆
    expect(fixed[3]).toBeGreaterThan(base[3]); // 60 > 自动推导的横半径
  });

  it('实体列表为空时不触碰上下文', () => {
    const renderer = new ShadowRenderer({ createCanvas: createFakeCanvasFactory() });
    const ctx = createFakeCtx();
    renderer.renderEntityShadows(ctx, [], { viewBounds: null, lighting: null });
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});
