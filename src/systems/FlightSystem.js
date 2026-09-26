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

import { RNG } from '../core/RNG.js';

// 表现层随机：飞行烟雾粒子（非玩法结算，非权威）
const fxRng = new RNG();

/**
 * FlightSystem - 轻功飞行系统
 * 
 * 负责处理玩家的轻功飞行功能，包括：
 * - 飞行动画（蓄力、飞行、落地三阶段）
 * - 飞行特效（起飞和落地烟雾）
 * - 相机跟随
 * - 飞行距离限制
 */

export class FlightSystem {
  constructor(options = {}) {
    this.particleSystem = options.particleSystem || null;
    this.floatingTextManager = options.floatingTextManager || null;
    this.camera = options.camera || null;
    this.now = typeof options.now === 'function' ? options.now : () => performance.now();
    
    // 飞行状态
    this.isFlying = false;
    this.flyingData = null;
    
    // 冷却状态
    this._lastFlightTime = 0;   // 上次飞行完成时间（ms）
    this._cooldownMs = options.cooldown !== undefined ? options.cooldown : 5000; // 冷却时间（毫秒），默认5秒
    
    // 飞行参数配置
    this.config = {
      maxDistance: 400, // 最大飞行距离（像素）
      chargeDuration: 0.15, // 蓄力时长（秒）
      flyDuration: 0.45, // 飞行时长（秒）—— 一条完整抛物线
      landDuration: 0.1, // 落地缓冲时长（秒）
      peakHeight: 40, // 抛物线顶点高度（像素）
      peakPosition: 0.35, // 抛物线顶点在水平进度的位置（0~1），前倾=起跳快落地慢
      squatOffset: 5, // 蓄力下蹲偏移（像素）
      bounceOffset: 3, // 落地缓冲偏移（像素）
      smokeParticleCount: 12, // 烟雾粒子数量
      smokeRadius: 16, // 烟雾起始半径（半个玩家身位）
      smokeLife: 600, // 烟雾生命周期（毫秒）
      smokeSize: { min: 6, max: 10 }, // 烟雾粒子大小范围
      smokeColor: '#e0e0e0', // 烟雾颜色
      smokeAlpha: 0.5, // 烟雾透明度
      smokeFriction: 0.96, // 烟雾摩擦力
      takeoffGravity: -50, // 起飞烟雾重力（向上）
      landingGravity: 30 // 落地烟雾重力（向下）
    };
  }
  
  /**
   * 设置粒子系统
   */
  setParticleSystem(particleSystem) {
    this.particleSystem = particleSystem;
  }
  
  /**
   * 设置飘字管理器
   */
  setFloatingTextManager(floatingTextManager) {
    this.floatingTextManager = floatingTextManager;
  }
  
  /**
   * 设置相机
   */
  setCamera(camera) {
    this.camera = camera;
  }
  
  /**
   * 检查是否正在飞行
   */
  isPlayerFlying() {
    return this.isFlying;
  }
  
