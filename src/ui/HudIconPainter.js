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
 * HudIconPainter - HUD 功能按钮手绘风矢量图标绘制器
 *
 * 写实手绘风格：每个图标由「深色轮廓 + 材质渐变填充（皮革/钢铁/鎏金/木纹/
 * 火焰/冰晶）+ 受光高光 + 阴影层次」构成，线条带确定性手绘抖动，避免每帧
 * 闪烁。所有图标以图标盒中心为原点绘制，随按钮尺寸矢量缩放。
 *
 * 用法：
 *   HudIconPainter.draw(ctx, 'backpack', cx, cy, size)             // 常态
 *   HudIconPainter.draw(ctx, 'army', cx, cy, size, { brighten: 0.4 }) // hover 加亮
 *   HudIconPainter.has('backpack')                                 // 是否内置图标
 *
 * 图标命名与 IconButton.icon / SkillWheelOverlay 技能键对齐；
 * 未注册的名字返回 false，由调用方回退到 emoji/文本渲染。
 */

/* ---------- 基础工具 ---------- */

/** 确定性伪随机（-1..1）：手绘抖动用，禁止 Math.random（每帧闪烁）。 */
function wob(i) {
  return Math.sin(i * 127.1 + 311.7) * 0.5 + Math.sin(i * 269.5 + 74.7) * 0.5;
}

const _shadeCache = new Map();

/** 颜色加亮/压暗：t>0 向白靠拢（hover），t<0 向黑靠拢（阴影）。带缓存。 */
function shade(hex, t) {
  if (!t) return hex;
  const key = hex + '|' + t.toFixed(2);
  let v = _shadeCache.get(key);
  if (v) return v;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = t > 0
    ? c => Math.round(c + (255 - c) * t)
    : c => Math.round(c * (1 + t));
  v = `rgb(${f(r)},${f(g)},${f(b)})`;
  _shadeCache.set(key, v);
  return v;
}

function linGrad(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

function radGrad(ctx, x, y, r0, r1, stops) {
  const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

/** 圆角矩形路径。 */
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 手绘抖动折线（确定性）：pts 为 [x,y] 数组，amp 为抖动幅度（px）。 */
function handLine(ctx, pts, amp = 0.8) {
  ctx.moveTo(pts[0][0] + wob(1) * amp, pts[0][1] + wob(2) * amp);
  for (let i = 1; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    ctx.quadraticCurveTo(
      x1 + wob(i * 3) * amp, y1 + wob(i * 3 + 1) * amp,
      (x1 + x2) / 2 + wob(i * 5) * amp, (y1 + y2) / 2 + wob(i * 5 + 2) * amp
    );
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0] + wob(pts.length) * amp, last[1] + wob(pts.length + 1) * amp);
}

/** 顶部受光高光弧（通用装饰）。 */
function glossArc(ctx, x, y, r, a0, a1, lw, t, alpha = 0.3) {
  ctx.strokeStyle = `rgba(255,255,255,${alpha + t * 0.25})`;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, r, a0, a1);
  ctx.stroke();
}

/* ---------- 共用部件 ---------- */

const OUT_WARM = '#33220e';   // 暖材质深轮廓（皮革/木/金）
const OUT_STEEL = '#262b31';  // 钢铁深轮廓
const OUT_DARK = '#2e2114';   // 通用深轮廓

/**
 * 斜置长剑（army 交叉双剑 / attack 单剑共用）。
 * dir=+1：尖端朝右上；dir=-1：尖端朝左上。
 */
