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
 * HudIconPainter - HUD 功能按钮矢量图标绘制器
 *
 * 统一替代 emoji 字符图标：每个图标为几何路径手绘（线性金色风格，与 HUD
 * 主题色一致），跨平台渲染一致且随按钮尺寸矢量缩放。
 *
 * 用法：
 *   HudIconPainter.draw(ctx, 'backpack', cx, cy, size)      // 默认金色
 *   HudIconPainter.draw(ctx, 'army', cx, cy, size, '#fff')  // 自定色（hover）
 *   HudIconPainter.has('backpack')                          // 是否内置图标
 *
 * 图标命名与 IconButton.icon / SkillWheelOverlay 技能键对齐；
 * 未注册的名字返回 false，由调用方回退到 emoji/文本渲染。
 */

const DEFAULT_COLOR = '#e8d9a8';
const ACCENT = '#c9a227';

/** 通用描边：构建路径后一次 stroke。 */
function stroke(ctx, build, color, lineWidth) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  build(ctx);
  ctx.stroke();
}

const PAINTERS = {
  /** 背包：竖向行囊 + 提手 + 束带方扣 */
  backpack(ctx, cx, cy, s, color, lw) {
    const w = s * 0.56;
    const h = s * 0.66;
    const top = cy - s * 0.18;
    // 提手
    stroke(ctx, c => {
      c.moveTo(cx - w * 0.28, top);
      c.quadraticCurveTo(cx, top - s * 0.34, cx + w * 0.28, top);
    }, color, lw);
    // 袋身（圆角）
    const r = s * 0.1;
    ctx.fillStyle = 'rgba(232, 217, 168, 0.14)';
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2 + r, top);
    ctx.arcTo(cx + w / 2, top, cx + w / 2, top + h, r);
    ctx.arcTo(cx + w / 2, top + h, cx - w / 2, top + h, r);
    ctx.arcTo(cx - w / 2, top + h, cx - w / 2, top, r);
    ctx.arcTo(cx - w / 2, top, cx + w / 2, top, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // 束带 + 方扣
    stroke(ctx, c => {
      c.moveTo(cx - w / 2, cy + s * 0.06);
      c.lineTo(cx + w / 2, cy + s * 0.06);
    }, color, lw * 0.9);
    ctx.strokeRect(cx - s * 0.07, cy + s * 0.02, s * 0.14, s * 0.12);
  },

  /** 军队：交叉双剑 */
  army(ctx, cx, cy, s, color, lw) {
    const len = s * 0.38;
    for (const dir of [-1, 1]) {
      // 刃（从中心向外上）
      stroke(ctx, c => {
        c.moveTo(cx - dir * len * 0.28, cy + len * 0.28);
        c.lineTo(cx + dir * len, cy - len);
      }, color, lw);
      // 护手（垂直于刃的短横）
      const gx = cx + dir * len * 0.62;
      const gy = cy - len * 0.62;
      stroke(ctx, c => {
        c.moveTo(gx - dir * s * 0.12, gy - s * 0.12);
        c.lineTo(gx + dir * s * 0.12, gy + s * 0.12);
      }, ACCENT, lw * 0.9);
      // 柄头
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(cx - dir * len * 0.18, cy + len * 0.18, s * 0.055, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  /** 系统设置：八齿齿轮 + 中心孔 */
  settings(ctx, cx, cy, s, color, lw) {
    const outer = s * 0.34;
    stroke(ctx, c => {
      c.arc(cx, cy, outer, 0, Math.PI * 2);
    }, color, lw);
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      stroke(ctx, c => {
        c.moveTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
        c.lineTo(cx + Math.cos(angle) * (outer + s * 0.12), cy + Math.sin(angle) * (outer + s * 0.12));
      }, color, lw * 1.2);
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
  },

  /** 跳跃：向上实心箭头 + 粗杆 */
  jump(ctx, cx, cy, s, color) {
    const head = s * 0.22;
    const shaft = s * 0.34;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.38);
    ctx.lineTo(cx + head, cy - s * 0.1);
    ctx.lineTo(cx + head * 0.4, cy - s * 0.1);
    ctx.lineTo(cx + head * 0.4, cy + shaft * 0.5);
    ctx.lineTo(cx - head * 0.4, cy + shaft * 0.5);
    ctx.lineTo(cx - head * 0.4, cy - s * 0.1);
    ctx.lineTo(cx - head, cy - s * 0.1);
    ctx.closePath();
    ctx.fill();
  },

  /** 轻功：三道右上气流弧 + 末端气点 */
  flight(ctx, cx, cy, s, color, lw) {
    for (let i = 0; i < 3; i++) {
      const offsetY = (i - 1) * s * 0.2;
      stroke(ctx, c => {
        c.moveTo(cx - s * 0.34, cy - offsetY * 0.4 + offsetY);
        c.quadraticCurveTo(cx - s * 0.05, cy - s * 0.18 + offsetY, cx + s * 0.3, cy - s * 0.3 + offsetY * 0.6);
      }, color, lw * (i === 1 ? 1.15 : 0.85));
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx + s * 0.36, cy - s * 0.4, s * 0.05, 0, Math.PI * 2);
    ctx.fill();
  },

  /** 投掷：菱形飞镖 + 尾迹 */
  throwIcon(ctx, cx, cy, s, color, lw) {
    const r = s * 0.2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx + r, cy - r);
    ctx.lineTo(cx + r * 1.7, cy);
    ctx.lineTo(cx + r, cy + r);
    ctx.lineTo(cx + r * 0.1, cy);
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < 2; i++) {
      const oy = (i - 0.5) * s * 0.14;
      stroke(ctx, c => {
        c.moveTo(cx - s * 0.05 + oy * 0.3, cy + oy * 0.3);
        c.lineTo(cx - s * 0.36 + oy * 0.5, cy - oy * 1.1);
      }, color, lw * 0.8);
    }
  },

  /** 格挡/盾：盾形 + 中央竖线 */
  block(ctx, cx, cy, s, color, lw) {
    const w = s * 0.52;
    const top = cy - s * 0.3;
    const bottom = cy + s * 0.38;
    ctx.fillStyle = 'rgba(232, 217, 168, 0.14)';
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, top);
    ctx.lineTo(cx + w / 2, top);
    ctx.quadraticCurveTo(cx + w / 2, cy + s * 0.1, cx, bottom);
    ctx.quadraticCurveTo(cx - w / 2, cy + s * 0.1, cx - w / 2, top);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    stroke(ctx, c => {
      c.moveTo(cx, top + s * 0.05);
      c.lineTo(cx, bottom - s * 0.06);
    }, ACCENT, lw * 0.9);
  },

  /** 攻击：单剑斜置 */
  attack(ctx, cx, cy, s, color, lw) {
    stroke(ctx, c => {
      c.moveTo(cx - s * 0.26, cy + s * 0.26);
      c.lineTo(cx + s * 0.3, cy - s * 0.3);
    }, color, lw);
    stroke(ctx, c => {
      c.moveTo(cx + s * 0.08, cy + s * 0.02);
      c.lineTo(cx + s * 0.24, cy + s * 0.18);
    }, ACCENT, lw);
    stroke(ctx, c => {
      c.moveTo(cx - s * 0.2, cy + s * 0.32);
      c.lineTo(cx - s * 0.3, cy + s * 0.22);
    }, color, lw);
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.arc(cx - s * 0.33, cy + s * 0.33, s * 0.06, 0, Math.PI * 2);
    ctx.fill();
  },

  /** 治疗：医疗十字 */
  heal(ctx, cx, cy, s, color) {
    const arm = s * 0.16;
    const len = s * 0.42;
    ctx.fillStyle = color;
    ctx.fillRect(cx - arm / 2, cy - len / 2, arm, len);
    ctx.fillRect(cx - len / 2, cy - arm / 2, len, arm);
  },

  /** 法术/火球：火苗 + 内芯 */
  flame(ctx, cx, cy, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.36);
    ctx.quadraticCurveTo(cx + s * 0.26, cy - s * 0.06, cx + s * 0.16, cy + s * 0.16);
    ctx.quadraticCurveTo(cx + s * 0.08, cy + s * 0.32, cx, cy + s * 0.32);
    ctx.quadraticCurveTo(cx - s * 0.08, cy + s * 0.32, cx - s * 0.16, cy + s * 0.16);
    ctx.quadraticCurveTo(cx - s * 0.26, cy - s * 0.06, cx, cy - s * 0.36);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.08);
    ctx.quadraticCurveTo(cx + s * 0.1, cy + s * 0.1, cx, cy + s * 0.24);
    ctx.quadraticCurveTo(cx - s * 0.1, cy + s * 0.1, cx, cy - s * 0.08);
    ctx.fill();
  },

  /** 射箭：斜向箭矢 */
  arrow(ctx, cx, cy, s, color, lw) {
    stroke(ctx, c => {
      c.moveTo(cx - s * 0.3, cy + s * 0.3);
      c.lineTo(cx + s * 0.3, cy - s * 0.3);
    }, color, lw);
    // 箭头
    stroke(ctx, c => {
      c.moveTo(cx + s * 0.3, cy - s * 0.3);
      c.lineTo(cx + s * 0.12, cy - s * 0.28);
      c.moveTo(cx + s * 0.3, cy - s * 0.3);
      c.lineTo(cx + s * 0.28, cy - s * 0.12);
    }, color, lw);
    // 尾羽
    stroke(ctx, c => {
      c.moveTo(cx - s * 0.3, cy + s * 0.3);
      c.lineTo(cx - s * 0.34, cy + s * 0.14);
      c.moveTo(cx - s * 0.3, cy + s * 0.3);
      c.lineTo(cx - s * 0.14, cy + s * 0.34);
    }, color, lw * 0.8);
  },

  /** 冰霜：六向雪晶 */
  frost(ctx, cx, cy, s, color, lw) {
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI;
      const dx = Math.cos(angle) * s * 0.3;
      const dy = Math.sin(angle) * s * 0.3;
      stroke(ctx, c => {
        c.moveTo(cx - dx, cy - dy);
        c.lineTo(cx + dx, cy + dy);
      }, color, lw);
      for (const dir of [-1, 1]) {
        const tx = cx + dir * dx;
        const ty = cy + dir * dy;
        stroke(ctx, c => {
          c.moveTo(tx, ty);
          c.lineTo(tx - dir * dx * 0.3 + dy * 0.18, ty - dir * dy * 0.3 - dx * 0.18);
          c.moveTo(tx, ty);
          c.lineTo(tx - dir * dx * 0.3 - dy * 0.18, ty - dir * dy * 0.3 + dx * 0.18);
        }, color, lw * 0.7);
      }
    }
  },

  /** 采集：镐 */
  gather(ctx, cx, cy, s, color, lw) {
    stroke(ctx, c => {
      c.moveTo(cx + s * 0.3, cy - s * 0.3);
      c.quadraticCurveTo(cx - s * 0.05, cy - s * 0.34, cx - s * 0.3, cy - s * 0.1);
    }, color, lw);
    stroke(ctx, c => {
      c.moveTo(cx + s * 0.24, cy - s * 0.24);
      c.lineTo(cx - s * 0.22, cy + s * 0.34);
    }, color, lw);
  },

  /** 交互：指尖点按 + 波纹 */
  interact(ctx, cx, cy, s, color, lw) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy + s * 0.08, s * 0.09, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 1; i <= 2; i++) {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw * 0.7;
      ctx.globalAlpha = 1 - (i - 1) * 0.4;
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.08, s * 0.14 * i + s * 0.06, -Math.PI * 0.85, -Math.PI * 0.15);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  },

  /** 移动：四向箭头 */
  move(ctx, cx, cy, s, color) {
    const arm = s * 0.3;
    const head = s * 0.11;
    ctx.fillStyle = color;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * arm, cy + dy * arm);
      ctx.lineTo(cx + dx * (arm - head) - dy * head * 0.8, cy + dy * (arm - head) - dx * head * 0.8);
      ctx.lineTo(cx + dx * (arm - head) + dy * head * 0.8, cy + dy * (arm - head) + dx * head * 0.8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.06, 0, Math.PI * 2);
    ctx.fill();
  },

  /** 冥想/打坐：人形静坐 + 头顶气环 */
  meditation(ctx, cx, cy, s, color, lw) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.2, s * 0.09, 0, Math.PI * 2);
    ctx.fill();
    stroke(ctx, c => {
      c.moveTo(cx - s * 0.22, cy + s * 0.26);
      c.quadraticCurveTo(cx, cy + s * 0.02, cx + s * 0.22, cy + s * 0.26);
    }, color, lw);
    stroke(ctx, c => {
      c.arc(cx, cy - s * 0.34, s * 0.14, Math.PI * 1.15, Math.PI * 1.85);
    }, color, lw * 0.7);
  }
};

export const HudIconPainter = {
  /** 是否内置该名字的矢量图标。 */
  has(name) {
    return typeof name === 'string' && Object.prototype.hasOwnProperty.call(PAINTERS, name);
  },

  /**
   * 以 (cx, cy) 为中心绘制图标。
   * @param {string} name - 图标名（PAINTERS 键）
   * @param {number} size - 图标盒边长（px）
   * @param {string} [color] - 线条/填充主色
   * @returns {boolean} 是否绘制了图标（未知名返回 false，调用方可回退）
   */
  draw(ctx, name, cx, cy, size, color = DEFAULT_COLOR) {
    const painter = PAINTERS[name];
    if (!painter) return false;
    const s = Math.max(8, size);
    const lineWidth = Math.max(1, s * 0.075);
    ctx.save();
    painter(ctx, cx, cy, s, color, lineWidth);
    ctx.restore();
    return true;
  }
};

export default HudIconPainter;