  /**
   * 开始飞行
   * @param {Object} playerEntity - 玩家 Entity（或传入 transform，兼容旧签名）
   * @param {number} targetX - 目标X坐标
   * @param {number} targetY - 目标Y坐标
   * @returns {boolean} 是否成功开始飞行
   */
  startFlight(playerEntityOrTransform, targetX, targetY, options = {}) {
    // 兼容：可能传入 transform
    let playerTransform = null;
    let playerEntity = null;
    if (playerEntityOrTransform?.getComponent) {
      playerEntity = playerEntityOrTransform;
      playerTransform = playerEntity.getComponent('transform');
    } else {
      playerTransform = playerEntityOrTransform;
    }

    if (!playerTransform) {
      console.error('FlightSystem: 玩家Transform组件不存在');
      return false;
    }
    
    if (this.isFlying) {
      console.warn('FlightSystem: 已经在飞行中，无法再次触发');
      return false;
    }
    
    // 冷却检查
    const now = this.now();
    if (now - this._lastFlightTime < this._cooldownMs) {
      return false;
    }
    
    const startX = playerTransform.position.x;
    const startY = playerTransform.position.y;
    
    // 计算距离
    const dx = targetX - startX;
    const dy = targetY - startY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // 限制飞行距离；单次能力参数只影响本次执行，不污染系统默认配置。
    const maxDistance = Math.max(0, Number(options.maxDistance) || this.config.maxDistance);
    let finalTargetX = targetX;
    let finalTargetY = targetY;
    
    if (distance > maxDistance) {
      const ratio = maxDistance / distance;
      finalTargetX = startX + dx * ratio;
      finalTargetY = startY + dy * ratio;
    }
    
    // 初始化飞行数据
    this.isFlying = true;
    this.flyingData = {
      startX: startX,
      startY: startY,
      targetX: finalTargetX,
      targetY: finalTargetY,
      progress: 0,
      phase: 'charge', // 阶段：charge(蓄力) -> fly(飞行) -> land(落地)
      chargeTime: 0,
      baseElevation: playerTransform.position.elevation ?? 0,
      playerEntity
    };
    
    // 设置相机为外部控制模式
    if (this.camera) {
      this.camera.externalControl = true;
    }

    // 临时切到 aerial 世界子层；保存租约，避免落地时释放其他系统的临时层。
    if (playerEntity) {
      const layer = playerEntity.getComponent?.('layer');
      if (layer) {
        if (typeof layer.acquireLayer === 'function') {
          this.flyingData._layerToken = layer.acquireLayer('aerial', 'flight');
          this.flyingData._layerPushed = !!this.flyingData._layerToken;
        } else {
          layer.pushLayer?.('aerial');
          this.flyingData._layerPushed = true;
        }
      }
    }
    
    // 创建起飞烟雾特效
    this.createTakeoffSmoke(startX, startY);
    
    console.log('FlightSystem: 开始轻功飞行', { 
      from: { x: startX, y: startY }, 
      to: { x: finalTargetX, y: finalTargetY },
      distance: Math.sqrt((finalTargetX - startX) ** 2 + (finalTargetY - startY) ** 2)
    });
    
    return true;
  }
  
  /**
   * 更新飞行状态
   * @param {number} deltaTime - 帧时间间隔（秒）
   * @param {Object} playerEntityOrTransform - 玩家实体或 Transform（兼容旧签名）
   */
  update(deltaTime, playerEntityOrTransform) {
    if (!this.isFlying || !this.flyingData) return;
    let playerTransform = null;
    let playerEntity = null;
    if (playerEntityOrTransform?.getComponent) {
      playerEntity = playerEntityOrTransform;
      playerTransform = playerEntity.getComponent('transform');
    } else {
      playerTransform = playerEntityOrTransform;
    }
    if (!playerTransform) return;
    
    const data = this.flyingData;
    
    if (data.phase === 'charge') {
      this.updateChargePhase(deltaTime, playerTransform);
    } else if (data.phase === 'fly') {
      this.updateFlyPhase(deltaTime, playerTransform);
    } else if (data.phase === 'land') {
      this.updateLandPhase(deltaTime, playerTransform, playerEntity);
    }
  }
  
  /**
   * 更新蓄力阶段（下蹲：elevation 略降）
   */
  updateChargePhase(deltaTime, playerTransform) {
    const data = this.flyingData;
    data.chargeTime += deltaTime;
    const chargeProgress = Math.min(1, data.chargeTime / this.config.chargeDuration);
    
    // 轻微下蹲：elevation 略降
    const squatOffset = Math.sin(chargeProgress * Math.PI) * this.config.squatOffset;
    playerTransform.position.elevation = (data.baseElevation ?? 0) - squatOffset;
    
    if (chargeProgress >= 1) {
      // 蓄力完成，进入飞行阶段
      data.phase = 'fly';
      data.progress = 0;
      playerTransform.position.elevation = data.baseElevation ?? 0;
    }
  }
  
