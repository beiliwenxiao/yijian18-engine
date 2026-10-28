/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * NpcRenderStyles.js
 * NPC 内置代码立绘渲染样式库。
 *
 * 用于「无序列帧图片时」用代码绘制精美 NPC 立绘（移植自旧 ActXScene 的 renderNPC/renderCookNPC）。
 * NPC 定义 library.npcs[].renderStyle 指定样式 key。
 *
 * 渲染优先级（BaseGameScene.renderEntity）：
 *   序列帧图片 > renderStyle 代码立绘 > 占位色块
 *
 * 每个绘制函数签名：draw(ctx, x, y, scale)
 *   (x, y) = 底部中心锚点（脚下）；scale = 缩放系数（默认 1）。
 *   不绘制名字/称号（由 renderEntity 统一绘制，避免重复）。
 */

/** 张角立绘（黄色道袍 + 道冠 + 拂尘 + 长须） */
function drawZhangjiao(ctx, x, y, scale = 1) {
  ctx.save();
  const s = 40 * scale;

  // 地面阴影
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(x, y + s * 0.05, s * 0.5, s * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  // 左腿
  ctx.strokeStyle = '#d4a574';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - s * 0.15, y - s * 0.5);
  ctx.quadraticCurveTo(x - s * 0.17, y - s * 0.28, x - s * 0.18, y - s * 0.05);
  ctx.stroke();
  ctx.fillStyle = '#2a2a2a';
  ctx.beginPath();
  ctx.ellipse(x - s * 0.18, y - s * 0.02, s * 0.09, s * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();

  // 右腿
  ctx.strokeStyle = '#d4a574';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.15, y - s * 0.5);
  ctx.quadraticCurveTo(x + s * 0.17, y - s * 0.28, x + s * 0.18, y - s * 0.05);
  ctx.stroke();
  ctx.fillStyle = '#2a2a2a';
  ctx.beginPath();
  ctx.ellipse(x + s * 0.18, y - s * 0.02, s * 0.09, s * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();

  // 道袍身体
  const bodyGrad = ctx.createLinearGradient(x, y - s * 1.15, x, y - s * 0.45);
  bodyGrad.addColorStop(0, '#c8a84e');
  bodyGrad.addColorStop(0.5, '#b89840');
  bodyGrad.addColorStop(1, '#a08830');
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.42, y - s * 1.08);
  ctx.quadraticCurveTo(x - s * 0.5, y - s * 0.8, x - s * 0.38, y - s * 0.45);
  ctx.lineTo(x + s * 0.38, y - s * 0.45);
  ctx.quadraticCurveTo(x + s * 0.5, y - s * 0.8, x + s * 0.42, y - s * 1.08);
  ctx.closePath();
  ctx.fill();

  // 道袍中线
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y - s * 1.05);
  ctx.lineTo(x, y - s * 0.45);
  ctx.stroke();

  // 腰带
  ctx.fillStyle = '#5a4a20';
  ctx.fillRect(x - s * 0.42, y - s * 0.78, s * 0.84, s * 0.08);

  // 左臂 + 袖 + 手
  ctx.strokeStyle = '#d4a574';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - s * 0.42, y - s * 1.0);
  ctx.quadraticCurveTo(x - s * 0.55, y - s * 0.8, x - s * 0.5, y - s * 0.6);
  ctx.stroke();
  ctx.strokeStyle = '#b89840';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.42, y - s * 1.0);
  ctx.lineTo(x - s * 0.48, y - s * 0.9);
  ctx.stroke();
  ctx.fillStyle = '#d4a574';
  ctx.beginPath();
  ctx.arc(x - s * 0.5, y - s * 0.6, s * 0.055, 0, Math.PI * 2);
  ctx.fill();

  // 右臂 + 袖 + 手
  ctx.strokeStyle = '#d4a574';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.42, y - s * 1.0);
  ctx.quadraticCurveTo(x + s * 0.55, y - s * 0.8, x + s * 0.5, y - s * 0.6);
  ctx.stroke();
  ctx.strokeStyle = '#b89840';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.42, y - s * 1.0);
  ctx.lineTo(x + s * 0.48, y - s * 0.9);
  ctx.stroke();
  ctx.fillStyle = '#d4a574';
  ctx.beginPath();
  ctx.arc(x + s * 0.5, y - s * 0.6, s * 0.055, 0, Math.PI * 2);
  ctx.fill();

  // 拂尘
  ctx.strokeStyle = '#8B6914';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.5, y - s * 0.6);
  ctx.lineTo(x + s * 0.55, y - s * 1.4);
  ctx.stroke();
  ctx.strokeStyle = '#e8e0d0';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(x + s * 0.55, y - s * 1.4);
    ctx.quadraticCurveTo(
      x + s * 0.55 + (i - 2) * 3, y - s * 1.25,
      x + s * 0.55 + (i - 2) * 4, y - s * 1.1
    );
    ctx.stroke();
  }

  // 脖子
  ctx.fillStyle = '#d4a574';
  ctx.fillRect(x - s * 0.07, y - s * 1.16, s * 0.14, s * 0.1);

  // 头部
  const headY = y - s * 1.4;
  const headGrad = ctx.createRadialGradient(x - s * 0.04, headY - s * 0.04, 0, x, headY, s * 0.32);
  headGrad.addColorStop(0, '#f5d4a8');
  headGrad.addColorStop(1, '#d4a574');
  ctx.fillStyle = headGrad;
  ctx.beginPath();
  ctx.arc(x, headY, s * 0.3, 0, Math.PI * 2);
  ctx.fill();

  // 发髻
  ctx.fillStyle = '#2a2a2a';
  ctx.beginPath();
  ctx.arc(x, headY - s * 0.06, s * 0.28, Math.PI * 0.8, Math.PI * 2.2);
  ctx.fill();
  ctx.fillStyle = '#c8a84e';
  ctx.beginPath();
  ctx.ellipse(x, headY - s * 0.35, s * 0.08, s * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8B6914';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 长须
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.06, headY + s * 0.2);
  ctx.quadraticCurveTo(x - s * 0.08, headY + s * 0.45, x - s * 0.05, headY + s * 0.6);
  ctx.moveTo(x, headY + s * 0.22);
  ctx.quadraticCurveTo(x, headY + s * 0.45, x + s * 0.02, headY + s * 0.65);
  ctx.moveTo(x + s * 0.06, headY + s * 0.2);
  ctx.quadraticCurveTo(x + s * 0.08, headY + s * 0.45, x + s * 0.05, headY + s * 0.6);
  ctx.stroke();

  // 眉毛
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.16, headY - s * 0.06);
  ctx.lineTo(x - s * 0.07, headY - s * 0.08);
  ctx.moveTo(x + s * 0.07, headY - s * 0.08);
  ctx.lineTo(x + s * 0.16, headY - s * 0.06);
  ctx.stroke();

  // 眼睛
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(x - s * 0.11, headY + s * 0.01, s * 0.04, s * 0.03, 0, 0, Math.PI * 2);
  ctx.ellipse(x + s * 0.11, headY + s * 0.01, s * 0.04, s * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.arc(x - s * 0.11, headY + s * 0.01, s * 0.025, 0, Math.PI * 2);
  ctx.arc(x + s * 0.11, headY + s * 0.01, s * 0.025, 0, Math.PI * 2);
  ctx.fill();

  // 嘴巴
  ctx.strokeStyle = '#a07050';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, headY + s * 0.15, s * 0.04, 0.2, Math.PI - 0.2);
  ctx.stroke();

  ctx.restore();
}