function sword(ctx, s, t, dir, lw) {
  const C = hex => shade(hex, t);
  const tip = { x: dir * 0.35 * s, y: -0.30 * s };
  const guard = { x: dir * 0.13 * s, y: 0.11 * s };
  const pom = { x: dir * 0.05 * s, y: 0.33 * s };
  // 刃轴（护手 → 尖端）
  let ax = tip.x - guard.x, ay = tip.y - guard.y;
  const alen = Math.hypot(ax, ay);
  ax /= alen; ay /= alen;
  const px = -ay, py = ax;
  const bx = f => guard.x + ax * alen * f;
  const by = f => guard.y + ay * alen * f;

  // 柄（先画，压在护手下）
  ctx.beginPath();
  ctx.moveTo(guard.x, guard.y);
  ctx.lineTo(pom.x, pom.y);
  ctx.strokeStyle = C('#4a2f16');
  ctx.lineWidth = 0.075 * s;
  ctx.lineCap = 'round';
  ctx.stroke();
  for (let i = 1; i <= 3; i++) {
    const f = i / 4;
    const wx = guard.x + (pom.x - guard.x) * f;
    const wy = guard.y + (pom.y - guard.y) * f;
    ctx.beginPath();
    ctx.moveTo(wx + px * 0.033 * s, wy + py * 0.033 * s);
    ctx.lineTo(wx - px * 0.033 * s, wy - py * 0.033 * s);
    ctx.strokeStyle = 'rgba(201,162,39,0.75)';
    ctx.lineWidth = lw * 0.6;
    ctx.stroke();
  }
  // 柄头
  ctx.beginPath();
  ctx.arc(pom.x, pom.y, 0.052 * s, 0, Math.PI * 2);
  ctx.fillStyle = linGrad(ctx, pom.x - 0.05 * s, pom.y - 0.05 * s, pom.x + 0.05 * s, pom.y + 0.05 * s,
    [[0, C('#ecc76e')], [1, C('#8a651c')]]);
  ctx.fill();
  ctx.strokeStyle = OUT_WARM;
  ctx.lineWidth = lw * 0.8;
  ctx.stroke();

  // 刃身（沿垂直向的柱面渐变模拟钢面反光）
  const half0 = 0.056 * s;
  ctx.beginPath();
  ctx.moveTo(bx(0) + px * half0, by(0) + py * half0);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(bx(0) - px * half0, by(0) - py * half0);
  ctx.closePath();
  ctx.fillStyle = linGrad(ctx,
    bx(0) + px * 0.056 * s, by(0) + py * 0.056 * s,
    bx(0) - px * 0.056 * s, by(0) - py * 0.056 * s,
    [[0, C('#f4f7fa')], [0.45, C('#c5ced6')], [1, C('#78828e')]]);
  ctx.fill();
  ctx.strokeStyle = OUT_STEEL;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // 血槽脊线高光
  ctx.beginPath();
  ctx.moveTo(bx(0.10) + px * 0.014 * s, by(0.10) + py * 0.014 * s);
  ctx.lineTo(bx(0.82), by(0.82));
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = lw * 0.5;
  ctx.stroke();

  // 护手（鎏金横杆）
  const gl = 0.125 * s, gt = 0.030 * s;
  ctx.beginPath();
  ctx.moveTo(guard.x + px * gl - ax * gt, guard.y + py * gl - ay * gt);
  ctx.lineTo(guard.x - px * gl - ax * gt, guard.y - py * gl - ay * gt);
  ctx.lineTo(guard.x - px * gl + ax * gt, guard.y - py * gl + ay * gt);
  ctx.lineTo(guard.x + px * gl + ax * gt, guard.y + py * gl + ay * gt);
  ctx.closePath();
  ctx.fillStyle = linGrad(ctx,
    guard.x + px * gl, guard.y + py * gl,
    guard.x - px * gl, guard.y - py * gl,
    [[0, C('#ecc76e')], [0.5, C('#c9a227')], [1, C('#8a651c')]]);
  ctx.fill();
  ctx.strokeStyle = OUT_WARM;
  ctx.lineWidth = lw * 0.8;
  ctx.stroke();
}

/* ---------- 十六个图标 ---------- */