  /**
   * 更新飞行阶段（非对称抛物线：起跳快、落地自然）
   */
  updateFlyPhase(deltaTime, playerTransform) {
    const data = this.flyingData;
    data.progress += deltaTime / this.config.flyDuration;
    
    if (data.progress >= 1) {
      // 飞行完成，进入落地缓冲
      data.phase = 'land';
      data.progress = 0;
      playerTransform.position.x = data.targetX;
      playerTransform.position.y = data.targetY;
      playerTransform.position.elevation = data.baseElevation ?? 0;
      
      // 创建落地烟雾特效
      this.createLandingSmoke(data.targetX, data.targetY);
      
      // 显示轻功飘字
      if (this.floatingTextManager) {
        this.floatingTextManager.addText(
          data.targetX, data.targetY - 40, '轻功', '#cccccc'
        );
      }
    } else {
      const t = data.progress;
      // 水平移动用 easeInOutQuad（起步加速，收尾减速）
      const hProgress = this.easeInOutQuad(t);
      
      // 非对称抛物线高度：顶点偏前(peakPosition)，起跳陡峭，下落平缓
      // 用分段二次曲线：升段 [0, peak] 和降段 [peak, 1]
      const peak = this.config.peakPosition;
      let heightRatio;
      if (t <= peak) {
        // 上升段：快速起跳
        const rt = t / peak; // 0→1
        heightRatio = rt * (2 - rt); // easeOut 效果，快速到顶
      } else {
        // 下降段：自然下落
        const rt = (t - peak) / (1 - peak); // 0→1
        heightRatio = 1 - rt * rt; // easeIn 效果，加速下落
      }
      
      playerTransform.position.x = data.startX + (data.targetX - data.startX) * hProgress;
      playerTransform.position.y = data.startY + (data.targetY - data.startY) * hProgress;
      playerTransform.position.elevation = (data.baseElevation ?? 0) + this.config.peakHeight * heightRatio;

      // 飞行过程中相机保持不动（externalControl 已跳过自动跟随，此处不再同步相机）
    }
  }
  
  /**
   * 更新落地阶段（轻微 bounce：elevation 微幅起伏）
   */
  updateLandPhase(deltaTime, playerTransform, playerEntity) {
    const data = this.flyingData;
    data.progress += deltaTime / this.config.landDuration;
    
    if (data.progress >= 1) {
      // 落地完成，结束飞行
      playerTransform.position.elevation = data.baseElevation ?? 0;
      const restoreEntity = playerEntity || data.playerEntity;
      if (data._layerPushed && restoreEntity) {
        this._releaseLayerLease(restoreEntity, data);
      }

      this.isFlying = false;
      this.flyingData = null;
      this._lastFlightTime = this.now(); // 记录冷却开始时间
      
      // 恢复相机自动跟随：落地后带缓冲地平滑移动到玩家新位置
      if (this.camera) {
        this.camera.externalControl = false;
        this.camera.beginSmoothFollow();
      }
      
      console.log('FlightSystem: 轻功完成');
    } else {
      // 落地缓冲效果（轻微下蹲再恢复）
      const bounceOffset = Math.sin(data.progress * Math.PI) * this.config.bounceOffset;
      playerTransform.position.elevation = (data.baseElevation ?? 0) - bounceOffset;

      // 落地缓冲阶段相机仍保持不动，待飞行结束再平滑追赶
    }
  }
  
  /**
   * 缓动函数：ease-in-out-quad
   */
  easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  /**
   * 缓动函数：ease-out-quad（减速）
   */
  easeOutQuad(t) {
    return 1 - (1 - t) * (1 - t);
  }

  /**
   * 缓动函数：ease-in-quad（加速）
   */
  easeInQuad(t) {
    return t * t;
  }
  