/** 粥棚伙夫立绘（灰衣 + 围裙 + 头巾 + 勺子） */
function drawCook(ctx, x, y, scale = 1) {
  ctx.save();
  const s = 30 * scale;

  // 阴影
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.ellipse(x, y + s * 0.05, s * 0.4, s * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // 腿
  ctx.strokeStyle = '#8B6914';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - s * 0.12, y - s * 0.4);
  ctx.lineTo(x - s * 0.15, y - s * 0.05);
  ctx.moveTo(x + s * 0.12, y - s * 0.4);
  ctx.lineTo(x + s * 0.15, y - s * 0.05);
  ctx.stroke();

  // 身体
  ctx.fillStyle = '#787878';
  ctx.beginPath();
  ctx.moveTo(x - s * 0.35, y - s * 0.95);
  ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.65, x - s * 0.3, y - s * 0.4);
  ctx.lineTo(x + s * 0.3, y - s * 0.4);
  ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.65, x + s * 0.35, y - s * 0.95);
  ctx.closePath();
  ctx.fill();

  // 围裙
  ctx.fillStyle = '#a09080';
  ctx.fillRect(x - s * 0.25, y - s * 0.7, s * 0.5, s * 0.3);

  // 右臂 + 勺子
  ctx.strokeStyle = '#d4a574';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.35, y - s * 0.85);
  ctx.quadraticCurveTo(x + s * 0.6, y - s * 0.7, x + s * 0.55, y - s * 0.5);
  ctx.stroke();
  ctx.strokeStyle = '#6b4226';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.55, y - s * 0.5);
  ctx.lineTo(x + s * 0.7, y - s * 0.2);
  ctx.stroke();
  ctx.fillStyle = '#6b4226';
  ctx.beginPath();
  ctx.ellipse(x + s * 0.7, y - s * 0.15, 4, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // 左臂
  ctx.strokeStyle = '#d4a574';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.35, y - s * 0.85);
  ctx.quadraticCurveTo(x - s * 0.5, y - s * 0.65, x - s * 0.4, y - s * 0.5);
  ctx.stroke();

  // 脖子 + 头
  ctx.fillStyle = '#d4a574';
  ctx.fillRect(x - s * 0.06, y - s * 1.05, s * 0.12, s * 0.1);
  ctx.beginPath();
  ctx.arc(x, y - s * 1.25, s * 0.22, 0, Math.PI * 2);
  ctx.fill();

  // 头巾
  ctx.fillStyle = '#a09080';
  ctx.beginPath();
  ctx.arc(x, y - s * 1.3, s * 0.2, Math.PI * 0.85, Math.PI * 2.15);
  ctx.fill();

  // 眼睛
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.arc(x - s * 0.08, y - s * 1.24, 1.5, 0, Math.PI * 2);
  ctx.arc(x + s * 0.08, y - s * 1.24, 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** 煮粥大锅（火焰/柴火/粥面气泡/蒸汽，带动画）。(x,y) = 锅的中心。 */
function drawCauldron(ctx, x, y, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  if (scale !== 1) ctx.scale(scale, scale);
  x = 0; y = 0;
  const time = performance.now() / 200;

  // 锅底火焰
  ctx.fillStyle = '#ff6600';
  for (let i = 0; i < 7; i++) {
    const fx = x - 18 + i * 6;
    const fh = 10 + Math.sin(time + i * 1.3) * 6;
    ctx.globalAlpha = 0.6 + Math.sin(time + i) * 0.3;
    ctx.beginPath();
    ctx.ellipse(fx, y + 20, 4, fh, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 柴火
  ctx.strokeStyle = '#5a3a1a';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 30, y + 26); ctx.lineTo(x + 20, y + 22);
  ctx.moveTo(x - 20, y + 30); ctx.lineTo(x + 30, y + 24);
  ctx.moveTo(x - 12, y + 22); ctx.lineTo(x + 10, y + 32);
  ctx.stroke();

  // 锅身
  ctx.fillStyle = '#2a2a2a';
  ctx.beginPath();
  ctx.ellipse(x, y + 3, 36, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 3;
  ctx.stroke();

  // 锅口（粥）
  ctx.fillStyle = '#d4c8a0';
  ctx.beginPath();
  ctx.ellipse(x, y - 8, 30, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  // 粥面气泡
  ctx.fillStyle = '#e8dcc0';
  for (let i = 0; i < 4; i++) {
    const bx = x - 12 + i * 8 + Math.sin(time * 0.7 + i * 2) * 4;
    const by = y - 9 + Math.sin(time + i) * 2;
    ctx.beginPath();
    ctx.arc(bx, by, 3 + Math.sin(time + i) * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // 蒸汽
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const sx = x - 10 + i * 7;
    const sOffset = Math.sin(time * 0.5 + i * 1.5) * 6;
    ctx.beginPath();
    ctx.moveTo(sx, y - 16);
    ctx.quadraticCurveTo(sx + sOffset, y - 35, sx - sOffset, y - 55);
    ctx.stroke();
  }

  // 锅边高光
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(x, y - 8, 30, 13, 0, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();

  ctx.restore();
}

/** 张梁立绘（战士，红色铠甲 + 头盔 + 大刀） */
function drawZhangliang(ctx, x, y, scale = 1) {
  ctx.save();
  const s = 26 * scale;
  // 阴影
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.ellipse(x, y + s * 0.05, s * 0.55, s * 0.13, 0, 0, Math.PI * 2); ctx.fill();
  // 腿（铠甲裙摆）
  ctx.fillStyle = '#8B0000';
  ctx.beginPath();
  ctx.moveTo(x - s * 0.35, y - s * 0.5);
  ctx.lineTo(x - s * 0.38, y - s * 0.05);
  ctx.lineTo(x + s * 0.38, y - s * 0.05);
  ctx.lineTo(x + s * 0.35, y - s * 0.5);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#4a0000';
  ctx.beginPath(); ctx.ellipse(x - s * 0.22, y - s * 0.02, s * 0.1, s * 0.05, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x + s * 0.22, y - s * 0.02, s * 0.1, s * 0.05, 0, 0, Math.PI * 2); ctx.fill();
  // 身体（红色铠甲）
  const bg = ctx.createLinearGradient(x, y - s * 1.15, x, y - s * 0.45);
  bg.addColorStop(0, '#cc2200'); bg.addColorStop(0.5, '#aa1800'); bg.addColorStop(1, '#881000');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.45, y - s * 1.1); ctx.lineTo(x - s * 0.48, y - s * 0.5);
  ctx.lineTo(x + s * 0.48, y - s * 0.5); ctx.lineTo(x + s * 0.45, y - s * 1.1);
  ctx.closePath(); ctx.fill();
  // 铠甲纹路
  ctx.strokeStyle = '#ff4422'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(x - s * 0.3, y - s * 1.05); ctx.lineTo(x - s * 0.3, y - s * 0.55); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + s * 0.3, y - s * 1.05); ctx.lineTo(x + s * 0.3, y - s * 0.55); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - s * 0.45, y - s * 0.8); ctx.lineTo(x + s * 0.45, y - s * 0.8); ctx.stroke();
  // 护肩
  ctx.fillStyle = '#cc2200';
  ctx.beginPath(); ctx.ellipse(x - s * 0.5, y - s * 1.0, s * 0.15, s * 0.1, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x + s * 0.5, y - s * 1.0, s * 0.15, s * 0.1, 0.3, 0, Math.PI * 2); ctx.fill();
  // 臂
  ctx.strokeStyle = '#c47050'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - s * 0.48, y - s * 0.98); ctx.quadraticCurveTo(x - s * 0.58, y - s * 0.78, x - s * 0.52, y - s * 0.58); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + s * 0.48, y - s * 0.98); ctx.quadraticCurveTo(x + s * 0.58, y - s * 0.78, x + s * 0.52, y - s * 0.58); ctx.stroke();
  // 右手持大刀
  ctx.strokeStyle = '#888'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(x + s * 0.52, y - s * 0.58); ctx.lineTo(x + s * 0.6, y - s * 1.5); ctx.stroke();
  ctx.fillStyle = '#aaa';
  ctx.beginPath(); ctx.moveTo(x + s * 0.55, y - s * 1.5); ctx.lineTo(x + s * 0.72, y - s * 1.35); ctx.lineTo(x + s * 0.58, y - s * 1.2); ctx.closePath(); ctx.fill();
  // 头
  const headY = y - s * 1.38;
  ctx.fillStyle = '#c47050'; ctx.beginPath(); ctx.arc(x, headY, s * 0.3, 0, Math.PI * 2); ctx.fill();
  // 头盔
  ctx.fillStyle = '#aa1800';
  ctx.beginPath(); ctx.arc(x, headY - s * 0.05, s * 0.32, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#cc2200';
  ctx.beginPath(); ctx.ellipse(x, headY - s * 0.05, s * 0.32, s * 0.1, 0, 0, Math.PI * 2); ctx.fill();
  // 头盔顶饰
  ctx.fillStyle = '#FFD700';
  ctx.beginPath(); ctx.moveTo(x - s * 0.05, headY - s * 0.35); ctx.lineTo(x + s * 0.05, headY - s * 0.35); ctx.lineTo(x, headY - s * 0.55); ctx.closePath(); ctx.fill();
  // 眼
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.arc(x - s * 0.11, headY + s * 0.02, s * 0.03, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + s * 0.11, headY + s * 0.02, s * 0.03, 0, Math.PI * 2); ctx.fill();
  // 胡须
  ctx.strokeStyle = '#333'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(x - s * 0.08, headY + s * 0.18); ctx.quadraticCurveTo(x - s * 0.1, headY + s * 0.38, x - s * 0.06, headY + s * 0.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + s * 0.08, headY + s * 0.18); ctx.quadraticCurveTo(x + s * 0.1, headY + s * 0.38, x + s * 0.06, headY + s * 0.5); ctx.stroke();
  ctx.restore();
}

/** 张宝立绘（弓箭手，绿色猎装 + 弓 + 箭袋） */
function drawZhangbao(ctx, x, y, scale = 1) {
  ctx.save();
  const s = 24 * scale;
  // 阴影
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.ellipse(x, y + s * 0.05, s * 0.5, s * 0.12, 0, 0, Math.PI * 2); ctx.fill();
  // 腿
  ctx.strokeStyle = '#4a6a30'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - s * 0.15, y - s * 0.5); ctx.lineTo(x - s * 0.16, y - s * 0.05); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + s * 0.15, y - s * 0.5); ctx.lineTo(x + s * 0.16, y - s * 0.05); ctx.stroke();
  ctx.fillStyle = '#2a3a18';
  ctx.beginPath(); ctx.ellipse(x - s * 0.16, y - s * 0.02, s * 0.09, s * 0.05, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x + s * 0.16, y - s * 0.02, s * 0.09, s * 0.05, 0, 0, Math.PI * 2); ctx.fill();
  // 身体（绿色猎装）
  const bg = ctx.createLinearGradient(x, y - s * 1.1, x, y - s * 0.45);
  bg.addColorStop(0, '#4a7a30'); bg.addColorStop(1, '#2a5a18');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.4, y - s * 1.05); ctx.quadraticCurveTo(x - s * 0.46, y - s * 0.8, x - s * 0.36, y - s * 0.45);
  ctx.lineTo(x + s * 0.36, y - s * 0.45); ctx.quadraticCurveTo(x + s * 0.46, y - s * 0.8, x + s * 0.4, y - s * 1.05);
  ctx.closePath(); ctx.fill();
  // 腰带
  ctx.fillStyle = '#3a2810'; ctx.fillRect(x - s * 0.38, y - s * 0.73, s * 0.76, s * 0.07);
  // 箭袋（背后）
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(x + s * 0.3, y - s * 1.05, s * 0.12, s * 0.45);
  ctx.strokeStyle = '#5a2a08'; ctx.lineWidth = 0.8; ctx.strokeRect(x + s * 0.3, y - s * 1.05, s * 0.12, s * 0.45);
  // 箭
  ctx.strokeStyle = '#8B6914'; ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.moveTo(x + s * 0.33 + i * 3, y - s * 1.05); ctx.lineTo(x + s * 0.33 + i * 3, y - s * 1.25); ctx.stroke();
  }
  // 臂
  ctx.strokeStyle = '#c4a070'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x - s * 0.4, y - s * 0.98); ctx.quadraticCurveTo(x - s * 0.52, y - s * 0.78, x - s * 0.48, y - s * 0.58); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + s * 0.4, y - s * 0.98); ctx.quadraticCurveTo(x + s * 0.52, y - s * 0.78, x + s * 0.48, y - s * 0.58); ctx.stroke();
  // 左手持弓
  ctx.strokeStyle = '#8B4513'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x - s * 0.48, y - s * 0.88, s * 0.32, -0.8, 0.8); ctx.stroke();
  ctx.strokeStyle = '#c8a870'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(x - s * 0.48 + s * 0.32 * Math.cos(-0.8), y - s * 0.88 + s * 0.32 * Math.sin(-0.8));
  ctx.lineTo(x - s * 0.48 + s * 0.32 * Math.cos(0.8), y - s * 0.88 + s * 0.32 * Math.sin(0.8)); ctx.stroke();
  // 头
  const headY = y - s * 1.33;
  ctx.fillStyle = '#c4a070'; ctx.beginPath(); ctx.arc(x, headY, s * 0.28, 0, Math.PI * 2); ctx.fill();
  // 头巾（绿色）
  ctx.fillStyle = '#2a5a18';
  ctx.beginPath(); ctx.arc(x, headY - s * 0.05, s * 0.3, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#4a7a30';
  ctx.beginPath(); ctx.ellipse(x, headY - s * 0.05, s * 0.3, s * 0.1, 0, 0, Math.PI * 2); ctx.fill();
  // 头巾飘带
  ctx.strokeStyle = '#2a5a18'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x + s * 0.28, headY - s * 0.05); ctx.quadraticCurveTo(x + s * 0.4, headY + s * 0.1, x + s * 0.35, headY + s * 0.3); ctx.stroke();
  // 眼
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.arc(x - s * 0.1, headY + s * 0.01, s * 0.025, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + s * 0.1, headY + s * 0.01, s * 0.025, 0, Math.PI * 2); ctx.fill();
  // 嘴
  ctx.strokeStyle = '#8B5030'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, headY + s * 0.12, s * 0.05, 0.2, Math.PI - 0.2); ctx.stroke();
  ctx.restore();
}

