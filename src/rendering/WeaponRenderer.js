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
 * WeaponRenderer.js
 * 武器渲染器 - 负责渲染玩家的主手和副手武器，并处理攻击动画
 */

export class WeaponRenderer {
  constructor(options = {}) {
    this.now = typeof options.now === 'function' ? options.now : () => performance.now();
    // 武器配置
    this.weaponConfigs = {
      'wooden_sword': {
        length: 64,  // 2个玩家大小（玩家32x32）
        width: 8,
        color: '#8B4513',
        type: 'melee',
        attackRange: 1.5,  // 攻击范围倍率（武器长度的1.5倍，匹配视觉范围）
        throwRange: 10,  // 投掷范围倍率（武器长度的10倍）
        attackSpeed: 1.0 // 每秒攻击1次
      },
      'default': {
        length: 48,
        width: 6,
        color: '#888888',
        type: 'melee',
        attackRange: 3,  // 攻击范围倍率
        throwRange: 10,  // 投掷范围倍率
        attackSpeed: 1.0 // 每秒攻击1次
      }
    };
    
    // 武器冷却状态
    this.weaponCooldown = {
      lastAttackTime: 0,  // 上次攻击时间（秒）
      isReady: true       // 武器是否就绪
    };
    
    // 攻击动画状态
    this.attackAnimation = {
      active: false,
      type: 'thrust',  // 'thrust'(刺击) 或 'sweep'(扫击)
      progress: 0,   // 0-1
      duration: 0.3, // 秒
      direction: 0   // 攻击方向（弧度）
    };
    
    // 当前鼠标角度（用于武器跟随）
    this.currentMouseAngle = 0;
    this.lastMouseAngle = 0;
    
    // 鼠标移动检测
    this.mouseMovement = {
      movements: [], // 存储最近的移动记录
      timeWindow: 1.0,  // 时间窗口（秒）
      lastAttackTime: 0, // 上次攻击时间
      attackCooldown: 0.1, // 攻击冷却（秒）
      minDistanceChange: 5, // 最小距离变化（像素）才算移动
      movementsPerSecond: 0, // 当前每秒移动次数
      lastMovementType: null, // 上次移动类型 'thrust' 或 'sweep'
      thrustMovements: 0, // 刺击移动次数
      sweepMovements: 0, // 扫击移动次数
      lastMouseDistance: 0, // 上次鼠标到玩家的距离
      playerRadius: 20, // 玩家半径
      totalDistance: 0, // 总滑动距离（像素）
      totalTime: 0, // 总滑动时间（秒）
      averageSpeed: 0, // 平均速度（像素/秒）
      speedKmh: 0 // 速度（公里/小时）
    };
    
    // 武器投掷状态
    this.thrownWeapon = {
      active: false,        // 是否有武器被投掷
      weaponId: null,       // 武器ID
      targetEntity: null,   // 目标实体
      position: null,       // 武器位置
      angle: 0,             // 武器角度
      flying: false,        // 是否正在飞行
      flyProgress: 0,       // 飞行进度 0-1
      flyDuration: 0.3,     // 飞行时间（秒）
      startPos: null,       // 起始位置
      endPos: null,         // 结束位置
      throwTime: 0,         // 投掷时间（秒）
      autoRecoverTime: 10,  // 自动回收时间（秒）
      ownerEntity: null     // 武器所有者
    };
    
    // 投掷冷却
    this._throwCooldownMs = 8000; // 投掷冷却时间（毫秒），默认8秒
    this._lastThrowTime = 0;      // 上次投掷时间（ms）
    
    // 武器眩晕状态（被击退后无法格挡）
    this.stunned = {
      active: false,        // 是否眩晕
      endTime: 0            // 眩晕结束时间（毫秒）
    };
  }