  /**
   * 创建起飞烟雾特效
   */
  createTakeoffSmoke(x, y) {
    if (!this.particleSystem) return;
    
    const { smokeParticleCount, smokeRadius, smokeLife, smokeSize, smokeColor, smokeAlpha, smokeFriction, takeoffGravity } = this.config;
    
    for (let i = 0; i < smokeParticleCount; i++) {
      // 只在下半圆生成粒子（从0度到180度）
      const angle = Math.PI * (i / smokeParticleCount);
      const offsetX = Math.cos(angle) * smokeRadius;
      const offsetY = Math.sin(angle) * smokeRadius;
      
      this.particleSystem.emit({
        position: { x: x + offsetX, y: y + offsetY },
        velocity: { 
          x: Math.cos(angle) * 50, // 向外扩散
          y: Math.sin(angle) * 25 - 30 // 向外下方，然后重力让它向上
        },
        life: smokeLife,
        size: smokeSize.min + fxRng.next() * (smokeSize.max - smokeSize.min),
        color: smokeColor,
        alpha: smokeAlpha,
        friction: smokeFriction,
        gravity: takeoffGravity
      });
    }
  }
  
  /**
   * 创建落地烟雾特效
   */
  createLandingSmoke(x, y) {
    if (!this.particleSystem) return;
    
    const { smokeParticleCount, smokeRadius, smokeLife, smokeSize, smokeColor, smokeAlpha, smokeFriction, landingGravity } = this.config;
    
    for (let i = 0; i < smokeParticleCount; i++) {
      // 只在下半圆生成粒子（从0度到180度）
      const angle = Math.PI * (i / smokeParticleCount);
      const offsetX = Math.cos(angle) * smokeRadius;
      const offsetY = Math.sin(angle) * smokeRadius;
      
      this.particleSystem.emit({
        position: { x: x + offsetX, y: y + offsetY },
        velocity: { 
          x: Math.cos(angle) * 50, // 向外扩散
          y: Math.sin(angle) * 25 + 10 // 向外下方
        },
        life: smokeLife,
        size: smokeSize.min + fxRng.next() * (smokeSize.max - smokeSize.min),
        color: smokeColor,
        alpha: smokeAlpha,
        friction: smokeFriction,
        gravity: landingGravity
      });
    }
  }
  
  _releaseLayerLease(entity, data) {
    const layer = entity?.getComponent?.('layer');
    if (data?._layerToken && typeof layer?.releaseLayer === 'function') {
      layer.releaseLayer(data._layerToken);
    } else {
      layer?.popLayer?.();
    }
    if (data) {
      data._layerPushed = false;
      data._layerToken = null;
    }
  }

  /**
   * 取消飞行（紧急恢复 elevation / layer）
   * @param {Object} [playerEntity]
   */
  cancelFlight(playerEntity) {
    if (this.flyingData) {
      const entity = playerEntity || this.flyingData.playerEntity;
      const transform = entity?.getComponent?.('transform');
      if (transform) transform.position.elevation = this.flyingData.baseElevation ?? 0;
      if (this.flyingData._layerPushed && entity) {
        this._releaseLayerLease(entity, this.flyingData);
      }
    }
    this.isFlying = false;
    this.flyingData = null;
    
    // 恢复相机自动跟随
    if (this.camera) {
      this.camera.externalControl = false;
    }
  }
  
  /**
   * 清理资源
   */
  cleanup() {
    this.cancelFlight();
    this.particleSystem = null;
    this.floatingTextManager = null;
    this.camera = null;
  }

  /**
   * 获取冷却剩余时间（毫秒）
   * @returns {number} 剩余冷却时间，0 表示已就绪
   */
  getCooldownRemaining() {
    if (this.isFlying) return this._cooldownMs; // 飞行中视为满冷却
    const elapsed = this.now() - this._lastFlightTime;
    return Math.max(0, this._cooldownMs - elapsed);
  }

  /**
   * 获取冷却总时间（毫秒）
   * @returns {number}
   */
  getCooldownTotal() {
    return this._cooldownMs;
  }

  /**
   * 是否正在冷却中
   * @returns {boolean}
   */
  isOnCooldown() {
    return this.getCooldownRemaining() > 0;
  }
}

export default FlightSystem;