const PAINTERS = {
  /** 背包：皮制行囊（皮革渐变 + 盖面缝线 + 鎏金方扣） */
  backpack(ctx, s, t, lw) {
    const C = hex => shade(hex, t);
    // 提手
    ctx.beginPath();
    ctx.moveTo(-0.14 * s, -0.22 * s);
    ctx.quadraticCurveTo(0 + wob(3) * s * 0.01, -0.44 * s, 0.14 * s, -0.22 * s);
    ctx.strokeStyle = C('#6a431f');
    ctx.lineWidth = 0.07 * s;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-0.10 * s, -0.23 * s);
    ctx.quadraticCurveTo(0, -0.38 * s, 0.10 * s, -0.23 * s);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = lw * 0.5;
    ctx.stroke();

    // 袋身
    roundRectPath(ctx, -0.31 * s, -0.24 * s, 0.62 * s, 0.60 * s, 0.13 * s);
    ctx.fillStyle = linGrad(ctx, 0, -0.24 * s, 0, 0.36 * s,
      [[0, C('#b0793d')], [0.55, C('#8a5a2b')], [1, C('#5c3a19')]]);
    ctx.fill();
    ctx.strokeStyle = OUT_DARK;
    ctx.lineWidth = lw;
    ctx.stroke();

    // 盖面（上三分之一，更深皮革色）
    ctx.save();
    roundRectPath(ctx, -0.31 * s, -0.24 * s, 0.62 * s, 0.60 * s, 0.13 * s);
    ctx.clip();
    ctx.fillStyle = linGrad(ctx, 0, -0.24 * s, 0, -0.02 * s,
      [[0, C('#8a5a2c')], [1, C('#6d4520')]]);
    ctx.fillRect(-0.31 * s, -0.24 * s, 0.62 * s, 0.22 * s);
    // 盖沿手绘线 + 缝线
    ctx.beginPath();
    handLine(ctx, [[-0.30 * s, -0.02 * s], [0, 0.005 * s], [0.30 * s, -0.02 * s]], s * 0.008);
    ctx.strokeStyle = OUT_DARK;
    ctx.lineWidth = lw * 0.9;
    ctx.stroke();
    ctx.setLineDash([0.045 * s, 0.045 * s]);
    ctx.beginPath();
    ctx.moveTo(-0.25 * s, -0.06 * s);
    ctx.lineTo(0.25 * s, -0.06 * s);
    ctx.strokeStyle = 'rgba(216,176,106,0.85)';
    ctx.lineWidth = lw * 0.5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 束带
    ctx.fillStyle = C('#4a2c12');
    ctx.fillRect(-0.31 * s, 0.09 * s, 0.62 * s, 0.09 * s);
    ctx.strokeStyle = OUT_DARK;
    ctx.lineWidth = lw * 0.7;
    ctx.strokeRect(-0.31 * s, 0.09 * s, 0.62 * s, 0.09 * s);

    // 鎏金方扣
    roundRectPath(ctx, -0.075 * s, 0.055 * s, 0.15 * s, 0.14 * s, 0.03 * s);
    ctx.fillStyle = linGrad(ctx, 0, 0.05 * s, 0, 0.20 * s,
      [[0, C('#ecc76e')], [1, C('#9c7420')]]);
    ctx.fill();
    ctx.strokeStyle = '#4a3410';
    ctx.lineWidth = lw * 0.7;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0.075 * s);
    ctx.lineTo(0, 0.17 * s);
    ctx.strokeStyle = '#4a3410';
    ctx.lineWidth = lw * 0.6;
    ctx.stroke();

    glossArc(ctx, 0, -0.10 * s, 0.20 * s, Math.PI * 1.15, Math.PI * 1.55, lw * 0.8, t);
  },

  /** 军队：交叉双剑（钢刃渐变 + 鎏金护手 + 缠柄） */
  army(ctx, s, t, lw) {
    sword(ctx, s, t, -1, lw);
    sword(ctx, s, t, 1, lw);
  },

  /** 系统设置：青铜齿轮（钢面渐变 + 倒角高光 + 黄铜轴心） */
  settings(ctx, s, t, lw) {
    const C = hex => shade(hex, t);
    const teeth = 8, R1 = 0.30 * s, R2 = 0.215 * s;
    ctx.beginPath();
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * Math.PI * 2;
      const seg = Math.PI / teeth;
      const r = a => [Math.cos(a), Math.sin(a)];
      if (i === 0) {
        const [cx0, cy0] = r(a0);
        ctx.moveTo(cx0 * R2, cy0 * R2);
      } else {
        const [cx0, cy0] = r(a0);
        ctx.lineTo(cx0 * R2, cy0 * R2);
      }
      const [x1, y1] = r(a0 + seg * 0.32);
      ctx.lineTo(x1 * R2, y1 * R2);
      const [x2, y2] = r(a0 + seg * 0.55);
      ctx.lineTo(x2 * R1, y2 * R1);
      const [x3, y3] = r(a0 + seg * 0.78);
      ctx.lineTo(x3 * R1, y3 * R1);
      const [x4, y4] = r(a0 + seg * 1.0);
      ctx.lineTo(x4 * R2, y4 * R2);
    }
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, -0.26 * s, -0.26 * s, 0.26 * s, 0.26 * s,
      [[0, C('#eef2f6')], [0.5, C('#9aa4ae')], [1, C('#5c666f')]]);
    ctx.fill();
    ctx.strokeStyle = OUT_STEEL;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 内圈倒角
    ctx.beginPath();
    ctx.arc(0, 0, 0.185 * s, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(38,43,49,0.55)';
    ctx.lineWidth = lw * 0.9;
    ctx.stroke();
    glossArc(ctx, 0, 0, 0.255 * s, Math.PI * 1.05, Math.PI * 1.55, lw * 0.7, t, 0.4);

    // 黄铜轴心 + 孔
    ctx.beginPath();
    ctx.arc(0, 0, 0.105 * s, 0, Math.PI * 2);
    ctx.fillStyle = linGrad(ctx, -0.1 * s, -0.1 * s, 0.1 * s, 0.1 * s,
      [[0, C('#ecc76e')], [1, C('#8a651c')]]);
    ctx.fill();
    ctx.strokeStyle = OUT_WARM;
    ctx.lineWidth = lw * 0.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 0.046 * s, 0, Math.PI * 2);
    ctx.fillStyle = C('#241a10');
    ctx.fill();
  },

  /** 跳跃：鎏金箭簇（渐变箭身 + 中脊高光 + 底部动效弧） */
  jump(ctx, s, t, lw) {
    const C = hex => shade(hex, t);
    ctx.beginPath();
    ctx.moveTo(0, -0.38 * s);
    ctx.lineTo(0.22 * s, 0.02 * s);
    ctx.lineTo(0.09 * s, 0.02 * s);
    ctx.lineTo(0.09 * s, 0.36 * s);
    ctx.lineTo(-0.09 * s, 0.36 * s);
    ctx.lineTo(-0.09 * s, 0.02 * s);
    ctx.lineTo(-0.22 * s, 0.02 * s);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, -0.2 * s, 0, 0.2 * s, 0,
      [[0, C('#f6d884')], [0.5, C('#dcae3e')], [1, C('#a9781c')]]);
    ctx.fill();
    ctx.strokeStyle = '#3a2a10';
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -0.28 * s);
    ctx.lineTo(0, 0.30 * s);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = lw * 0.5;
    ctx.stroke();
    // 底部动效双弧
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(sx * 0.17 * s, 0.32 * s, 0.09 * s, Math.PI * 0.15, Math.PI * 0.85, true);
      ctx.strokeStyle = `rgba(232,217,168,${0.55})`;
      ctx.lineWidth = lw * 0.7;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  },

  /** 轻功：三道气流弧（渐细弧线 + 白色气点） */
  flight(ctx, s, t, lw) {
    const C = hex => shade(hex, t);
    const wisps = [
      { y: -0.16 * s, w: 0.068 * s, c1: '#f7ecd0', c2: '#d8c48c' },
      { y: 0.06 * s, w: 0.054 * s, c1: '#e8d9a8', c2: '#c2ab72' },
      { y: 0.26 * s, w: 0.040 * s, c1: '#d8c48c', c2: '#a98f52' }
    ];
    wisps.forEach((wp, i) => {
      ctx.beginPath();
      ctx.moveTo(-0.34 * s + wob(i) * s * 0.01, wp.y + 0.02 * s);
      ctx.quadraticCurveTo(
        -0.02 * s + wob(i + 3) * s * 0.012, wp.y - 0.10 * s,
        0.32 * s + wob(i + 5) * s * 0.008, wp.y - 0.14 * s
      );
      ctx.strokeStyle = linGrad(ctx, -0.34 * s, wp.y, 0.32 * s, wp.y - 0.14 * s,
        [[0, C(wp.c2)], [1, C(wp.c1)]]);
      ctx.lineWidth = wp.w;
      ctx.lineCap = 'round';
      ctx.stroke();
      // 气点
      ctx.beginPath();
      ctx.arc(0.38 * s, wp.y - 0.17 * s, wp.w * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fill();
    });
  },

  /** 投掷：四刃飞镖（钢面渐变 + 黄铜铆钉 + 尾迹弧） */
  throwIcon(ctx, s, t, lw) {
    const C = hex => shade(hex, t);
    const steel = linGrad(ctx, -0.3 * s, -0.3 * s, 0.3 * s, 0.3 * s,
      [[0, C('#f0f4f8')], [0.5, C('#bcc6cf')], [1, C('#6e7883')]]);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      const ux = Math.cos(a), uy = Math.sin(a);
      const pxn = -uy, pyn = ux;
      ctx.beginPath();
      ctx.moveTo(ux * 0.37 * s, uy * 0.37 * s);                       // 刃尖
      ctx.lineTo(ux * 0.10 * s + pxn * 0.085 * s, uy * 0.10 * s + pyn * 0.085 * s);
      ctx.lineTo(ux * 0.02 * s, uy * 0.02 * s);
      ctx.lineTo(ux * 0.10 * s - pxn * 0.085 * s, uy * 0.10 * s - pyn * 0.085 * s);
      ctx.closePath();
      ctx.fillStyle = steel;
      ctx.fill();
      ctx.strokeStyle = OUT_STEEL;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    // 中心铆钉
    ctx.beginPath();
    ctx.arc(0, 0, 0.075 * s, 0, Math.PI * 2);
    ctx.fillStyle = linGrad(ctx, -0.07 * s, -0.07 * s, 0.07 * s, 0.07 * s,
      [[0, C('#ecc76e')], [1, C('#8a651c')]]);
    ctx.fill();
    ctx.strokeStyle = OUT_WARM;
    ctx.lineWidth = lw * 0.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 0.024 * s, 0, Math.PI * 2);
    ctx.fillStyle = '#241a10';
    ctx.fill();
  },

  /** 格挡：木铁团盾（木纹渐变 + 铁边包沿 + 铆钉 + 中央铁泡） */
  block(ctx, s, t, lw) {
    const C = hex => shade(hex, t);
    const shield = () => {
      ctx.beginPath();
      ctx.moveTo(-0.22 * s, -0.30 * s);
      ctx.lineTo(0.22 * s, -0.30 * s);
      ctx.quadraticCurveTo(0.22 * s + wob(4) * s * 0.008, 0.12 * s, 0, 0.38 * s);
      ctx.quadraticCurveTo(-0.22 * s - wob(7) * s * 0.008, 0.12 * s, -0.22 * s, -0.30 * s);
      ctx.closePath();
    };
    shield();
    ctx.fillStyle = linGrad(ctx, -0.2 * s, -0.3 * s, 0.18 * s, 0.3 * s,
      [[0, C('#a87b42')], [0.55, C('#83582a')], [1, C('#573819')]]);
    ctx.fill();
    ctx.strokeStyle = '#3a2a14';
    ctx.lineWidth = lw * 1.1;
    ctx.stroke();
    // 内金线
    ctx.save();
    shield();
    ctx.clip();
    ctx.strokeStyle = 'rgba(201,162,39,0.8)';
    ctx.lineWidth = lw * 0.6;
    ctx.beginPath();
    ctx.moveTo(-0.175 * s, -0.245 * s);
    ctx.lineTo(0.175 * s, -0.245 * s);
    ctx.quadraticCurveTo(0.175 * s, 0.10 * s, 0, 0.315 * s);
    ctx.quadraticCurveTo(-0.175 * s, 0.10 * s, -0.175 * s, -0.245 * s);
    ctx.stroke();
    ctx.restore();
    // 铁箍横带 + 中央铁泡
    ctx.fillStyle = linGrad(ctx, 0, -0.045 * s, 0, 0.045 * s,
      [[0, C('#aeb8c1')], [1, C('#6b757f')]]);
    ctx.fillRect(-0.215 * s, -0.045 * s, 0.43 * s, 0.09 * s);
    ctx.strokeStyle = '#3a4148';
    ctx.lineWidth = lw * 0.7;
    ctx.strokeRect(-0.215 * s, -0.045 * s, 0.43 * s, 0.09 * s);
    ctx.beginPath();
    ctx.arc(0, 0, 0.095 * s, 0, Math.PI * 2);
    ctx.fillStyle = linGrad(ctx, -0.09 * s, -0.09 * s, 0.09 * s, 0.09 * s,
      [[0, C('#e5ebf1')], [1, C('#77828d')]]);
    ctx.fill();
    ctx.strokeStyle = '#333a41';
    ctx.lineWidth = lw * 0.9;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-0.02 * s, -0.02 * s, 0.022 * s, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fill();
    // 四颗金铆钉
    for (const [rx, ry] of [[-0.135, -0.16], [0.135, -0.16], [-0.135, 0.16], [0.135, 0.16]]) {
      ctx.beginPath();
      ctx.arc(rx * s, ry * s, 0.030 * s, 0, Math.PI * 2);
      ctx.fillStyle = linGrad(ctx, rx * s - 0.03 * s, ry * s - 0.03 * s, rx * s + 0.03 * s, ry * s + 0.03 * s,
        [[0, C('#ecc76e')], [1, C('#8a651c')]]);
      ctx.fill();
    }
    glossArc(ctx, 0, -0.02 * s, 0.19 * s, Math.PI * 1.1, Math.PI * 1.5, lw * 0.8, t);
  },

  /** 攻击：单剑斩击（钢刃 + 斩击星芒） */
  attack(ctx, s, t, lw) {
    sword(ctx, s, t, 1, lw);
    // 斩击星芒（尖端侧）
    const sx = 0.10 * s, sy = -0.24 * s;
    ctx.strokeStyle = `rgba(255,255,255,${0.8})`;
    ctx.lineCap = 'round';
    for (const [dx, dy, len] of [[1, 0, 0.06], [0, 1, 0.06], [0.7, 0.7, 0.04], [-0.7, -0.7, 0.04]]) {
      ctx.beginPath();
      ctx.moveTo(sx - dx * len * s, sy - dy * len * s);
      ctx.lineTo(sx + dx * len * s, sy + dy * len * s);
      ctx.lineWidth = lw * 0.55;
      ctx.stroke();
    }
  },

  /** 治疗：药葫芦（赭石渐变双腹 + 红绳束腰 + 塞盖） */
  heal(ctx, s, t, lw) {
    const C = hex => shade(hex, t);
    // 双腹联合填充
    ctx.beginPath();
    ctx.arc(0, -0.13 * s, 0.135 * s, 0, Math.PI * 2);
    ctx.arc(0, 0.10 * s, 0.20 * s, 0, Math.PI * 2);
    ctx.fillStyle = linGrad(ctx, -0.2 * s, -0.2 * s, 0.18 * s, 0.3 * s,
      [[0, C('#c9924a')], [0.55, C('#a06a2e')], [1, C('#6e4419')]]);
    ctx.fill();
    ctx.strokeStyle = OUT_DARK;
    ctx.lineWidth = lw;
    ctx.stroke();
    // 葫腰收束阴影
    ctx.beginPath();
    ctx.ellipse(0, -0.015 * s, 0.128 * s, 0.045 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(80,48,16,0.85)';
    ctx.fill();
    // 红绳 + 结
    ctx.beginPath();
    handLine(ctx, [[-0.125 * s, -0.015 * s], [0, 0.01 * s], [0.125 * s, -0.015 * s]], s * 0.008);
    ctx.strokeStyle = C('#b03626');
    ctx.lineWidth = lw * 0.9;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0.06 * s, 0.0);
    ctx.lineTo(0.15 * s, 0.05 * s);
    ctx.moveTo(0.06 * s, 0.0);
    ctx.lineTo(0.14 * s, -0.05 * s);
    ctx.strokeStyle = C('#a03022');
    ctx.lineWidth = lw * 0.7;
    ctx.stroke();
    // 塞盖
    ctx.beginPath();
    ctx.ellipse(0, -0.265 * s, 0.05 * s, 0.035 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = C('#8a5a28');
    ctx.fill();
    ctx.strokeStyle = OUT_DARK;
    ctx.lineWidth = lw * 0.7;
    ctx.stroke();
    // 双腹受光
    glossArc(ctx, -0.03 * s, -0.16 * s, 0.085 * s, Math.PI * 1.05, Math.PI * 1.6, lw * 0.8, t, 0.38);
    glossArc(ctx, -0.05 * s, 0.06 * s, 0.13 * s, Math.PI * 1.1, Math.PI * 1.55, lw * 0.9, t, 0.3);
  },

  /** 火球：三层焰（外焰橙红 → 内焰金橙 → 白热焰芯 + 火星） */
  flame(ctx, s, t, lw) {
    const C = hex => shade(hex, t);
    const flamePath = (scale, dy) => {
      const k = scale;
      ctx.beginPath();
      ctx.moveTo(0, (-0.38 + dy) * s);
      ctx.quadraticCurveTo(k * 0.24 * s + wob(3) * s * 0.01, (-0.10 + dy) * s, k * 0.17 * s, (0.14 + dy) * s);
      ctx.quadraticCurveTo(k * 0.12 * s, (0.32 + dy) * s, 0, (0.34 + dy) * s);
      ctx.quadraticCurveTo(-k * 0.12 * s, (0.32 + dy) * s, -k * 0.17 * s, (0.14 + dy) * s);
      ctx.quadraticCurveTo(-k * 0.24 * s + wob(8) * s * 0.01, (-0.10 + dy) * s, 0, (-0.38 + dy) * s);
      ctx.closePath();
    };
    flamePath(1, 0);
    ctx.fillStyle = linGrad(ctx, 0, 0.34 * s, 0, -0.38 * s,
      [[0, C('#ff8a2e')], [0.6, C('#e8541c')], [1, C('#c03a10')]]);
    ctx.fill();
    ctx.strokeStyle = '#7a2410';
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.stroke();
    flamePath(0.62, 0.05);
    ctx.fillStyle = linGrad(ctx, 0, 0.3 * s, 0, -0.1 * s,
      [[0, C('#ffc257')], [1, C('#ff9838')]]);
    ctx.fill();
    // 白热焰芯
    ctx.beginPath();
    ctx.arc(0, 0.14 * s, 0.13 * s, 0, Math.PI * 2);
    ctx.fillStyle = radGrad(ctx, 0, 0.14 * s, 0.01 * s, 0.13 * s,
      [[0, 'rgba(255,246,207,0.95)'], [0.7, 'rgba(255,212,121,0.6)'], [1, 'rgba(255,212,121,0)']]);
    ctx.fill();
    // 火星
    for (const [mx, my, mr] of [[0.11, -0.44, 0.030], [-0.09, -0.38, 0.021]]) {
      ctx.beginPath();
      ctx.arc(mx * s, my * s, mr * s, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,212,121,0.85)';
      ctx.fill();
    }
  },

  /** 射箭：木杆箭矢（钢镞 + 红白尾羽） */
  arrow(ctx, s, t, lw) {
    const C = hex => shade(hex, t);
    const tx = 0.34 * s, ty = -0.34 * s;    // 尖端
    const lx = -0.32 * s, ly = 0.32 * s;    // 尾端
    let ux = tx - lx, uy = ty - ly;
    const alen = Math.hypot(ux, uy);
    ux /= alen; uy /= alen;
    const px = -uy, py = ux;

    // 木杆（柱面渐变 stroke）
    ctx.beginPath();
    ctx.moveTo(lx + ux * 0.10 * s, ly + uy * 0.10 * s);
    ctx.lineTo(tx - ux * 0.15 * s, ty - uy * 0.15 * s);
    ctx.strokeStyle = linGrad(ctx,
      lx + px * 0.03 * s, ly + py * 0.03 * s,
      lx - px * 0.03 * s, ly - py * 0.03 * s,
      [[0, C('#b5834a')], [1, C('#63401f')]]);
    ctx.lineWidth = 0.055 * s;
    ctx.lineCap = 'round';
    ctx.stroke();
    // 木纹高光
    ctx.beginPath();
    ctx.moveTo(lx + ux * 0.14 * s + px * 0.012 * s, ly + uy * 0.14 * s + py * 0.012 * s);
    ctx.lineTo(tx - ux * 0.18 * s + px * 0.012 * s, ty - uy * 0.18 * s + py * 0.012 * s);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = lw * 0.4;
    ctx.stroke();

    // 钢镞（三角）
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - ux * 0.16 * s + px * 0.075 * s, ty - uy * 0.16 * s + py * 0.075 * s);
    ctx.lineTo(tx - ux * 0.16 * s - px * 0.075 * s, ty - uy * 0.16 * s - py * 0.075 * s);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx,
      tx - ux * 0.16 * s + px * 0.07 * s, ty - uy * 0.16 * s + py * 0.07 * s,
      tx - ux * 0.16 * s - px * 0.07 * s, ty - uy * 0.16 * s - py * 0.07 * s,
      [[0, C('#f0f4f8')], [1, C('#77828d')]]);
    ctx.fill();
    ctx.strokeStyle = OUT_STEEL;
    ctx.lineWidth = lw * 0.9;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 尾羽（红 / 米白 双翼）
    const vanes = [
      { off: 0.028 * s, c: '#c04a32' },
      { off: -0.028 * s, c: '#e8dcc0' }
    ];
    for (const v of vanes) {
      ctx.beginPath();
      ctx.moveTo(lx + ux * 0.10 * s + px * v.off, ly + uy * 0.10 * s + py * v.off);
      ctx.lineTo(lx + ux * 0.20 * s + px * (v.off + 0.02 * s), ly + uy * 0.20 * s + py * (v.off + 0.02 * s));
      ctx.lineTo(lx + px * (v.off + 0.10 * s), ly + py * (v.off + 0.10 * s));
      ctx.lineTo(lx - ux * 0.02 * s + px * v.off, ly - uy * 0.02 * s + py * v.off);
      ctx.closePath();
      ctx.fillStyle = linGrad(ctx, lx - 0.1 * s, ly - 0.1 * s, lx + 0.12 * s, ly + 0.12 * s,
        [[0, C(v.c)], [1, shade(v.c, t - 0.25)]]);
      ctx.fill();
      ctx.strokeStyle = OUT_DARK;
      ctx.lineWidth = lw * 0.6;
      ctx.stroke();
    }
    // 扣弦尾槽
    ctx.beginPath();
    ctx.moveTo(lx + px * 0.028 * s, ly + py * 0.028 * s);
    ctx.lineTo(lx - px * 0.028 * s, ly - py * 0.028 * s);
    ctx.strokeStyle = OUT_DARK;
    ctx.lineWidth = lw * 0.9;
    ctx.stroke();
  },

  /** 冰霜：六向雪晶（冰蓝渐变 + 分叉枝 + 中央冰晶） */
  frost(ctx, s, t, lw) {
    const C = hex => shade(hex, t);
    // 辉光
    ctx.beginPath();
    ctx.arc(0, 0, 0.36 * s, 0, Math.PI * 2);
    ctx.fillStyle = radGrad(ctx, 0, 0, 0.02 * s, 0.36 * s,
      [[0, `rgba(191,233,255,${0.20 + t * 0.2})`], [1, 'rgba(191,233,255,0)']]);
    ctx.fill();
    // 六主枝 + 分叉
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      const ux = Math.cos(a), uy = Math.sin(a);
      const px = -uy, py = ux;
      const R = 0.32 * s;
      ctx.beginPath();
      ctx.moveTo(ux * 0.09 * s, uy * 0.09 * s);
      ctx.lineTo(ux * R, uy * R);
      ctx.strokeStyle = linGrad(ctx, ux * 0.1 * s, uy * 0.1 * s, ux * R, uy * R,
        [[0, C('#eafaff')], [1, C('#6fb2dc')]]);
      ctx.lineWidth = 0.05 * s;
      ctx.lineCap = 'round';
      ctx.stroke();
      // 枝端分叉
      for (const sd of [-1, 1]) {
        const bx0 = ux * R * 0.68, by0 = uy * R * 0.68;
        const ang = a + sd * Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(bx0, by0);
        ctx.lineTo(bx0 + Math.cos(ang) * 0.11 * s, by0 + Math.sin(ang) * 0.11 * s);
        ctx.strokeStyle = C('#9ed4ee');
        ctx.lineWidth = 0.032 * s;
        ctx.stroke();
      }
    }
    // 中央冰晶六边形
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + Math.PI / 6;
      const x = Math.cos(a) * 0.095 * s, y = Math.sin(a) * 0.095 * s;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, -0.09 * s, -0.09 * s, 0.09 * s, 0.09 * s,
      [[0, C('#e2f5fd')], [1, C('#6fa8cc')]]);
    ctx.fill();
    ctx.strokeStyle = '#33607e';
    ctx.lineWidth = lw * 0.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-0.02 * s, -0.02 * s, 0.018 * s, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();
  },

  /** 采集：铁镐（新月镐头 + 木柄 + 缠绳） */
  gather(ctx, s, t, lw) {
    const C = hex => shade(hex, t);
    // 木柄（微斜）
    ctx.beginPath();
    ctx.moveTo(0.04 * s, -0.24 * s);
    ctx.lineTo(-0.08 * s, 0.36 * s);
    ctx.strokeStyle = linGrad(ctx, -0.1 * s, 0, 0.08 * s, 0,
      [[0, C('#b5834a')], [1, C('#63401f')]]);
    ctx.lineWidth = 0.07 * s;
    ctx.lineCap = 'round';
    ctx.stroke();
    // 柄缠绳
    for (let i = 1; i <= 2; i++) {
      const wy = -0.16 * s + i * 0.045 * s;
      ctx.beginPath();
      ctx.moveTo(0.045 * s - i * 0.03 * s - 0.03 * s, wy);
      ctx.lineTo(0.045 * s - i * 0.03 * s + 0.03 * s, wy - 0.01 * s);
      ctx.strokeStyle = 'rgba(201,162,39,0.7)';
      ctx.lineWidth = lw * 0.6;
      ctx.stroke();
    }
    // 新月镐头（外弧 + 内弧）
    ctx.beginPath();
    ctx.moveTo(-0.36 * s, -0.02 * s + wob(2) * s * 0.008);
    ctx.quadraticCurveTo(0, -0.46 * s, 0.36 * s, -0.02 * s + wob(5) * s * 0.008);
    ctx.quadraticCurveTo(0, -0.26 * s, -0.36 * s, -0.02 * s + wob(2) * s * 0.008);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, -0.3 * s, -0.4 * s, 0.3 * s, -0.05 * s,
      [[0, C('#eef2f6')], [0.5, C('#aeb8c1')], [1, C('#6b757f')]]);
    ctx.fill();
    ctx.strokeStyle = OUT_STEEL;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.stroke();
    glossArc(ctx, 0, -0.34 * s, 0.22 * s, Math.PI * 1.15, Math.PI * 1.5, lw * 0.7, t, 0.35);
  },

  /** 交互：指尖点按（暖金手指 + 双重波纹 + 焦点辉光） */
  interact(ctx, s, t, lw) {
    const C = hex => shade(hex, t);
    const fx = 0, fy = -0.14 * s;
    // 焦点辉光
    ctx.beginPath();
    ctx.arc(fx, fy, 0.17 * s, 0, Math.PI * 2);
    ctx.fillStyle = radGrad(ctx, fx, fy, 0.02 * s, 0.17 * s,
      [[0, `rgba(236,199,110,${0.5 + t * 0.3})`], [1, 'rgba(236,199,110,0)']]);
    ctx.fill();
    // 波纹双弧
    for (const [r, a] of [[0.16, 0.75], [0.25, 0.4]]) {
      ctx.beginPath();
      ctx.arc(fx, fy + 0.05 * s, r * s, Math.PI * 1.12, Math.PI * 1.88);
      ctx.strokeStyle = `rgba(232,217,168,${a})`;
      ctx.lineWidth = lw * 0.8;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    // 指尖（从右下伸向焦点）
    ctx.beginPath();
    ctx.moveTo(-0.02 * s, 0.06 * s);
    ctx.quadraticCurveTo(-0.10 * s, 0.16 * s, -0.04 * s, 0.24 * s);
    ctx.quadraticCurveTo(0.06 * s, 0.34 * s, 0.20 * s, 0.28 * s);
    ctx.quadraticCurveTo(0.30 * s, 0.24 * s, 0.26 * s, 0.12 * s);
    ctx.lineTo(0.05 * s, 0.02 * s);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, 0.0, 0.05 * s, 0.2 * s, 0.3 * s,
      [[0, C('#eec08a')], [1, C('#b5804c')]]);
    ctx.fill();
    ctx.strokeStyle = '#4a2c14';
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.stroke();
  },

  /** 移动：四向箭簇（鎏金箭头 + 黄铜毂） */
  move(ctx, s, t, lw) {
    const C = hex => shade(hex, t);
    const gold = linGrad(ctx, -0.3 * s, -0.3 * s, 0.3 * s, 0.3 * s,
      [[0, C('#f6d884')], [0.55, C('#dcae3e')], [1, C('#a9781c')]]);
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const ux = dx, uy = dy;
      const pxn = -uy, pyn = ux;
      ctx.beginPath();
      ctx.moveTo(ux * 0.36 * s, uy * 0.36 * s);                                   // 簇尖
      ctx.lineTo(ux * 0.14 * s + pxn * 0.115 * s, uy * 0.14 * s + pyn * 0.115 * s);
      ctx.lineTo(ux * 0.22 * s, uy * 0.22 * s);                                    // 内凹
      ctx.lineTo(ux * 0.14 * s - pxn * 0.115 * s, uy * 0.14 * s - pyn * 0.115 * s);
      ctx.closePath();
      ctx.fillStyle = gold;
      ctx.fill();
      ctx.strokeStyle = '#3a2a10';
      ctx.lineWidth = lw * 0.9;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    // 黄铜毂
    ctx.beginPath();
    ctx.arc(0, 0, 0.075 * s, 0, Math.PI * 2);
    ctx.fillStyle = linGrad(ctx, -0.07 * s, -0.07 * s, 0.07 * s, 0.07 * s,
      [[0, C('#ecc76e')], [1, C('#8a651c')]]);
    ctx.fill();
    ctx.strokeStyle = OUT_WARM;
    ctx.lineWidth = lw * 0.8;
    ctx.stroke();
  },

  /** 冥想：打坐人形（青铜剪影 + 头顶气环 + 灵气光点） */
  meditation(ctx, s, t, lw) {
    const C = hex => shade(hex, t);
    // 背景辉光 + 气环
    ctx.beginPath();
    ctx.arc(0, 0.02 * s, 0.36 * s, 0, Math.PI * 2);
    ctx.fillStyle = radGrad(ctx, 0, 0.02 * s, 0.03 * s, 0.36 * s,
      [[0, `rgba(232,217,168,${0.16 + t * 0.15})`], [1, 'rgba(232,217,168,0)']]);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0.0, 0.335 * s, Math.PI * 1.08, Math.PI * 1.92);
    ctx.strokeStyle = 'rgba(232,217,168,0.45)';
    ctx.lineWidth = lw * 0.7;
    ctx.lineCap = 'round';
    ctx.stroke();
    // 头
    ctx.beginPath();
    ctx.arc(0, -0.21 * s, 0.08 * s, 0, Math.PI * 2);
    ctx.fillStyle = linGrad(ctx, -0.08 * s, -0.29 * s, 0.08 * s, -0.13 * s,
      [[0, C('#e2cf96')], [1, C('#a8894c')]]);
    ctx.fill();
    ctx.strokeStyle = '#3a2a10';
    ctx.lineWidth = lw * 0.8;
    ctx.stroke();
    // 身形（打坐剪影：肩 → 交叠腿的宽底座）
    ctx.beginPath();
    ctx.moveTo(-0.13 * s, -0.11 * s);
    ctx.quadraticCurveTo(-0.30 * s + wob(3) * s * 0.01, 0.12 * s, -0.24 * s, 0.24 * s);
    ctx.quadraticCurveTo(0, 0.34 * s, 0.24 * s, 0.24 * s);
    ctx.quadraticCurveTo(0.30 * s + wob(6) * s * 0.01, 0.12 * s, 0.13 * s, -0.11 * s);
    ctx.quadraticCurveTo(0, -0.04 * s, -0.13 * s, -0.11 * s);
    ctx.closePath();
    ctx.fillStyle = linGrad(ctx, -0.2 * s, -0.05 * s, 0.2 * s, 0.3 * s,
      [[0, C('#d3bc80')], [1, C('#8a6f34')]]);
    ctx.fill();
    ctx.strokeStyle = '#3a2a10';
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // 结印双手
    ctx.beginPath();
    ctx.arc(0, 0.12 * s, 0.045 * s, 0, Math.PI * 2);
    ctx.fillStyle = C('#c8ab68');
    ctx.fill();
    ctx.strokeStyle = '#3a2a10';
    ctx.lineWidth = lw * 0.6;
    ctx.stroke();
    // 灵气光点
    for (const [qx, qy, qr] of [[0.24, -0.28, 0.030], [-0.26, -0.16, 0.022]]) {
      ctx.beginPath();
      ctx.arc(qx * s, qy * s, qr * s, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(236,199,110,0.9)';
      ctx.fill();
    }
  }
};