  /**
   * 更新武器动画
   * @param {number} deltaTime - 帧间隔时间
   * @param {number} currentTime - 当前时间（秒）
   */
  update(deltaTime, currentTime) {
    // 更新眩晕状态
    if (this.stunned.active && this.now() >= this.stunned.endTime) {
      this.stunned.active = false;
      console.log('武器眩晕恢复，可以格挡了');
    }
    
    if (this.attackAnimation.active) {
      this.attackAnimation.progress += deltaTime / this.attackAnimation.duration;
      
      if (this.attackAnimation.progress >= 1) {
        this.attackAnimation.active = false;
        this.attackAnimation.progress = 0;
      }
    }
    
    // 更新投掷武器飞行动画
    if (this.thrownWeapon.flying) {
      this.thrownWeapon.flyProgress += deltaTime / this.thrownWeapon.flyDuration;
      
      if (this.thrownWeapon.flyProgress >= 1) {
        // 飞行结束，武器插在目标身上
        this.thrownWeapon.flying = false;
        this.thrownWeapon.flyProgress = 1;
        
        // 更新武器位置到目标位置
        if (this.thrownWeapon.targetEntity) {
          const targetTransform = this.thrownWeapon.targetEntity.getComponent('transform');
          if (targetTransform) {
            this.thrownWeapon.position = { ...targetTransform.position };
          }
        }
      } else {
        // 飞行中，插值计算位置
        const t = this.easeInOutQuad(this.thrownWeapon.flyProgress);
        this.thrownWeapon.position = {
          x: this.thrownWeapon.startPos.x + (this.thrownWeapon.endPos.x - this.thrownWeapon.startPos.x) * t,
          y: this.thrownWeapon.startPos.y + (this.thrownWeapon.endPos.y - this.thrownWeapon.startPos.y) * t
        };
      }
    } else if (this.thrownWeapon.active && this.thrownWeapon.targetEntity) {
      // 武器插在目标身上，跟随目标移动
      const targetTransform = this.thrownWeapon.targetEntity.getComponent('transform');
      if (targetTransform) {
        this.thrownWeapon.position = { ...targetTransform.position };
      }
    }
    
    // 检查自动回收
    if (this.thrownWeapon.active && !this.thrownWeapon.flying && currentTime) {
      const elapsedTime = currentTime - this.thrownWeapon.throwTime;
      if (elapsedTime >= this.thrownWeapon.autoRecoverTime) {
        // 自动回收武器
        this.autoRecoverWeapon();
      }
    }
  }
  
  /**
   * 自动回收武器
   */
  autoRecoverWeapon() {
    if (!this.thrownWeapon.active || !this.thrownWeapon.ownerEntity) {
      return;
    }
    
    console.log('WeaponRenderer: 武器自动回收');
    
    // 解除目标的钉住状态
    if (this.thrownWeapon.targetEntity) {
      this.thrownWeapon.targetEntity.pinnedByWeapon = false;
    }
    
    // 重置投掷状态
    this.thrownWeapon.active = false;
    this.thrownWeapon.weaponId = null;
    this.thrownWeapon.targetEntity = null;
    this.thrownWeapon.finalTarget = null;
    this.thrownWeapon.position = null;
    this.thrownWeapon.flying = false;
    this.thrownWeapon.flyProgress = 0;
    this.thrownWeapon.hitEnemies = [];
    this.thrownWeapon.throwTime = 0;
    this.thrownWeapon.ownerEntity = null;
  }

