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
 * ShadowRenderer.js - 参数化贴地椭圆阴影渲染器（框架级）
 *
 * 性能模型（Canvas 2D 下近乎零成本）：
 * - 软椭圆阴影只在首次绘制时预烘焙到一张小离屏 Canvas（径向渐变），
 *   之后每帧每实体只有一次 drawImage 拉伸，绝不逐帧创建渐变。
 * - 光照只驱动参数（锚定偏移 / 拉伸 / 明暗），不驱动像素：
 *   全局方向光（太阳）决定影子的方向、长度与浓度；
 *   点光源（营火等）对半径内实体按衰减加权混入影子方向；
 *   脚底始终锚定在椭圆近端（长轴焦点附近），椭圆从脚下向光反方向拖出。
 * - 跳跃（position.elevation）时影子留在地面并缩小变淡，高度感免费获得。
 * - 覆盖面：所有带可见 sprite 的实体（角色/NPC/敌人/道具/物品/尸体/采集点等）
 *   都有贴地影；尸体、道具等"曾经可以移动的物体"路过点光源同样产生长影
 *   （长影长度按各自 sprite 身高推导）。
 *
 * 光照配置（scene.lighting 或调用方传入）：
 * {
 *   directionX: -0.6,      // 光源水平来向（指向光源，任意长度，内部归一化）；负 x=光在左
 *   directionY: -0.8,      // 负 y=光在北（屏幕上方）→ 影子朝南偏
 *   elevation: 0.72,       // 仰角 0..1：1=正头顶（影子缩在脚下），0=地平线（影子最长）
 *   strength: 0.32,        // 阴影浓度（alpha 上限）
 *   pointLights: [         // 点光源（可省略；营火由管线自动注入）
 *     { x, y, radius: 220, strength: 0.85 }
 *   ]
 * }
 */

/** 角色（人形）实体类型：影子贴在脚下；其余类型（物品/采集点/尸体等）影子上移 1/3 影高。 */
const CHARACTER_ENTITY_TYPES = Object.freeze(['player', 'npc', 'enemy']);