/* ---------- 对外 API ---------- */

export const HudIconPainter = {
  /** 是否内置该名字的矢量图标。 */
  has(name) {
    return typeof name === 'string' && Object.prototype.hasOwnProperty.call(PAINTERS, name);
  },

  /** 全部内置图标名列表（导出图片资产等工具用）。 */
  names() {
    return Object.keys(PAINTERS);
  },

  /**
   * 以 (cx, cy) 为中心绘制手绘风图标。
   * @param {string} name - 图标名（PAINTERS 键）
   * @param {number} size - 图标盒边长（px）
   * @param {Object} [opts] - { brighten: 0..1 } 整体加亮（hover 反馈）
   * @returns {boolean} 是否绘制了图标（未知名返回 false，调用方可回退）
   */
  draw(ctx, name, cx, cy, size, opts = {}) {
    const painter = PAINTERS[name];
    if (!painter) return false;
    const brighten = Math.max(0, Math.min(0.5, Number(opts.brighten) || 0));
    const s = Math.max(10, size);
    const lineWidth = Math.max(1, s * 0.055);
    ctx.save();
    ctx.translate(cx, cy);
    try {
      painter(ctx, s, brighten, lineWidth);
    } finally {
      ctx.restore();
    }
    return true;
  }
};

export default HudIconPainter;
