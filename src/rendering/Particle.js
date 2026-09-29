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
 * Particle - 粒子类
 * 表示单个粒子的属性和行为
 */
export class Particle {
  /**
   * @param {Object} config - 粒子配置
   * @param {Object} config.position - 初始位置 {x, y}
   * @param {Object} config.velocity - 初始速度 {x, y}
   * @param {number} config.life - 生命周期（毫秒）
   * @param {number} config.size - 粒子大小
   * @param {string} config.color - 粒子颜色
   * @param {number} [config.alpha=1] - 初始透明度
   * @param {number} [config.gravity=0] - 重力加速度
   * @param {number} [config.friction=1] - 摩擦系数
   */
  constructor(config) {
    this.position = { ...config.position };
    this.velocity = { ...config.velocity };
    this.life = config.life;
    this.maxLife = config.life;
    this.size = config.size;
    this.color = config.color;
    this.alpha = config.alpha !== undefined ? config.alpha : 1;
    this.initialAlpha = this.alpha;
    this.gravity = config.gravity || 0;
    this.friction = config.friction !== undefined ? config.friction : 1;
    this.shape = config.shape || 'circle'; // circle / streak / ripple / star
    // 行为语义必须显式传递（isFire=true 才有火舌摆动与发光渲染）；颜色仅是表现参数，不做推断。
    this.isFire = config.isFire === true;
    this.renderLayer = config.renderLayer || 'effects';
    this.blendMode = config.blendMode || 'source-over';
    this.sortY = Number.isFinite(config.sortY) ? config.sortY : this.position.y;
    this.active = true;
    // 记录初始位置，供 3D 渲染器做坐标映射
    this.initialPosition = { ...config.position };
  }

  /**
   * 更新粒子状态
   * @param {number} deltaTime - 时间增量（秒）
   */
  update(deltaTime) {
    if (!this.active) return;

    // 更新生命周期
    this.life -= deltaTime * 1000;
    if (this.life <= 0) {
      this.active = false;
      return;
    }

    // 应用重力
    this.velocity.y += this.gravity * deltaTime;

    // 应用摩擦
    this.velocity.x *= this.friction;
    this.velocity.y *= this.friction;

    // 火焰粒子特殊效果：随着上升，水平摆动增加（形成火舌）
    if (this.isFire) {
      const lifeRatio = this.life / this.maxLife;
      const ageRatio = 1 - lifeRatio; // 0到1，0是刚生成，1是快消失

      // 随着粒子上升，增加水平摆动（形成顶部的尖锐火舌）；幅度收敛让跳动更沉稳
      const swingMultiplier = ageRatio * 2; // 上升过程中摆动增加2倍
      const time = performance.now() / 1000;
      const swing = Math.sin(time * 8 + this.position.x * 0.1) * 8 * swingMultiplier;

      this.velocity.x += swing * deltaTime;
    }

    // 更新位置
    this.position.x += this.velocity.x * deltaTime;
    this.position.y += this.velocity.y * deltaTime;

    // 更新透明度（使用非线性衰减，让火焰更清晰）
    const lifeRatio = this.life / this.maxLife;
    
    // 火焰效果：前80%生命周期保持明亮，最后20%快速消失
    if (lifeRatio > 0.2) {
      this.alpha = this.initialAlpha;
    } else {
      // 最后20%生命周期快速衰减
      const fadeRatio = lifeRatio / 0.2;
      this.alpha = this.initialAlpha * fadeRatio;
    }
  }

  /**
   * 渲染粒子
   * @param {CanvasRenderingContext2D} ctx - Canvas 渲染上下文
   * @param {Object} camera - 相机对象（用于视锥剔除，但不用于坐标转换）
   */
  render(ctx, camera) {
    if (!this.active) return;

    const screenX = this.position.x;
    const screenY = this.position.y;
    
    if (!isFinite(screenX) || !isFinite(screenY)) return;

    ctx.save();
    ctx.globalCompositeOperation = this.blendMode;
    ctx.globalAlpha = this.alpha;
    
    const safeSize = Math.max(0.1, this.size || 1);

    if (this.shape === 'streak') {
      // 水面横向光条：扁平水平椭圆，沿速度方向拉伸
      const len = safeSize * 3.5;
      const h = safeSize * 0.6;
      ctx.fillStyle = this.color || '#88ccee';
      ctx.beginPath();
      ctx.ellipse(screenX, screenY, len, h, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.shape === 'ripple') {
      // 涟漪：扁平椭圆环，随生命扩大并淡出
      const lifeRatio = this.life / this.maxLife;
      const expandScale = 1 + (1 - lifeRatio) * 2; // 从 1x 扩大到 3x
      const rx = safeSize * expandScale * 2;
      const ry = safeSize * expandScale * 0.8;
      ctx.strokeStyle = this.color || '#aaddee';
      ctx.lineWidth = Math.max(0.5, safeSize * 0.4 * lifeRatio);
      ctx.beginPath();
      ctx.ellipse(screenX, screenY, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (this.shape === 'star') {
      // 物品发现星光：五角星，纯表现且不参与世界几何。
      const outer = safeSize * 1.45;
      const inner = safeSize * 0.62;
      ctx.fillStyle = this.color || '#ffe27a';
      ctx.beginPath();
      for (let index = 0; index < 10; index++) {
        const radius = index % 2 === 0 ? outer : inner;
        const angle = -Math.PI / 2 + index * Math.PI / 5;
        const x = screenX + Math.cos(angle) * radius;
        const y = screenY + Math.sin(angle) * radius;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    } else if (this.isFire) {
      // 火焰粒子：径向渐变发光
      const glowGradient = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, safeSize * 1.5);
      glowGradient.addColorStop(0, this.color);
      glowGradient.addColorStop(0.5, this.color + '80');
      glowGradient.addColorStop(1, this.color + '00');
      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.arc(screenX, screenY, safeSize * 1.5, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(screenX, screenY, safeSize * 0.6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 默认圆形粒子
      ctx.fillStyle = this.color || '#ffffff';
      ctx.beginPath();
      ctx.arc(screenX, screenY, safeSize, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.restore();
  }

  /**
   * 重置粒子（用于对象池）
   * @param {Object} config - 新的粒子配置
   */
  reset(config) {
    this.position = { ...config.position };
    this.velocity = { ...config.velocity };
    this.life = config.life;
    this.maxLife = config.life;
    this.size = config.size;
    this.color = config.color;
    this.alpha = config.alpha !== undefined ? config.alpha : 1;
    this.initialAlpha = this.alpha;
    this.gravity = config.gravity || 0;
    this.friction = config.friction !== undefined ? config.friction : 1;
    this.shape = config.shape || 'circle';
    this.isFire = config.isFire === true;
    this.renderLayer = config.renderLayer || 'effects';
    this.blendMode = config.blendMode || 'source-over';
    this.sortY = Number.isFinite(config.sortY) ? config.sortY : this.position.y;
    this.active = true;
    // 记录初始位置，供 3D 渲染器做坐标映射
    this.initialPosition = { ...config.position };
  }
}