/** 默认光照：光从左上方照射（影子朝右下偏），中高仰角。 */
const DEFAULT_LIGHTING = Object.freeze({
  directionX: -0.6,
  directionY: -0.8,
  elevation: 0.72,
  strength: 0.9
});

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export class ShadowRenderer {
  /**
   * @param {Object} [options]
   * @param {() => HTMLCanvasElement} [options.createCanvas] 离屏 Canvas 工厂（非浏览器宿主必须提供）
   */
  constructor(options = {}) {
    this._createCanvas = typeof options.createCanvas === 'function'
      ? options.createCanvas
      : (width, height) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
      };
    /** 预烘焙的软椭圆贴图（正圆径向渐变，绘制时压扁成任意比例椭圆）。 */
    this._blob = null;
  }

  /**
   * 解析光照配置：缺省字段回退默认值，方向向量归一化，点光源过滤非法项。
   * 返回独立对象（不持有调用方数组引用），可安全缓存于渲染管线。
   * @param {Object} [config] 场景光照配置
   * @returns {{directionX:number, directionY:number, elevation:number, strength:number, pointLights:Array}}
   */
  resolveLighting(config) {
    const dirX = Number.isFinite(config?.directionX) ? config.directionX : DEFAULT_LIGHTING.directionX;
    const dirY = Number.isFinite(config?.directionY) ? config.directionY : DEFAULT_LIGHTING.directionY;
    const length = Math.hypot(dirX, dirY);
    const inv = length > 1e-5 ? 1 / length : 0;
    const pointLights = [];
    if (Array.isArray(config?.pointLights)) {
      for (const light of config.pointLights) {
        const x = Number(light?.x);
        const y = Number(light?.y);
        const radius = Number(light?.radius);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !(radius > 0)) continue;
        pointLights.push({
          x, y, radius,
          strength: clamp(Number.isFinite(light?.strength) ? light.strength : 0.8, 0, 1.5)
        });
      }
    }
    return {
      directionX: dirX * inv,
      directionY: dirY * inv,
      elevation: clamp(Number.isFinite(config?.elevation) ? config.elevation : DEFAULT_LIGHTING.elevation, 0, 1),
      strength: clamp(Number.isFinite(config?.strength) ? config.strength : DEFAULT_LIGHTING.strength, 0, 1),
      pointLights
    };
  }

  /**
   * 计算一个物体的贴地阴影参数（脚底锚定椭圆近端焦点模型）。
   * 点光源影响强时返回双层影子：
   * - 本层（贴地椭圆）变淡（主光被点光夺走）；
   * - 附加 longShadow：沿背光方向按身高拉长的窄长影（长度 ∝ 身高 × 点光权重）。
   * @param {number} footX 脚底世界 X
   * @param {number} footY 脚底世界 Y（影子贴地点，跳跃时也保持不变）
   * @param {number} width 物体渲染宽度（px，决定影子大小）
   * @param {number} height 物体渲染身高（px，点光长影的长度基准）
   * @param {number} [elevation] 跳跃高度（px）：影子留在地面并缩小变淡
   * @param {Object} [lighting] 已解析的光照（缺省用内置默认）
   * @returns {{x:number, y:number, radiusX:number, radiusY:number, alpha:number,
   *            longShadow:{x:number, y:number, angle:number, length:number, height:number, alpha:number}|null}}
   */
  computeShadowParams(footX, footY, width, height, elevation = 0, lighting = null) {
    const light = lighting?.pointLights ? lighting : this.resolveLighting(lighting);
    // 仰角越低，影子水平偏移越长；正头顶（elevation=1）几乎无偏移
    const horizontal = 1 - light.elevation;
    // 影子方向 = 光源来向的反方向
    let dx = -light.directionX * horizontal;
    let dy = -light.directionY * horizontal;
    // 点光源：对半径内实体按线性衰减加权混入方向（实体背光而立），
    // 同时记录最大点光权重与该点光的纯方向（决定贴地影变淡幅度与长影朝向）。
    // 光源本体（火堆等与光心重合的实体）跳过：不混方向、不产生长影，只保留基础影。
    let pointWeight = 0;
    let bestLight = null;
    if (light.pointLights.length > 0) {
      for (let i = 0; i < light.pointLights.length; i++) {
        const pl = light.pointLights[i];
        const ddx = footX - pl.x;
        const ddy = footY - pl.y;
        const dist = Math.hypot(ddx, ddy);
        if (!Number.isFinite(dist) || dist >= pl.radius || dist < 2) continue;
        // 仅光心严格重合（dist<2px）视为光源本体（火堆实体自己）：无长影、不淡化。
        // 其他实体再近也保留点光效应——走近光源时长影应最长而非突然消失。
        const weight = (1 - dist / pl.radius) * pl.strength;
        dx += (ddx / dist) * weight;
        dy += (ddy / dist) * weight;
        if (weight > pointWeight) {
          pointWeight = weight;
          bestLight = { ddx, ddy, dist };
        }
      }
    }
    pointWeight = clamp(pointWeight, 0, 1);
    const magnitude = Math.hypot(dx, dy);
    const m = Math.min(1.5, magnitude);
    const inv = magnitude > 1e-4 ? 1 / magnitude : 0;
    const unitX = dx * inv;
    const unitY = dy * inv;
    // 拉伸：光越斜/点光越近影子越长（沿主导轴放大、另一轴收缩的轴对齐近似，免逐实体旋转）
    const baseRadiusX = Math.max(6, width * 0.42);
    const baseRadiusY = baseRadiusX * 0.5;
    const stretch = 1 + Math.min(1, m) * 0.8;
    const dominanceX = Math.abs(unitX) / (Math.abs(unitX) + Math.abs(unitY) + 1e-5);
    const radiusX = baseRadiusX * (1 + (stretch - 1) * dominanceX);
    const radiusY = baseRadiusY * (1 + (stretch - 1) * (1 - dominanceX));
    // 锚定：脚底固定在椭圆近端（长轴焦点附近），椭圆从脚下向光反方向拖出——
    // 而不是椭圆整体漂移到脚边之外（点光源近处尤其明显）。正顶光（m≈0）时中心即脚底。
    // 点光越强，贴地影越收回脚底正下方（接触阴影贴脚，方向感交给长影表达）。
    const anchor = Math.min(1, m) * radiusX * 0.55 * (1 - 0.7 * pointWeight);
    // 跳跃：影子留在地面并按高度缩小
    const air = elevation > 0 ? 1 / (1 + elevation * 0.012) : 1;
    // 点光越强，贴地影越淡（最多淡 65%）：淡化的基础影被长影近端包裹，两层融合
    const alpha = clamp(light.strength * air * (1 - 0.65 * pointWeight), 0.05, 1);
    // 背光长影：只在点光明显时出现。方向严格取最强点光的"光源→人物"连线方向
    // （不与全局光混合）；卵形贴图旋转绘制：近脚窄、远离光源和人时发散，
    // 长度按身高拉出（贴火时 ≈ 2.1~2.3 倍身高）。
    let longShadow = null;
    if (pointWeight > 0.05 && height > 0 && bestLight) {
      const lengthB = height * 3.4 * pointWeight * air;
      // 整体向点光源方向平移，但近端（朝光侧）不越过基础影中心 65% 半径：
      // 长影从基础影内部"长出来"，与基础影无缝衔接，不会在人物和基础影之间露出空隙。
      // 平移上限按基础影沿光-人连线方向的椭圆半径 × 0.65 计算。
      const backX = bestLight.ddx / bestLight.dist;
      const backY = bestLight.ddy / bestLight.dist;
      const dirRadius = 1 / Math.sqrt((backX / radiusX) ** 2 + (backY / radiusY) ** 2);
      const shift = Math.min(height * 0.5, dirRadius * 0.65);
      longShadow = {
        x: footX - backX * shift,
        y: footY - backY * shift,
        angle: Math.atan2(bestLight.ddy, bestLight.ddx),
        length: lengthB,
        height: lengthB * 1.2, // 卵形发散高与长度等比锁定（近端窄、远端宽）
        alpha: clamp(light.strength * 0.85 * pointWeight * air, 0.05, 1)
      };
    }
    return {
      x: footX + unitX * anchor,
      y: footY + unitY * anchor * 0.72,
      radiusX: radiusX * air,
      radiusY: radiusY * air,
      alpha,
      longShadow
    };
  }

  /** 获取（必要时烘焙）软椭圆贴图。 @private */
  _ensureBlob() {
    if (this._blob) return this._blob;
    const size = 128;
    const canvas = this._createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    // 平顶渐变：中心到 55% 半径保持 0.65，外圈衰减到 0。
    // 最终中心浓度 = 0.65 × strength(0.9) ≈ 58%，边缘柔和过渡防硬边。
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
    gradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.65)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    this._blob = canvas;
    return canvas;
  }

  /**
   * 获取（必要时烘焙）点光长影的卵形贴图：一头小（脚底端）一头大（远端）的
   * 椭圆形，沿长度方向渐隐。三层递宽卵形叠加形成软边（一次性烘焙成本，
   * 仅点光附近绘制）。绘制时等比拉伸不改形状比例。
   * @private
   */
  _ensureConeBlob() {
    if (this._cone) return this._cone;
    const width = 288;
    const height = 128;
    const canvas = this._createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const cy = height / 2;
    const x0 = 24;       // 左端（脚底）圆心位置（预留左端椭圆弧 rx0=20 的外凸余量）
    const x1 = width - 16; // 右端（远端）最宽处
    const span = x1 - x0;
    // 沿长度渐隐：脚底端浓、远端淡
    const gradient = ctx.createLinearGradient(x0, 0, x1 + 14, 0);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.9)');
    gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.42)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    // 三层递宽卵形：外层淡而宽（软边发散），内层浓而窄（影芯）。
    // 两端都是原生椭圆弧（真圆头，无 quadratic 折角）：左端小半椭圆、右端大半椭圆。
    // [左端半高, 右端半高, 层透明度]
    const layers = [
      [10, 34, 0.4],
      [7, 26, 0.5],
      [4, 17, 0.55]
    ];
    for (const [r0, r1, k] of layers) {
      ctx.globalAlpha = k;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      // 左端半椭圆（凸向左）：从顶点经左侧到脚底中点
      ctx.ellipse(x0, cy, 20, r0, 0, -Math.PI / 2, Math.PI / 2, true);
      // 下边：左端 → 右端的平滑外凸曲线
      ctx.bezierCurveTo(
        x0 + span * 0.34, cy + r0 * 1.04,
        x1 - span * 0.3, cy + r1 * 0.86,
        x1 - span * 0.08, cy + r1
      );
      // 右端半椭圆（凸向右）：从底经右侧到顶点
      ctx.ellipse(x1, cy, r1 * 0.45, r1, 0, Math.PI / 2, -Math.PI / 2, true);
      // 上边回程
      ctx.bezierCurveTo(
        x1 - span * 0.3, cy - r1 * 0.86,
        x0 + span * 0.34, cy - r0 * 1.04,
        x0, cy - r0
      );
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this._cone = canvas;
    return canvas;
  }

  /**
   * 绘制点光长影：以脚底为原点旋转到背光方向，卵形贴图从脚底向外发散拉伸
   * （一头小一头大的椭圆形）。一次 save/translate/rotate/drawImage/restore，
   * 仅点光附近实体触发。
   * @param {CanvasRenderingContext2D} ctx
   * @param {{x:number, y:number, angle:number, length:number, height:number, alpha:number}} ls
   */
  drawConeShadow(ctx, ls) {
    const cone = this._ensureConeBlob();
    if (!cone || !(ls.length > 0)) return;
    ctx.save();
    ctx.translate(ls.x, ls.y);
    ctx.rotate(ls.angle);
    ctx.globalAlpha = ls.alpha;
    ctx.drawImage(cone, 0, -ls.height / 2, ls.length, ls.height);
    ctx.restore();
  }

  /**
   * 按参数绘制一次阴影（一次 drawImage；调用方负责 globalAlpha 生命周期）。
   * @param {CanvasRenderingContext2D} ctx
   * @param {{x:number, y:number, radiusX:number, radiusY:number, alpha:number}} params
   */
  drawShadow(ctx, params) {
    const blob = this._ensureBlob();
    if (!blob || !(params.radiusX > 0) || !(params.radiusY > 0)) return;
    ctx.globalAlpha = params.alpha;
    ctx.drawImage(
      blob,
      params.x - params.radiusX,
      params.y - params.radiusY,
      params.radiusX * 2,
      params.radiusY * 2
    );
  }

  /**
   * 实体阴影批量 pass：所有实体影子在实体绘制前一批画完
   * （只切 globalAlpha、无 fillStyle/渐变创建，成本 ≈ 实体数 × 一次 drawImage）。
   * 覆盖所有带可见 sprite 的实体（角色/NPC/敌人/道具/物品/尸体/采集点等）；
   * 尸体、道具等路过点光源同样产生长影。仅灵魂状态（半透明鬼魂）不投影。
   * @param {CanvasRenderingContext2D} ctx 已应用相机变换的上下文
   * @param {Array} entities ECS 实体列表
   * @param {Object} [options]
   * @param {{left:number,top:number,right:number,bottom:number}} [options.viewBounds] 相机视野（世界坐标）
   * @param {Object} [options.lighting] 光照配置（scene.lighting 或管线组装）
   */
  renderEntityShadows(ctx, entities, options = {}) {
    if (!Array.isArray(entities) || entities.length === 0) return;
    const blob = this._ensureBlob();
    if (!blob) return;
    const light = this.resolveLighting(options.lighting);
    const viewBounds = options.viewBounds || null;
    const pad = 160; // 阴影可能外扩的余量
    ctx.save();
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      if (!entity || entity.active === false) continue;
      // 灵魂状态（半透明鬼魂）不投影；尸体正常投影（含点光长影）
      if (entity.isSoulState === true) continue;
      // 实体阴影配置（场景编辑器/内容定义的 shadow 块）：
      // ground=false → 整个实体无阴影（如烤肉架等发光/贴地物）
      const shadowProfile = entity.shadowProfile || null;
      if (shadowProfile?.ground === false) continue;
      const sprite = entity.getComponent?.('sprite');
      if (!sprite || sprite.visible === false) continue;
      const position = entity.getComponent?.('transform')?.position;
      if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
      if (viewBounds &&
        (position.x < viewBounds.left - pad || position.x > viewBounds.right + pad ||
         position.y < viewBounds.top - pad || position.y > viewBounds.bottom + pad)) {
        continue;
      }
      const scale = sprite.scale || 1;
      const width = (sprite.width || 32) * scale;
      const height = (sprite.height || 48) * scale;
      const params = this.computeShadowParams(
        position.x, position.y, width, height, position.elevation || 0, light
      );
      // 可调参数（shadowProfile.radius / scale / liftPx / shiftPx）：
      // radius=贴地影横半径（px，设置后覆盖按精灵尺寸的自动推导，纵半径按椭圆扁率跟随）；
      // scale=影子大小倍率（默认 1）；liftPx=上移量（像素）；shiftPx=水平平移（正数左移）
      const shadowScale = Number.isFinite(shadowProfile?.scale) && shadowProfile.scale > 0
        ? shadowProfile.scale
        : 1;
      const customRadius = Number.isFinite(shadowProfile?.radius) && shadowProfile.radius > 0
        ? shadowProfile.radius
        : null;
      if (customRadius != null) {
        // 指定半径：横半径直接替换，纵半径保持原椭圆扁率
        const ratio = params.radiusY / params.radiusX;
        params.radiusX = customRadius;
        params.radiusY = customRadius * ratio;
      }
      if (shadowScale !== 1) {
        params.radiusX *= shadowScale;
        params.radiusY *= shadowScale;
      }
      // 基础影水平位置微调（shadowProfile.shiftPx）：正数左移、负数右移。
      // 用于校正精灵锚点不在脚底正中导致的阴影中心偏移；只作用于贴地基础影，
      // 点光源长影的偏移由 longShiftPx / longLiftPx 单独控制。
      const shiftPx = Number.isFinite(shadowProfile?.shiftPx) ? shadowProfile.shiftPx : 0;
      if (shiftPx !== 0) params.x -= shiftPx;
      // 贴地影上移量统一用像素表达（shadowProfile.liftPx）：
      // 比例会随影高缩放，同数值在不同尺寸物体上位移不同，策划无法直观控制。
      // 显式 liftPx 对所有实体生效（可用于手动校准角色影子）；未配置时角色贴脚，
      // 物品/采集点默认上移 1/3 影高（旧数据的比例字段 lift 自动折算成像素）。
      const isCharacter = CHARACTER_ENTITY_TYPES.includes(entity.type);
      let liftPx = 0;
      if (Number.isFinite(shadowProfile?.liftPx)) {
        liftPx = Math.max(0, shadowProfile.liftPx);
      } else if (!isCharacter) {
        if (Number.isFinite(shadowProfile?.lift)) {
          liftPx = params.radiusY * 2 * clamp(shadowProfile.lift, 0, 1);
        } else {
          liftPx = params.radiusY * 2 / 3;
        }
      }
      if (liftPx > 0) params.y -= liftPx;
      // 长影在下、贴地影在上：长影为卵形旋转绘制（沿火-人连线发散），成本可忽略。
      // long=false → 该实体不产生点光长影（基础影保留）
      if (params.longShadow && shadowProfile?.long !== false) {
        // 点光源长影微调（shadowProfile.longLiftPx / longShiftPx）：
        // 长影随光源方位旋转，偏移按光源方位做对称处理——「上移」=朝光源的竖直一侧，
        // 「左移」=朝光源的水平一侧（光源在下方则下移、在右侧则右移）。
        const longLiftPx = Number.isFinite(shadowProfile?.longLiftPx) ? shadowProfile.longLiftPx : 0;
        const longShiftPx = Number.isFinite(shadowProfile?.longShiftPx) ? shadowProfile.longShiftPx : 0;
        if (longLiftPx !== 0 || longShiftPx !== 0) {
          // longShadow.angle 是「光源→人物」方向，取反得到「人物→光源」朝向
          const towardX = -Math.cos(params.longShadow.angle);
          const towardY = -Math.sin(params.longShadow.angle);
          params.longShadow.x += Math.sign(towardX) * longShiftPx;
          params.longShadow.y += Math.sign(towardY) * longLiftPx;
        }
        this.drawConeShadow(ctx, params.longShadow);
      }
      ctx.globalAlpha = params.alpha;
      ctx.drawImage(
        blob,
        params.x - params.radiusX,
        params.y - params.radiusY,
        params.radiusX * 2,
        params.radiusY * 2
      );
    }
    ctx.restore();
  }
}

export default ShadowRenderer;