  /**
   * 更新鼠标角度和移动检测
   * @param {Object} mouseWorldPos - 鼠标世界坐标
   * @param {Object} playerPos - 玩家世界坐标
   * @param {number} currentTime - 当前时间（秒）
   */
  updateMouseAngle(mouseWorldPos, playerPos, currentTime) {
    if (!mouseWorldPos || !playerPos) return;
    
    const dx = mouseWorldPos.x - playerPos.x;
    const dy = mouseWorldPos.y - playerPos.y;
    const newAngle = Math.atan2(dy, dx);
    
    // 计算鼠标到玩家的距离
    const currentDistance = Math.sqrt(dx * dx + dy * dy);
    
    // 初始化上次距离
    if (this.mouseMovement.lastMouseDistance === 0) {
      this.mouseMovement.lastMouseDistance = currentDistance;
    }
    
    // 先清理超出时间窗口的旧记录（在添加新记录之前）
    this.mouseMovement.movements = this.mouseMovement.movements.filter(
      move => currentTime - move.time < this.mouseMovement.timeWindow
    );
    
    // 计算角度变化（用于判断左右移动）
    let angleDiff = newAngle - this.lastMouseAngle;
    
    // 处理角度跨越 -π 到 π 的情况
    if (angleDiff > Math.PI) {
      angleDiff -= 2 * Math.PI;
    } else if (angleDiff < -Math.PI) {
      angleDiff += 2 * Math.PI;
    }
    
    // 计算距离变化（用于判断上下移动）
    const distanceChange = currentDistance - this.mouseMovement.lastMouseDistance;
    
    // 判断是否有足够的移动
    const hasAngleChange = Math.abs(angleDiff) > 0.05; // 约3度
    const hasDistanceChange = Math.abs(distanceChange) > this.mouseMovement.minDistanceChange;
    
    if (hasAngleChange || hasDistanceChange) {
      // 判断移动类型：
      // 扫击：角度变化 > 距离变化（左右移动，围绕玩家）
      // 刺击：距离变化 > 角度变化（上下移动，靠近或远离玩家）
      
      let movementType;
      const angleChangeAbs = Math.abs(angleDiff);
      const distanceChangeAbs = Math.abs(distanceChange);
      
      // 比较角度变化和距离变化的相对大小
      // 角度变化更明显 = 扫击（围绕移动）
      // 距离变化更明显 = 刺击（径向移动）
      if (angleChangeAbs * currentDistance > distanceChangeAbs * 2) {
        movementType = 'sweep'; // 扫击：左右移动（围绕玩家）
      } else {
        movementType = 'thrust'; // 刺击：上下移动（靠近或远离玩家）
      }
      
      // 计算实际移动距离（像素）
      // 对于扫击：弧长 = 角度变化 × 距离
      // 对于刺击：直线距离 = 距离变化
      let actualDistance = 0;
      if (movementType === 'sweep') {
        actualDistance = angleChangeAbs * currentDistance;
      } else {
        actualDistance = distanceChangeAbs;
      }
      
      // 添加新的移动记录
      this.mouseMovement.movements.push({
        time: currentTime,
        angleChange: angleDiff,
        distanceChange: distanceChange,
        type: movementType,
        distance: actualDistance
      });
      
      // 记录最后的移动类型
      this.mouseMovement.lastMovementType = movementType;
      
      // 更新上次距离
      this.mouseMovement.lastMouseDistance = currentDistance;
    }
    
    // 统计最近1秒内的移动次数（只统计时间窗口内的记录）
    this.mouseMovement.movementsPerSecond = this.mouseMovement.movements.length;
    this.mouseMovement.thrustMovements = this.mouseMovement.movements.filter(m => m.type === 'thrust').length;
    this.mouseMovement.sweepMovements = this.mouseMovement.movements.filter(m => m.type === 'sweep').length;
    
    // 计算总滑动距离和平均速度
    this.mouseMovement.totalDistance = this.mouseMovement.movements.reduce((sum, m) => sum + (m.distance || 0), 0);
    this.mouseMovement.totalTime = this.mouseMovement.timeWindow;
    this.mouseMovement.averageSpeed = this.mouseMovement.totalDistance / this.mouseMovement.totalTime;
    
    // 转换为公里/小时（1像素 ≈ 1厘米，假设游戏世界比例）
    // 像素/秒 → 厘米/秒 → 米/秒 → 公里/小时
    // 速度(km/h) = 速度(像素/秒) × 0.01(米/像素) × 3.6(km/h / m/s)
    this.mouseMovement.speedKmh = this.mouseMovement.averageSpeed * 0.036;
    
    this.lastMouseAngle = this.currentMouseAngle;
    this.currentMouseAngle = newAngle;
  }

  /**
   * 标准化角度到 -π 到 π
   * @param {number} angle - 角度
   * @returns {number}
   */
  normalizeAngle(angle) {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  }

  /**
   * 获取攻击伤害倍率（基于鼠标移动速度）
   * 如果武器冷却中，返回固定的低伤害值（0-5）
   * @param {boolean} isWeaponReady - 武器是否就绪（冷却完成）
   * @returns {number} 伤害倍率或固定伤害值
   */
  getSwipeDamageMultiplier(isWeaponReady = true) {
    // 如果武器在冷却中，返回随机0-5的固定伤害（不是倍率）
    if (!isWeaponReady) {
      return Math.random() * 5; // 0-5的随机数
    }
    
    const speedKmh = this.mouseMovement.speedKmh;
    
    // 如果没有移动，返回最低倍率
    if (speedKmh <= 0) {
      return 0.5;
    }
    
    // 基于速度的线性计算伤害倍率
    // 100 km/h → 110% (1.1倍)
    // 1000 km/h → 300% (3.0倍)
    // 
    // 线性公式：y = kx + b
    // 已知两点：(100, 1.1) 和 (1000, 3.0)
    // 斜率 k = (3.0 - 1.1) / (1000 - 100) = 1.9 / 900 ≈ 0.00211
    // 截距 b = 1.1 - 0.00211 × 100 = 1.1 - 0.211 = 0.889
    // 
    // 公式：multiplier = 0.00211 × speedKmh + 0.889
    
    const multiplier = 0.00211 * speedKmh + 0.889;
    
    // 限制范围：最低50%，最高300%
    return Math.max(0.5, Math.min(3.0, multiplier));
  }