/************************************************************
 * 点光源物品代码绘制样式（物品定义 renderStyle；无专属贴图时的框架级兜底，
 * 出专属贴图后定义 imageId 即自动让位——有图优先，代码画法不再触发）。
 * (x, y) = 落地面点（脚底锚点），scale = sprite.scale。
 * 火苗动画用 performance.now()（与 drawCauldron 同款）；光晕由 glow 属性渲染，不在此画。
 ************************************************************/

/** 画单支火苗（泪滴形，双层焰色，随时间摆动）。flameH=焰高，cx=焰心 x，baseY=焰根 y。 */
function drawFlameTongue(ctx, cx, baseY, flameH, time, phase = 0) {
  const sway = Math.sin(time * 5.2 + phase) * flameH * 0.16
    + Math.sin(time * 11.7 + phase * 2.3) * flameH * 0.05;
  const tipX = cx + sway;
  const tipY = baseY - flameH * (0.92 + Math.sin(time * 7.3 + phase) * 0.08);
  const halfW = flameH * 0.34;
  // 外焰
  ctx.fillStyle = 'rgba(255, 122, 30, 0.88)';
  ctx.beginPath();
  ctx.moveTo(cx - halfW, baseY);
  ctx.quadraticCurveTo(cx - halfW * 0.9, baseY - flameH * 0.55, tipX, tipY);
  ctx.quadraticCurveTo(cx + halfW * 0.9, baseY - flameH * 0.55, cx + halfW, baseY);
  ctx.closePath();
  ctx.fill();
  // 内焰（亮黄，约六成高）
  ctx.fillStyle = 'rgba(255, 214, 110, 0.95)';
  ctx.beginPath();
  ctx.moveTo(cx - halfW * 0.55, baseY);
  ctx.quadraticCurveTo(cx - halfW * 0.5, baseY - flameH * 0.38, cx + sway * 0.6, baseY - flameH * 0.62);
  ctx.quadraticCurveTo(cx + halfW * 0.5, baseY - flameH * 0.38, cx + halfW * 0.55, baseY);
  ctx.closePath();
  ctx.fill();
  // 焰芯（近白）
  ctx.fillStyle = 'rgba(255, 248, 225, 0.9)';
  ctx.beginPath();
  ctx.ellipse(cx, baseY - flameH * 0.16, halfW * 0.22, flameH * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** 蜡烛：蜡柱 + 烛泪 + 烛芯火苗。 */
function drawCandle(ctx, x, y, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  if (scale !== 1) ctx.scale(scale, scale);
  const time = performance.now() / 1000;

  // 蜡柱（奶白圆柱，微暖底色）
  ctx.fillStyle = '#f3ead2';
  ctx.beginPath();
  ctx.roundRect(-6, -26, 12, 26, 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 100, 70, 0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 蜡柱左侧受光面
  ctx.fillStyle = 'rgba(255, 252, 240, 0.85)';
  ctx.fillRect(-6, -26, 3.5, 26);
  // 烛泪（顶部熔蜡垂流）
  ctx.fillStyle = '#fbf5e2';
  ctx.beginPath();
  ctx.ellipse(0, -25.5, 7.5, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(5, -21, 1.6, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // 烛芯
  ctx.strokeStyle = '#3a3026';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, -26);
  ctx.lineTo(0, -29);
  ctx.stroke();
  // 火苗
  drawFlameTongue(ctx, 0, -28, 15, time);
  // 烛座落影圈
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 10, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 火把：斜倚木柄 + 缠布火头 + 火苗。 */
function drawTorch(ctx, x, y, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  if (scale !== 1) ctx.scale(scale, scale);
  const time = performance.now() / 1000;

  // 木柄（略后仰）
  ctx.strokeStyle = '#7a5a34';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(2, -40);
  ctx.stroke();
  // 柄身高光
  ctx.strokeStyle = 'rgba(190, 150, 95, 0.7)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-1.2, -4);
  ctx.lineTo(0.6, -36);
  ctx.stroke();
  // 缠布火头（深色浸油布圈）
  ctx.fillStyle = '#4a3620';
  ctx.beginPath();
  ctx.roundRect(-4.5, -48, 11, 11, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 160, 70, 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 绑绳
  ctx.strokeStyle = '#8a6a3a';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-4.5, -44);
  ctx.lineTo(6.5, -44);
  ctx.stroke();
  // 火苗（双火舌错相）
  drawFlameTongue(ctx, 1, -47, 24, time, 0.8);
  drawFlameTongue(ctx, 4, -46, 13, time, 2.6);
  // 落影圈
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 9, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 火堆共用：石圈 + 交叉柴堆。(x,y)=落地点中心。返回柴堆顶部 y（供火苗定位）。 */
function drawCampfireBase(ctx, x, y, scale) {
  ctx.save();
  ctx.translate(x, y);
  if (scale !== 1) ctx.scale(scale, scale);
  // 石圈（一圈灰石，前后两排制造 2.5D 层次）
  const stones = [
    [-26, 6, 8, 5.5], [-10, 10, 9, 6], [8, 10.5, 9, 6], [24, 6.5, 8, 5.5],
    [-24, -8, 7.5, 5], [-6, -12, 8.5, 5.5], [12, -11.5, 8, 5.5], [25, -7, 7, 5]
  ];
  for (const [sx, sy, sr, sry] of stones) {
    ctx.fillStyle = '#6f6a63';
    ctx.beginPath();
    ctx.ellipse(sx, sy, sr, sry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.beginPath();
    ctx.ellipse(sx - sr * 0.25, sy - sry * 0.3, sr * 0.5, sry * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 炭床
  ctx.fillStyle = '#241b14';
  ctx.beginPath();
  ctx.ellipse(0, 0, 24, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  // 交叉柴堆
  ctx.strokeStyle = '#5a3f24';
  ctx.lineCap = 'round';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-16, 2); ctx.lineTo(14, -8);
  ctx.moveTo(-14, -8); ctx.lineTo(16, 2);
  ctx.stroke();
  ctx.strokeStyle = '#6d4d2c';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-8, -3); ctx.lineTo(10, -4);
  ctx.moveTo(-2, 4); ctx.lineTo(6, -12);
  ctx.stroke();
  ctx.restore();
  return y - 8 * scale;
}

/** 火堆（点燃）：柴堆之上三层火苗 + 底部炭光。 */
function drawCampfireLit(ctx, x, y, scale = 1) {
  const flameBaseY = drawCampfireBase(ctx, x, y, scale);
  const time = performance.now() / 1000;
  // 炭光（柴堆缝隙透出的红光，呼吸）
  ctx.save();
  ctx.translate(x, y);
  if (scale !== 1) ctx.scale(scale, scale);
  ctx.fillStyle = `rgba(255, 90, 30, ${0.25 + Math.sin(time * 3.1) * 0.12})`;
  ctx.beginPath();
  ctx.ellipse(0, -2, 15, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // 主火苗 + 两个侧火舌（不同相位/高度，错落摇曳）
  drawFlameTongue(ctx, x, flameBaseY, 34 * scale, time, 0);
  drawFlameTongue(ctx, x - 9 * scale, flameBaseY, 20 * scale, time, 2.1);
  drawFlameTongue(ctx, x + 10 * scale, flameBaseY, 17 * scale, time, 4.4);
}

/** 熄灭的火堆：柴堆 + 覆灰炭块 + 微弱余烬明灭（无火苗）。 */
function drawCampfireUnlit(ctx, x, y, scale = 1) {
  const flameBaseY = drawCampfireBase(ctx, x, y, scale);
  ctx.save();
  ctx.translate(x, y);
  if (scale !== 1) ctx.scale(scale, scale);
  const time = performance.now() / 1000;
  // 覆灰（炭床上灰白斑块）
  ctx.fillStyle = 'rgba(150, 145, 138, 0.5)';
  ctx.beginPath();
  ctx.ellipse(-4, -3, 13, 5, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(9, 1, 8, 3.5, -0.15, 0, Math.PI * 2);
  ctx.fill();
  // 余烬（2-3 个暗红点，极缓慢明灭——"刚熄灭还温着"）
  const embers = [[-8, 0], [4, -4], [12, 2]];
  for (let i = 0; i < embers.length; i++) {
    const [ex, ey] = embers[i];
    const pulse = 0.35 + 0.3 * Math.sin(time * 1.1 + i * 2.4);
    ctx.fillStyle = `rgba(230, 80, 40, ${pulse})`;
    ctx.beginPath();
    ctx.arc(ex, ey, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // 一缕细烟（半透明上飘短线，随时间上移循环）
  const smokeT = (time * 0.35) % 1;
  ctx.strokeStyle = `rgba(200, 200, 200, ${0.22 * (1 - smokeT)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(Math.sin(time * 1.7) * 3, flameBaseY - smokeT * 26);
  ctx.quadraticCurveTo(
    Math.sin(time * 1.7 + 1.2) * 5, flameBaseY - smokeT * 26 - 8,
    Math.sin(time * 1.7 + 2.1) * 4, flameBaseY - smokeT * 26 - 16
  );
  ctx.stroke();
  ctx.restore();
}

/** 萤火虫：3 只悬停光点（利萨茹漂移 + 各自明灭），光晕由 glow 渲染补足。 */
function drawFirefly(ctx, x, y, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  if (scale !== 1) ctx.scale(scale, scale);
  const time = performance.now() / 1000;
  const flies = [
    { ax: 9, ay: 5, fx: 0.9, fy: 1.3, ph: 0 },
    { ax: 7, ay: 7, fx: 1.4, fy: 0.7, ph: 2.1 },
    { ax: 5, ay: 4, fx: 0.6, fy: 1.8, ph: 4.2 }
  ];
  for (const fly of flies) {
    const fx = Math.sin(time * fly.fx * 2 + fly.ph) * fly.ax;
    const fy = -14 + Math.sin(time * fly.fy * 2 + fly.ph * 1.7) * fly.ay;
    const glowPulse = 0.45 + 0.4 * Math.sin(time * 2.2 + fly.ph * 3.1);
    // 微光晕
    const halo = ctx.createRadialGradient(fx, fy, 0, fx, fy, 7);
    halo.addColorStop(0, `rgba(190, 255, 170, ${0.5 * glowPulse})`);
    halo.addColorStop(1, 'rgba(190, 255, 170, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(fx, fy, 7, 0, Math.PI * 2);
    ctx.fill();
    // 虫体（暗色小点，隐在光里）
    ctx.fillStyle = `rgba(40, 60, 35, 0.9)`;
    ctx.beginPath();
    ctx.arc(fx, fy, 1.4, 0, Math.PI * 2);
    ctx.fill();
    // 腹部荧光点
    ctx.fillStyle = `rgba(215, 255, 190, ${0.55 + 0.45 * glowPulse})`;
    ctx.beginPath();
    ctx.arc(fx, fy + 0.6, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 样式注册表：renderStyle key → 绘制函数 */
const NPC_RENDER_STYLES = {
  zhangjiao: drawZhangjiao,
  cook: drawCook,
  cauldron: drawCauldron,
  zhangliang: drawZhangliang,
  zhangbao: drawZhangbao,
  candle: drawCandle,
  torch: drawTorch,
  campfire_lit: drawCampfireLit,
  campfire_unlit: drawCampfireUnlit,
  firefly: drawFirefly
};

/** 获取指定样式的绘制函数（不存在返回 null） */
export function getNpcRenderStyle(styleKey) {
  return NPC_RENDER_STYLES[styleKey] || null;
}

/** 注册自定义 NPC 渲染样式（供扩展） */
export function registerNpcRenderStyle(key, drawFn) {
  if (key && typeof drawFn === 'function') NPC_RENDER_STYLES[key] = drawFn;
}

export { NPC_RENDER_STYLES };