  /**
   * 检查武器是否就绪（冷却完成）
   * @param {number} currentTime - 当前时间（秒）
   * @param {Entity} entity - 实体（用于获取武器配置）
   * @returns {boolean}
   */
  isWeaponReady(currentTime, entity) {
    // 获取武器配置
    const equipment = entity?.getComponent('equipment');
    const mainhandWeapon = equipment?.slots?.mainhand;
    const config = mainhandWeapon 
      ? (this.weaponConfigs[mainhandWeapon.id] || this.weaponConfigs.default)
      : this.weaponConfigs.default;
    
    // 计算冷却时间（攻击速度的倒数）
    const cooldownTime = 1.0 / config.attackSpeed;
    
    // 检查是否冷却完成
    const timeSinceLastAttack = currentTime - this.weaponCooldown.lastAttackTime;
    this.weaponCooldown.isReady = timeSinceLastAttack >= cooldownTime;
    
    return this.weaponCooldown.isReady;
  }

  /**
   * 检查是否可以进行自动攻击
   * @param {number} currentTime - 当前时间（秒）
   * @param {Entity} entity - 实体（用于获取武器配置）
   * @returns {boolean}
   */
  canAutoAttack(currentTime, entity) {
    // 更新武器冷却状态
    this.isWeaponReady(currentTime, entity);
    
    // 检查最小攻击间隔（防止攻击过于频繁）
    const timeSinceLastAttack = currentTime - this.mouseMovement.lastAttackTime;
    if (timeSinceLastAttack < this.mouseMovement.attackCooldown) {
      return false;
    }
    
    // 必须有鼠标移动记录
    if (this.mouseMovement.movements.length === 0) {
      return false;
    }
    
    // 必须有总移动距离
    if (this.mouseMovement.totalDistance <= 0) {
      return false;
    }
    
    // 如果最后的移动类型是刺击，需要至少2次移动才能触发
    if (this.mouseMovement.lastMovementType === 'thrust') {
      if (this.mouseMovement.thrustMovements < 2) {
        return false;
      }
    }
    
    // 如果最后的移动类型是扫击，需要至少1次移动
    if (this.mouseMovement.lastMovementType === 'sweep') {
      if (this.mouseMovement.sweepMovements < 1) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * 记录攻击并触发动画
   * @param {number} currentTime - 当前时间（秒）
   */
  recordAttack(currentTime) {
    // 更新最后攻击时间（用于最小攻击间隔检查）
    this.mouseMovement.lastAttackTime = currentTime;
    
    // 只有在武器就绪时才重置武器冷却时间
    if (this.weaponCooldown.isReady) {
      this.weaponCooldown.lastAttackTime = currentTime;
      this.weaponCooldown.isReady = false;
    }
    
    // 玩家武器不需要攻击动画，只记录攻击类型
    // 如果没有移动类型，不触发攻击
    if (!this.mouseMovement.lastMovementType) {
      return;
    }
    
    // 不触发动画，只清空移动记录
    // this.startAttack() 已被注释掉
    
    // 攻击后清空移动记录，避免重复触发
    this.mouseMovement.movements = [];
    this.mouseMovement.thrustMovements = 0;
    this.mouseMovement.sweepMovements = 0;
    this.mouseMovement.totalDistance = 0;
    this.mouseMovement.movementsPerSecond = 0;
  }

  /**
   * 开始攻击动画
   * @param {string} type - 攻击类型 'thrust' 或 'sweep'
   */
  startAttack(type = 'thrust') {
    if (this.attackAnimation.active) return;
    
    this.attackAnimation.active = true;
    this.attackAnimation.progress = 0;
    this.attackAnimation.type = type;
    this.attackAnimation.direction = this.currentMouseAngle;
  }

  /**
   * 获取当前攻击类型名称
   * @returns {string}
   */
  getAttackTypeName() {
    if (this.mouseMovement.lastMovementType === 'thrust') {
      return '刺击';
    } else {
      return '扫击';
    }
  }

  /**
   * 渲染武器
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Entity} entity - 实体
   * @param {Object} camera - 相机
   */
  render(ctx, entity, camera) {
    // 如果武器被投掷出去，渲染投掷的武器
    if (this.thrownWeapon.active) {
      this.renderThrownWeapon(ctx, camera);
      return; // 不渲染手持武器
    }
    
    const transform = entity.getComponent('transform');
    const equipment = entity.getComponent('equipment');
    const sprite = entity.getComponent('sprite');
    
    if (!transform || !equipment) return;
    
    // 武器根部在人物中心（身体中间位置）
    // transform.position 是脚底，中心在上方 height/2 处
    const spriteHeight = sprite?.height || 64;
    const worldX = Math.round(transform.position.x);
    const worldY = Math.round(transform.position.y - spriteHeight / 2);
    
    // 记录精灵高度供renderWeapon使用
    this.playerSpriteHeight = spriteHeight;
    
    // 渲染主手武器
    const mainhandWeapon = equipment.slots.mainhand;
    if (mainhandWeapon) {
      this.renderWeapon(ctx, mainhandWeapon, worldX, worldY, 'mainhand');
    }
    
    // 渲染副手武器
    const offhandWeapon = equipment.slots.offhand;
    if (offhandWeapon) {
      this.renderWeapon(ctx, offhandWeapon, worldX, worldY, 'offhand');
    }
  }
  
  /**
   * 渲染投掷的武器
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Object} camera - 相机
   */
  renderThrownWeapon(ctx, camera) {
    if (!this.thrownWeapon.position) return;
    
    const config = this.weaponConfigs[this.thrownWeapon.weaponId] || this.weaponConfigs.default;
    
    // 直接使用世界坐标（因为ctx已经应用了相机变换）
    const worldX = Math.round(this.thrownWeapon.position.x);
    const worldY = Math.round(this.thrownWeapon.position.y);
    
    ctx.save();
    ctx.translate(worldX, worldY);
    ctx.rotate(this.thrownWeapon.angle);
    
    // 绘制武器（插在目标身上，所以从中心点开始）
    this.drawWeapon(ctx, config);
    
    ctx.restore();
    
    // 如果武器已经停止飞行，显示拾取提示
    if (!this.thrownWeapon.flying) {
      ctx.save();
      ctx.fillStyle = '#ffff00';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('按E拾取', worldX, worldY - 30);
      
      // 绘制拾取范围圆圈
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(worldX, worldY, 50, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * 渲染单个武器
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Object} weapon - 武器数据
   * @param {number} x - 玩家屏幕X坐标
   * @param {number} y - 玩家屏幕Y坐标
   * @param {string} hand - 'mainhand' 或 'offhand'
   */
  renderWeapon(ctx, weapon, x, y, hand) {
    const config = this.weaponConfigs[weapon.id] || this.weaponConfigs.default;
    
    ctx.save();
    
    // 人物中心为圆心，半径为人物高度一半，武器根部在圆周上
    const radius = this.playerSpriteHeight ? this.playerSpriteHeight / 2 : 32;
    const offsetX = Math.cos(this.currentMouseAngle) * radius;
    const offsetY = Math.sin(this.currentMouseAngle) * radius;
    
    // 移动到圆周上的点（武器根部）
    ctx.translate(x + offsetX, y + offsetY);
    
    // 武器朝向鼠标方向
    ctx.rotate(this.currentMouseAngle);
    
    // 绘制武器
    this.drawWeapon(ctx, config);
    
    ctx.restore();
  }
  
  /**
   * 计算武器伸出距离（基于鼠标距离）
   * @param {Object} config - 武器配置
   * @returns {number} 伸出距离
   */
  calculateWeaponExtension(config) {
    // 获取鼠标到玩家的距离
    const mouseDistance = this.mouseMovement.lastMouseDistance;
    
    // 如果距离为0，返回0（武器在玩家边缘）
    if (mouseDistance === 0) return 0;
    
    // 定义距离范围
    const minDistance = this.mouseMovement.playerRadius; // 玩家半径（20像素）
    // 使用武器的攻击范围倍率
    const maxDistance = this.mouseMovement.playerRadius + config.length * config.attackRange;
    
    // 如果鼠标在玩家内部或边缘，武器不伸出
    if (mouseDistance <= minDistance) {
      return 0;
    }
    
    // 如果鼠标超出最大距离，武器伸出到最大距离
    if (mouseDistance >= maxDistance) {
      return config.length * config.attackRange; // 最多伸出到攻击范围倍率
    }
    
    // 在范围内，线性插值计算伸出距离
    // 鼠标距离从 minDistance 到 maxDistance，武器从 0 伸出到攻击范围倍率
    const ratio = (mouseDistance - minDistance) / (maxDistance - minDistance);
    return ratio * config.length * config.attackRange;
  }

  /**
   * 应用攻击动画变换
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Object} config - 武器配置
   */
  applyAttackAnimation(ctx, config) {
    const progress = this.attackAnimation.progress;
    const type = this.attackAnimation.type;
    
    // 使用缓动函数使动画更流畅
    const easeProgress = this.easeInOutQuad(progress);
    
    // 基准角度是攻击开始时的鼠标方向
    const baseAngle = this.attackAnimation.direction;
    
    if (type === 'thrust') {
      // 刺击：沿鼠标方向向远离玩家的方向移动1.5-2个武器长度
      ctx.rotate(baseAngle);
      // 使用1.75倍武器长度（1.5-2之间的中间值）
      const thrustDistance = config.length * 1.75;
      const distance = easeProgress * thrustDistance;
      ctx.translate(distance, 0);
    } else if (type === 'sweep') {
      // 扫击：左右挥动
      const swingAngle = Math.sin(easeProgress * Math.PI) * (Math.PI / 3); // 60度挥动
      ctx.rotate(baseAngle + swingAngle);
    }
  }

  /**
   * 绘制武器
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Object} config - 武器配置
   */
  drawWeapon(ctx, config) {
    // 绘制武器主体（矩形）
    ctx.fillStyle = config.color;
    ctx.fillRect(0, -config.width / 2, config.length, config.width);
    
    // 绘制武器边框
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, -config.width / 2, config.length, config.width);
    
    // 绘制握柄（深色部分）
    ctx.fillStyle = '#654321';
    ctx.fillRect(0, -config.width / 2, config.length * 0.2, config.width);
  }

  /**
   * 缓动函数 - 先加速后减速
   * @param {number} t - 进度 (0-1)
   * @returns {number}
   */
  easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  /**
   * 获取攻击范围
   * @param {Entity} entity - 实体
   * @returns {number} 攻击范围
   */
  getAttackRange(entity) {
    const equipment = entity.getComponent('equipment');
    if (!equipment) return 150; // 默认攻击范围
    
    const mainhandWeapon = equipment.slots.mainhand;
    if (!mainhandWeapon) return 150;
    
    const config = this.weaponConfigs[mainhandWeapon.id] || this.weaponConfigs.default;
    // 攻击范围 = 武器长度 × 攻击范围倍率
    return config.length * config.attackRange;
  }
  
  /**
   * 获取投掷范围
   * @param {Entity} entity - 实体
   * @returns {number} 投掷范围
   */
  getThrowRange(entity) {
    const equipment = entity.getComponent('equipment');
    if (!equipment) return 480; // 默认投掷范围
    
    const mainhandWeapon = equipment.slots.mainhand;
    if (!mainhandWeapon) return 480;
    
    const config = this.weaponConfigs[mainhandWeapon.id] || this.weaponConfigs.default;
    // 投掷范围 = 武器长度 × 投掷范围倍率
    return config.length * config.throwRange;
  }

  /**
   * 获取攻击范围内的所有敌人
   * @param {Object} attackerPos - 攻击者位置
   * @param {Array<Entity>} entities - 所有实体
   * @param {number} range - 攻击范围
   * @returns {Array<Entity>} 范围内的敌人列表
   */
  getEnemiesInRange(attackerPos, entities, range) {
    const enemies = [];
    
    // 基准角度是鼠标方向
    const baseAngle = this.currentMouseAngle;
    
    // 根据移动类型确定攻击扇形角度
    // 使用 lastMovementType 而不是 attackAnimation.type
    let attackArc = Math.PI; // 默认180度扇形（更宽容）
    
    if (this.mouseMovement.lastMovementType === 'thrust') {
      attackArc = Math.PI / 2; // 刺击：90度扇形
    } else if (this.mouseMovement.lastMovementType === 'sweep') {
      attackArc = Math.PI * 1.2; // 扫击：216度扇形（更宽）
    }
    
    for (const entity of entities) {
      // 只攻击敌人
      if (entity.type !== 'enemy') continue;
      // 同阵营友军单位（faction=friendly/ally，如黄巾粮仓哨兵）不是攻击目标，
      // 避免玩家普攻/技能误伤友军。
      if (entity.faction === 'friendly' || entity.faction === 'ally') continue;
      if (entity.isDead || entity.isDying) continue;
      
      const targetTransform = entity.getComponent('transform');
      const targetStats = entity.getComponent('stats');
      if (!targetTransform || !targetStats || targetStats.hp <= 0) continue;
      
      // 计算距离
      const dx = targetTransform.position.x - attackerPos.x;
      const dy = targetTransform.position.y - attackerPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // 检查是否在攻击范围内
      if (distance > range) continue;
      
      // 计算目标方向角度
      const targetAngle = Math.atan2(dy, dx);
      
      // 计算角度差
      let angleDiff = Math.abs(targetAngle - baseAngle);
      if (angleDiff > Math.PI) {
        angleDiff = 2 * Math.PI - angleDiff;
      }
      
      // 检查是否在攻击扇形范围内
      if (angleDiff <= attackArc / 2) {
        enemies.push(entity);
      }
    }
    
    return enemies;
  }

  /**
   * 检查是否正在攻击
   * @returns {boolean}
   */
  isAttacking() {
    return this.attackAnimation.active;
  }

  /**
   * 获取当前攻击类型
   * @returns {string}
   */
  getCurrentAttackType() {
    return this.attackAnimation.type;
  }
  
  /**
   * 投掷武器
   * @param {Entity} playerEntity - 玩家实体
   * @param {Entity} targetEntity - 目标实体（可选，如果没有则投掷到鼠标位置）
   * @param {Object} playerPos - 玩家位置
   * @param {Object} targetPos - 目标位置
   * @param {number} currentTime - 当前时间（秒）
   * @returns {boolean} 是否成功投掷
   */
  throwWeapon(playerEntity, targetEntity, playerPos, targetPos, currentTime) {
    // 检查是否已经投掷了武器
    if (this.thrownWeapon.active) {
      return false;
    }
    
    // 冷却检查
    const nowMs = this.now();
    if (nowMs - this._lastThrowTime < this._throwCooldownMs) {
      return false;
    }
    
    // 检查是否有主手武器
    const equipment = playerEntity.getComponent('equipment');
    if (!equipment || !equipment.slots.mainhand) {
      return false;
    }
    
    const weapon = equipment.slots.mainhand;
    const config = this.weaponConfigs[weapon.id] || this.weaponConfigs.default;
    
    // 获取投掷范围（武器长度 × 投掷范围倍率）
    const maxThrowDistance = config.length * config.throwRange;
    
    // 检查距离
    const dx = targetPos.x - playerPos.x;
    const dy = targetPos.y - playerPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // 如果超出最大距离，限制到最大距离
    let finalTargetPos = targetPos;
    if (distance > maxThrowDistance) {
      const ratio = maxThrowDistance / distance;
      finalTargetPos = {
        x: playerPos.x + dx * ratio,
        y: playerPos.y + dy * ratio
      };
    }
    
    // 计算投掷角度
    const finalDx = finalTargetPos.x - playerPos.x;
    const finalDy = finalTargetPos.y - playerPos.y;
    const angle = Math.atan2(finalDy, finalDx);
    
    // 设置投掷状态
    this.thrownWeapon.active = true;
    this.thrownWeapon.weaponId = weapon.id;
    this.thrownWeapon.targetEntity = targetEntity; // 可能为null
    this.thrownWeapon.angle = angle;
    this.thrownWeapon.flying = true;
    this.thrownWeapon.flyProgress = 0;
    this.thrownWeapon.startPos = { ...playerPos };
    this.thrownWeapon.endPos = { ...finalTargetPos };
    this.thrownWeapon.position = { ...playerPos };
    this.thrownWeapon.hitEnemies = []; // 记录已命中的敌人
    this.thrownWeapon.throwTime = currentTime || 0; // 记录投掷时间
    this.thrownWeapon.ownerEntity = playerEntity; // 记录所有者
    this._lastThrowTime = this.now(); // 记录冷却开始时间
    
    // 如果有目标实体，标记为最终目标
    if (targetEntity) {
      this.thrownWeapon.finalTarget = targetEntity;
    }
    
    return true;
  }
  
  /**
   * 收回武器（改为拾取武器）
   * @param {Entity} playerEntity - 玩家实体
   * @returns {boolean} 是否成功拾取
   */
  retrieveWeapon(playerEntity) {
    if (!this.thrownWeapon.active) {
      return false;
    }
    
    // 检查玩家是否在武器附近
    const playerTransform = playerEntity.getComponent('transform');
    if (!playerTransform || !this.thrownWeapon.position) {
      return false;
    }
    
    const dx = this.thrownWeapon.position.x - playerTransform.position.x;
    const dy = this.thrownWeapon.position.y - playerTransform.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // 拾取范围：50像素
    if (distance > 50) {
      return false;
    }
    
    // 检查是否是武器所有者
    const isOwner = (this.thrownWeapon.ownerEntity === playerEntity);
    
    if (!isOwner) {
      // 其他玩家拾取，需要丢掉自己的武器
      const equipment = playerEntity.getComponent('equipment');
      if (equipment && equipment.slots.mainhand) {
        // TODO: 在这里可以创建一个掉落的武器实体
        console.log('WeaponRenderer: 其他玩家拾取武器，丢掉自己的武器');
      }
      
      // 装备拾取的武器
      if (equipment) {
        const weaponData = {
          id: this.thrownWeapon.weaponId,
          name: '木棍', // 这里应该从配置中获取
          type: 'equipment',
          subType: 'mainhand',
          attackSpeed: 1.5
        };
        equipment.slots.mainhand = weaponData;
      }
    }
    
    // 解除目标的钉住状态
    if (this.thrownWeapon.targetEntity) {
      this.thrownWeapon.targetEntity.pinnedByWeapon = false;
    }
    
    // 重置投掷状态
    this.thrownWeapon.active = false;
    this.thrownWeapon.weaponId = null;
    this.thrownWeapon.targetEntity = null;
    this.thrownWeapon.finalTarget = null;
    this.thrownWeapon.position = null;
    this.thrownWeapon.flying = false;
    this.thrownWeapon.flyProgress = 0;
    this.thrownWeapon.hitEnemies = [];
    this.thrownWeapon.throwTime = 0;
    this.thrownWeapon.ownerEntity = null;
    
    return true;
  }
  
  /**
   * 检查武器是否被投掷
   * @returns {boolean}
   */
  isWeaponThrown() {
    return this.thrownWeapon.active;
  }
  
  /**
   * 获取投掷冷却剩余时间（毫秒）
   * @returns {number} 剩余冷却时间，0 表示已就绪
   */
  getThrowCooldownRemaining() {
    const elapsed = this.now() - this._lastThrowTime;
    return Math.max(0, this._throwCooldownMs - elapsed);
  }

  /**
   * 获取投掷冷却总时间（毫秒）
   * @returns {number}
   */
  getThrowCooldownTotal() {
    return this._throwCooldownMs;
  }

  /**
   * 获取投掷的武器信息
   * @returns {Object|null}
   */
  getThrownWeapon() {
    return this.thrownWeapon.active ? this.thrownWeapon : null;
  }
  
  /**
   * 检查投掷路径上的敌人碰撞
   * @param {Array<Entity>} entities - 所有实体
   * @param {Function} onHit - 命中回调 (enemy, isFinalTarget) => void
   */
  checkThrowPathCollision(entities, onHit) {
    if (!this.thrownWeapon.flying || !this.thrownWeapon.position) {
      return;
    }
    
    const config = this.weaponConfigs[this.thrownWeapon.weaponId] || this.weaponConfigs.default;
    const hitRadius = config.length / 2; // 武器半径作为碰撞范围
    
    // 检查所有敌人
    for (const entity of entities) {
      if (entity.type !== 'enemy') continue;
      if (entity.isDead || entity.isDying) continue;
      
      // 检查是否已经命中过这个敌人
      if (this.thrownWeapon.hitEnemies.includes(entity.id)) {
        continue;
      }
      
      const transform = entity.getComponent('transform');
      if (!transform) continue;
      
      // 计算距离
      const dx = transform.position.x - this.thrownWeapon.position.x;
      const dy = transform.position.y - this.thrownWeapon.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // 检查碰撞
      if (distance <= hitRadius + 20) { // 20是敌人半径
        // 记录已命中
        this.thrownWeapon.hitEnemies.push(entity.id);
        
        // 检查是否是最终目标
        const isFinalTarget = (this.thrownWeapon.finalTarget === entity);
        
        // 触发命中回调
        if (onHit) {
          onHit(entity, isFinalTarget);
        }
        
        // 如果是最终目标，钉住敌人
        if (isFinalTarget) {
          entity.pinnedByWeapon = true;
          this.thrownWeapon.targetEntity = entity;
        }
      }
    }
  }
}
