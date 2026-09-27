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

import { setTimeoutFn } from '../core/Timers.js';

/**
 * MeleeAttackSystem - 近战/远程扇形攻击系统
 * 
 * 从 BaseGameScene 提取的扇形攻击逻辑，包括：
 * - 扇形攻击检测与执行
 * - 刀光/箭光特效管理
 * - 战斗警示圆圈渲染
 * - 刀光轨迹渲染
 * - 远程箭矢消耗与穿刺机制
 */
export class MeleeAttackSystem {
  /**
   * @param {Object} config - 配置参数
   * @param {number} [config.sliceAttackRange=100] - 近战攻击距离
   * @param {number} [config.sliceHitRadius=40] - 命中半径
   * @param {number} [config.sliceGlobalCooldown=3.0] - 全局武器冷却（秒）
   * @param {number} [config.sectorAngle=Math.PI/3] - 扇形张角（弧度）
   * @param {number} [config.sliceTrailMaxAge=0.3] - 刀光轨迹最大存活时间
   */
  constructor(config = {}) {
    // 刀光轨迹
    this.sliceTrail = [];
    this.sliceTrailMaxAge = config.sliceTrailMaxAge ?? 0.3;
    this.isSlicing = false;
    this.slicedEnemies = new Set();
    
    // 攻击参数
    this.sliceAttackRange = config.sliceAttackRange ?? 100;
    this.sliceHitRadius = config.sliceHitRadius ?? 40;
    this.sliceCooldowns = new Map();
    this.sliceCooldownTime = config.sliceCooldownTime ?? 0.5;
    this.sliceMouseSpeed = 0;
    this.sliceGlobalCooldown = config.sliceGlobalCooldown ?? 3.0;
    this.sliceLastAttackTime = 0;
    this.sliceCooldownShown = false;
    
    // 扇形参数
    this.sectorAngle = config.sectorAngle ?? (Math.PI / 3);
    this.sectorDirection = 0;
    this.sectorDirectionLocked = false; // 外部锁定方向时不被 mouseWorldPos 覆盖
    this.sectorIsRanged = false;
    this.sectorRangedOffset = config.sectorRangedOffset ?? 256;
    this.sectorRangedRadius = config.sectorRangedRadius ?? 120;
    this.sectorAttackFlash = 0;
    this.sectorSlashEffects = [];
    
    // 移动端禁止通过鼠标按钮自动触发攻击（攻击由按钮瞄准释放处理）
    this.disableAutoAttack = config.disableAutoAttack ?? false;
    
    // 移动端近战扇形指示器默认隐藏，仅瞄准时显示
    this.hideSectorWhenIdle = config.hideSectorWhenIdle ?? false;
    
    // 依赖（通过 init 注入）
    this.inputManager = null;
    this.combatSystem = null;
    this.floatingTextManager = null;
    this.playerEntity = null;
    this.entities = [];
    this.canAttack = null;
    this.onAttackPerformed = null;
  }

  /**
   * 战斗结算随机：复用 CombatSystem 注入的 combatRng，
   * 保证近战/远程伤害浮动与战斗结算同序列（联网/回放确定性）。
   * combatSystem 未就绪时退化为 Math.random。
   */
  _rng() {
    return this.combatSystem?._rng?.() ?? Math.random();
  }

  /**
   * 初始化依赖
   * @param {Object} deps
   * @param {Object} deps.inputManager - 输入管理器
   * @param {Object} deps.combatSystem - 战斗系统
   * @param {Object} [deps.floatingTextManager] - 飘动文字管理器
   * @param {Function} [deps.canAttack] - 当前场景是否允许发起基础攻击
   * @param {Function} [deps.onAttackPerformed] - 攻击实际启动后的回调
   */
  init(deps) {
    this.inputManager = deps.inputManager;
    this.combatSystem = deps.combatSystem;
    this.floatingTextManager = deps.floatingTextManager || null;
    this.canAttack = typeof deps.canAttack === 'function' ? deps.canAttack : null;
    this.onAttackPerformed = typeof deps.onAttackPerformed === 'function'
      ? deps.onAttackPerformed
      : null;
  }

  /**
   * 设置玩家实体
   * @param {Object} entity
   */
  setPlayerEntity(entity) {
    this.playerEntity = entity;
  }

  /**
   * 设置实体列表引用
   * @param {Array} entities
   */
  setEntities(entities) {
    this.entities = entities;
  }

  /**
   * 更新扇形攻击（每帧调用）
   * @param {Object} mouseWorldPos - 鼠标世界坐标
   * @param {Object} playerCenter - 玩家中心坐标
   * @param {number} currentTime - 当前时间（秒）
   */
  update(mouseWorldPos, playerCenter, currentTime) {
    if (!this.inputManager || !this.combatSystem) return;

    // 清理过期的轨迹点
    this.sliceTrail = this.sliceTrail.filter(p => currentTime - p.time < this.sliceTrailMaxAge);

    // 更新攻击闪光动画
    if (this.sectorAttackFlash > 0) {
      this.sectorAttackFlash -= 1 / 60;
    }

    // 更新刀光/箭光特效
    this.updateSectorSlashEffects(1 / 60);

    // 计算攻击方向（当方向未被外部锁定时）：
    // - 手柄连接：
    //   · 右摇杆驱动准星（isGamepadCursorActive）→ 跟随准星方向；
    //   · 右摇杆无输入 → 持续软锁定：附近有存活敌人时攻击框每帧指向最近敌人
    //     （敌人一出现方向即就绪，攻击瞬间无需抢方向）。
    //   鼠标移动、触摸、左摇杆移动均不改变攻击方向（是否跟随与左摇杆无关）。
    // - 触屏（安卓/平板）：手指按住画布 → 跟随触摸位置（方向控制）；
    //   无触摸 → 持续软锁定最近敌人（与手柄一致）。
    //   攻击按钮拖动瞄准由 SkillAimTouchCore 设置 sectorDirectionLocked，不会被此处覆盖。
    // - 键鼠：鼠标移动（有方向操作）→ 跟随鼠标；鼠标静止 → 保持当前方向。
    //   PC 不启用自动瞄准（鼠标已控制方向），手柄 RT holding 由 SceneCombatActions._syncGamepadAttackAim 锁定处理。
    if (!this.sectorDirectionLocked) {
      const gamepadOn = this.inputManager.isGamepadConnected?.() === true;
      const mouse = this.inputManager.getMousePosition?.() || { x: NaN, y: NaN };
      if (gamepadOn) {
        this._lastAimMouse = { x: mouse.x, y: mouse.y };
        if (this.inputManager.isGamepadCursorActive?.() === true) {
          const dx = mouseWorldPos.x - playerCenter.x;
          const dy = mouseWorldPos.y - playerCenter.y;
          this.sectorDirection = Math.atan2(dy, dx);
        } else {
          const aim = this.getNearestEnemyDirection?.(480);
          if (aim) this.sectorDirection = Math.atan2(aim.y, aim.x);
        }
      } else if (this.inputManager.isTouchDevice?.() === true) {
        this._lastAimMouse = { x: mouse.x, y: mouse.y };
        if (this.inputManager.isMouseButtonDown?.(0) === true) {
          const dx = mouseWorldPos.x - playerCenter.x;
          const dy = mouseWorldPos.y - playerCenter.y;
          this.sectorDirection = Math.atan2(dy, dx);
        } else {
          const aim = this.getNearestEnemyDirection?.(480);
          if (aim) this.sectorDirection = Math.atan2(aim.y, aim.x);
        }
      } else {
        const mouseMoved = !this._lastAimMouse
          || mouse.x !== this._lastAimMouse.x
          || mouse.y !== this._lastAimMouse.y;
        this._lastAimMouse = { x: mouse.x, y: mouse.y };
        if (mouseMoved) {
          const dx = mouseWorldPos.x - playerCenter.x;
          const dy = mouseWorldPos.y - playerCenter.y;
          this.sectorDirection = Math.atan2(dy, dx);
        }
      }
    }

    // 判断近战/远程
    this.sectorIsRanged = this.checkIsRangedWeapon();

    // 默认只允许战斗状态攻击；场景可注入许可回调用于训练、破坏物等非战斗动作。
    const canAttack = this.canAttack
      ? this.canAttack() === true
      : this.combatSystem?.isInCombat?.() === true;
    if (!canAttack) {
      this.isSlicing = false;
      return;
    }

    // 鼠标左键按住 / 手指触摸屏幕即触发攻击（无需点到敌人）
    // 移动端攻击由触屏按钮瞄准释放处理，不通过此处自动触发
    if (!this.disableAutoAttack &&
        this.inputManager.isMouseButtonDown(0) &&
        !this.inputManager.isMouseClickHandled()) {
      this.performSectorAttack(playerCenter, currentTime);
    }
  }

  /**
   * 检查是否装备了远程武器
   * @returns {boolean}
   */
  checkIsRangedWeapon() {
    if (!this.playerEntity) return false;
    const equipComp = this.playerEntity.getComponent('equipment');
    if (!equipComp) return false;
    const mainhand = equipComp.getEquipment('mainhand');
    if (mainhand && (mainhand.subType === 'bow' || mainhand.subType === 'crossbow' || mainhand.subType === 'staff' || mainhand.ranged === true)) {
      return true;
    }
    return false;
  }

  /**
   * 执行扇形攻击
   * @param {Object} playerCenter - 玩家中心坐标
   * @param {number} currentTime - 当前时间（秒）
   * @param {number} [overrideDistance] - 可选,覆盖攻击距离(用于触屏按distRatio缩放)
   */
  performSectorAttack(playerCenter, currentTime, overrideDistance) {
    if (!this.playerEntity || !this.combatSystem) return false;
    
    const playerStats = this.playerEntity.getComponent('stats');
    if (!playerStats) return false;
    
    // 获取武器冷却时间
    let weaponCooldown = this.sliceGlobalCooldown;
    const equipComp = this.playerEntity.getComponent('equipment');
    if (equipComp) {
      const mainhand = equipComp.getEquipment('mainhand');
      const offhand = equipComp.getEquipment('offhand');
      if (mainhand && mainhand.attackSpeed != null) {
        weaponCooldown = mainhand.attackSpeed;
      } else if (offhand && offhand.attackSpeed != null) {
        weaponCooldown = offhand.attackSpeed;
      }
    }
    
    // 检查全局武器冷却
    const timeSinceLastAttack = currentTime - this.sliceLastAttackTime;
    if (timeSinceLastAttack < weaponCooldown) {
      if (!this.sliceCooldownShown) {
        this.sliceCooldownShown = true;
        const remaining = (weaponCooldown - timeSinceLastAttack).toFixed(1);
        if (this.floatingTextManager) {
          const playerTransform = this.playerEntity.getComponent('transform');
          if (playerTransform) {
            this.floatingTextManager.addText(
              playerTransform.position.x,
              playerTransform.position.y - 70,
              `冷却中 ${remaining}s`,
              '#888888'
            );
          }
        }
      }
      return false;
    }
    
    // 远程攻击需要消耗箭矢
    if (this.sectorIsRanged) {
      const equipComp2 = this.playerEntity.getComponent('equipment');
      if (equipComp2) {
        const offhand = equipComp2.getEquipment('offhand');
        if (!offhand || offhand.subType !== 'ammo' || !offhand.quantity || offhand.quantity <= 0) {
          if (this.floatingTextManager) {
            const playerTransform = this.playerEntity.getComponent('transform');
            if (playerTransform) {
              this.floatingTextManager.addText(
                playerTransform.position.x,
                playerTransform.position.y - 70,
                '没有箭矢！',
                '#ff6666'
              );
            }
          }
          return false;
        }
        offhand.quantity -= 1;
        if (offhand.quantity <= 0) {
          equipComp2.unequip('offhand');
        }
      }
    }
    
    // 计算扇形参数
    const dir = this.sectorDirection;
    let weaponAttackRange = this.sectorAngle;
    let weaponAttackDistance = this.sliceAttackRange;
    
    if (equipComp) {
      const mainhand = equipComp.getEquipment('mainhand');
      if (mainhand) {
        if (mainhand.attackRange != null) {
          weaponAttackRange = mainhand.attackRange * Math.PI / 180;
        }
        if (mainhand.attackDistance != null) {
          weaponAttackDistance = mainhand.attackDistance;
        }
      }
    }
    
    const sectorCenterX = playerCenter.x;
    const sectorCenterY = playerCenter.y;
    const sectorRadius = overrideDistance || weaponAttackDistance;
    
    // 记录攻击时间
    this.sliceLastAttackTime = currentTime;
    this.sliceCooldownShown = false;
    
    // 触发攻击闪光
    this.sectorAttackFlash = 0.2;
    
    // 生成刀光/箭光特效
    this.spawnSectorSlashEffect(playerCenter, dir, sectorCenterX, sectorCenterY, sectorRadius);
    
    // 播放攻击动画
    const sprite = this.playerEntity.getComponent('sprite');
    if (sprite) {
      sprite.playAnimation('attack');
      setTimeoutFn(() => {
        if (sprite.currentAnimation === 'attack') sprite.playAnimation('idle');
      }, 300);
    }

    this.onAttackPerformed?.({
      player: this.playerEntity,
      isRanged: this.sectorIsRanged,
      direction: dir,
      radius: sectorRadius,
      time: currentTime
    });
    return true;
  }

  /**
   * 判断点是否在扇形内
   */
  isPointInSector(px, py, cx, cy, radius, dir, halfAngle) {
    const dx = px - cx;
    const dy = py - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > radius) return false;
    
    const angle = Math.atan2(dy, dx);
    let angleDiff = angle - dir;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    
    return Math.abs(angleDiff) <= halfAngle;
  }

  /**
   * 生成扇形攻击特效（刀光或箭光）
   */
  spawnSectorSlashEffect(playerCenter, dir, sectorCenterX, sectorCenterY, sectorRadius) {
    const type = this.sectorIsRanged ? 'arrow' : 'slash';
    
    let weaponAttackRange = this.sectorAngle;
    const equipComp = this.playerEntity?.getComponent('equipment');
    if (equipComp) {
      const mainhand = equipComp.getEquipment('mainhand');
      if (mainhand && mainhand.attackRange != null) {
        weaponAttackRange = mainhand.attackRange * Math.PI / 180;
      }
    }
    const halfAngle = weaponAttackRange / 2;
    
    if (type === 'slash') {
      const playerStats = this.playerEntity.getComponent('stats');
      const baseDmg = playerStats ? (playerStats.attack || 15) : 15;
      this.sectorSlashEffects.push({
        cx: sectorCenterX,
        cy: sectorCenterY,
        radius: sectorRadius * 0.8,
        dir: dir,
        halfAngle: halfAngle,
        age: 0,
        maxAge: 0.25,
        type: 'slash',
        damage: baseDmg,
        hitEntities: []
      });
    } else {
      const speed = 600;
      const rangedRadius = sectorRadius;
      const playerStats = this.playerEntity.getComponent('stats');
      const baseDmg = playerStats ? (playerStats.attack || 15) : 15;
      
      const mainhandWeapon = equipComp ? equipComp.getEquipment('mainhand') : null;
      const pierce = mainhandWeapon?.pierce || 0;
      const multishot = mainhandWeapon?.multishot || 0;
      
      const totalArrows = 1 + multishot;
      const spreadAngle = 0.15;
      
      for (let i = 0; i < totalArrows; i++) {
        let arrowDir = dir;
        if (totalArrows > 1) {
          const offset = (i - (totalArrows - 1) / 2) * spreadAngle;
          arrowDir = dir + offset;
        }
        
        this.sectorSlashEffects.push({
          x: playerCenter.x,
          y: playerCenter.y,
          dir: arrowDir,
          speed: speed,
          targetDist: rangedRadius,
          traveled: 0,
          age: 0,
          maxAge: rangedRadius / speed + 0.05,
          type: 'arrow',
          damage: baseDmg,
          pierce: pierce,
          pierceCount: 0,
          hitEntities: []
        });
      }
    }
  }

  /**
   * 更新扇形攻击特效
   * @param {number} deltaTime
   */
  updateSectorSlashEffects(deltaTime) {
    for (let i = this.sectorSlashEffects.length - 1; i >= 0; i--) {
      const e = this.sectorSlashEffects[i];
      e.age += deltaTime;
      
      // 剑光碰撞检测
      if (e.type === 'slash' && e.damage && this.combatSystem) {
        const progress = e.age / e.maxAge;
        const sweepRadius = e.radius * (0.3 + progress * 0.7);
        for (const entity of this.entities) {
          if (entity.type !== 'enemy') continue;
          if (entity.isDead || entity.isDying) continue;
          if (e.hitEntities && e.hitEntities.includes(entity)) continue;
          
          const targetTransform = entity.getComponent('transform');
          const targetStats = entity.getComponent('stats');
          if (!targetTransform || !targetStats || targetStats.hp <= 0) continue;
          
          const ex = targetTransform.position.x;
          const ey = targetTransform.position.y - 32;
          
          if (this.isPointInSector(ex, ey, e.cx, e.cy, sweepRadius + 25, e.dir, e.halfAngle)) {
            const dx = ex - e.cx;
            const dy = ey - e.cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist >= sweepRadius - 25) {
              const finalDamage = Math.max(1, Math.floor(e.damage * (0.8 + this._rng() * 0.4)));
              this.combatSystem.applyDamage(entity, finalDamage, null, '斩击', {
                sourceEntity: this.playerEntity,
                attackKind: 'melee'
              });
              if (this.combatSystem.createSliceEffect) {
                this.combatSystem.createSliceEffect(targetTransform.position);
              }
              if (e.hitEntities) e.hitEntities.push(entity);
            }
          }
        }
      }
      
      // 箭矢碰撞检测
      if (e.type === 'arrow') {
        e.traveled += e.speed * deltaTime;
        e.x += Math.cos(e.dir) * e.speed * deltaTime;
        e.y += Math.sin(e.dir) * e.speed * deltaTime;
        
        if (e.damage && this.combatSystem) {
          const hitRadius = 20;
          for (const entity of this.entities) {
            if (entity.type !== 'enemy') continue;
            if (entity.isDead || entity.isDying) continue;
            if (e.hitEntities && e.hitEntities.includes(entity)) continue;
            
            const targetTransform = entity.getComponent('transform');
            const targetStats = entity.getComponent('stats');
            if (!targetTransform || !targetStats || targetStats.hp <= 0) continue;
            
            const ex = targetTransform.position.x;
            const ey = targetTransform.position.y - 32;
            const dx = e.x - ex;
            const dy = e.y - ey;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist <= hitRadius) {
              const finalDamage = Math.max(1, Math.floor(e.damage * (0.8 + this._rng() * 0.4)));
              this.combatSystem.applyDamage(entity, finalDamage, null, '远程攻击', {
                sourceEntity: this.playerEntity,
                attackKind: 'ranged'
              });
              if (this.combatSystem.createSliceEffect) {
                this.combatSystem.createSliceEffect(targetTransform.position);
              }
              if (e.hitEntities) e.hitEntities.push(entity);
              
              e.pierceCount = (e.pierceCount || 0) + 1;
              if (e.pierceCount > (e.pierce || 0)) {
                e.age = e.maxAge;
                break;
              }
            }
          }
        }
      }
      if (e.age >= e.maxAge) {
        this.sectorSlashEffects.splice(i, 1);
      }
    }
  }

  /**
   * 渲染扇形攻击特效（刀光/箭光）
   * @param {CanvasRenderingContext2D} ctx
   */
  renderSectorSlashEffects(ctx) {
    if (this.sectorSlashEffects.length === 0) return;
    
    ctx.save();
    
    for (const e of this.sectorSlashEffects) {
      const alpha = Math.max(0, 1 - e.age / e.maxAge);
      
      if (e.type === 'slash') {
        const progress = e.age / e.maxAge;
        const sweepR = e.radius * (0.3 + progress * 0.7);
        const startAngle = e.dir - e.halfAngle;
        const endAngle = e.dir + e.halfAngle;
        const maxThick = 12 * (1 - progress * 0.4);
        
        const tipStartX = e.cx + Math.cos(startAngle) * sweepR;
        const tipStartY = e.cy + Math.sin(startAngle) * sweepR;
        const tipEndX = e.cx + Math.cos(endAngle) * sweepR;
        const tipEndY = e.cy + Math.sin(endAngle) * sweepR;
        const midAngle = e.dir;
        const outerMidX = e.cx + Math.cos(midAngle) * (sweepR + maxThick);
        const outerMidY = e.cy + Math.sin(midAngle) * (sweepR + maxThick);
        const innerMidX = e.cx + Math.cos(midAngle) * (sweepR - maxThick * 0.4);
        const innerMidY = e.cy + Math.sin(midAngle) * (sweepR - maxThick * 0.4);
        
        // 外层光晕
        ctx.beginPath();
        ctx.moveTo(tipStartX, tipStartY);
        ctx.quadraticCurveTo(e.cx + Math.cos(midAngle) * (sweepR + maxThick + 5), e.cy + Math.sin(midAngle) * (sweepR + maxThick + 5), tipEndX, tipEndY);
        ctx.quadraticCurveTo(e.cx + Math.cos(midAngle) * (sweepR - maxThick * 0.4 - 3), e.cy + Math.sin(midAngle) * (sweepR - maxThick * 0.4 - 3), tipStartX, tipStartY);
        ctx.closePath();
        ctx.fillStyle = `rgba(200, 230, 255, ${alpha * 0.2})`;
        ctx.fill();
        
        // 中层光芒
        ctx.beginPath();
        ctx.moveTo(tipStartX, tipStartY);
        ctx.quadraticCurveTo(e.cx + Math.cos(midAngle) * (sweepR + maxThick + 2), e.cy + Math.sin(midAngle) * (sweepR + maxThick + 2), tipEndX, tipEndY);
        ctx.quadraticCurveTo(e.cx + Math.cos(midAngle) * (sweepR - maxThick * 0.3), e.cy + Math.sin(midAngle) * (sweepR - maxThick * 0.3), tipStartX, tipStartY);
        ctx.closePath();
        ctx.fillStyle = `rgba(220, 240, 255, ${alpha * 0.5})`;
        ctx.fill();
        
        // 内层白色核心
        ctx.beginPath();
        ctx.moveTo(tipStartX, tipStartY);
        ctx.quadraticCurveTo(outerMidX, outerMidY, tipEndX, tipEndY);
        ctx.quadraticCurveTo(innerMidX, innerMidY, tipStartX, tipStartY);
        ctx.closePath();
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
        ctx.fill();
        
      } else if (e.type === 'arrow') {
        const len = 20;
        const tailX = e.x - Math.cos(e.dir) * len;
        const tailY = e.y - Math.sin(e.dir) * len;
        
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(e.x, e.y);
        ctx.strokeStyle = `rgba(255, 220, 150, ${alpha * 0.3})`;
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(e.x, e.y);
        ctx.strokeStyle = `rgba(255, 240, 200, ${alpha * 0.7})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(e.x, e.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.fill();
      }
    }
    
    ctx.restore();
  }

  /**
   * 渲染战斗警示圆圈
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} camera - 相机对象（用于获取鼠标世界坐标）
   */
  renderCombatAlertCircle(ctx, camera) {
    const transform = this.playerEntity.getComponent('transform');
    if (!transform) return;
    
    const sprite = this.playerEntity.getComponent('sprite');
    const spriteHeight = sprite?.height || 64;
    const cx = transform.position.x;
    const cy = transform.position.y - spriteHeight / 2;
    
    ctx.save();
    
    const dir = this.sectorDirection;
    const time = performance.now() / 1000;
    const dashOffset = (time * 20) % 20;
    
    // 从武器数据获取攻击范围和距离
    let weaponAttackRange = this.sectorAngle;
    let weaponAttackDistance = this.sliceAttackRange;
    const equipComp = this.playerEntity.getComponent('equipment');
    if (equipComp) {
      const mainhand = equipComp.getEquipment('mainhand');
      if (mainhand) {
        if (mainhand.attackRange != null) {
          weaponAttackRange = mainhand.attackRange * Math.PI / 180;
        }
        if (mainhand.attackDistance != null) {
          weaponAttackDistance = mainhand.attackDistance;
        }
      }
    }
    const halfAngle = weaponAttackRange / 2;
    const r = weaponAttackDistance;
    
    // 攻击闪光效果
    const flashAlpha = Math.max(0, this.sectorAttackFlash / 0.2);
    
    if (this.sectorIsRanged) {
      // 远程：不再显示椭圆瞄准框（由攻击按钮的技能预览虚线框替代）
    } else if (this.hideSectorWhenIdle && !this.sectorDirectionLocked) {
      // 移动端近战：仅瞄准按住时显示扇形（sectorDirectionLocked 表示正在瞄准）
    } else {
      // 近战扇形
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, dir - halfAngle, dir + halfAngle);
      ctx.closePath();
      if (flashAlpha > 0) {
        ctx.fillStyle = `rgba(100, 255, 100, ${0.12 + flashAlpha * 0.4})`;
      } else {
        ctx.fillStyle = 'rgba(100, 255, 100, 0.12)';
      }
      ctx.fill();
      
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, dir - halfAngle, dir + halfAngle);
      ctx.closePath();
      ctx.strokeStyle = flashAlpha > 0 ? `rgba(150, 255, 150, ${0.6 + flashAlpha * 0.4})` : 'rgba(100, 255, 100, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 5]);
      ctx.lineDashOffset = -dashOffset;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    
    // 武器冷却时间条
    const currentTime = performance.now() / 1000;
    const timeSinceLastAttack = currentTime - this.sliceLastAttackTime;
    
    let weaponCooldown = this.sliceGlobalCooldown;
    if (equipComp) {
      const mainhand2 = equipComp.getEquipment('mainhand');
      const offhand2 = equipComp.getEquipment('offhand');
      if (mainhand2 && mainhand2.attackSpeed != null) {
        weaponCooldown = mainhand2.attackSpeed;
      } else if (offhand2 && offhand2.attackSpeed != null) {
        weaponCooldown = offhand2.attackSpeed;
      }
    }
    
    if (timeSinceLastAttack < weaponCooldown && this.sliceLastAttackTime > 0) {
      const barWidth = 40;
      const barHeight = 5;
      const barX = cx - barWidth / 2;
      const barY = transform.position.y - spriteHeight - 18;
      const cooldownRatio = timeSinceLastAttack / weaponCooldown;
      
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(barX, barY, barWidth, barHeight);
      
      const gradient = ctx.createLinearGradient(barX, barY, barX + barWidth, barY);
      gradient.addColorStop(0, '#ff6600');
      gradient.addColorStop(1, '#ffcc00');
      ctx.fillStyle = gradient;
      ctx.fillRect(barX, barY, barWidth * cooldownRatio, barHeight);
      
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(barX, barY, barWidth, barHeight);
      
      const remaining = (weaponCooldown - timeSinceLastAttack).toFixed(1);
      ctx.font = '9px Arial';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${remaining}s`, cx, barY - 2);
    }
    
    // 远程武器时显示剩余箭矢数量
    if (this.sectorIsRanged) {
      const eqComp = this.playerEntity.getComponent('equipment');
      if (eqComp) {
        const offhand = eqComp.getEquipment('offhand');
        const arrowCount = (offhand && offhand.subType === 'ammo') ? (offhand.quantity || 0) : 0;
        ctx.font = 'bold 11px Arial';
        ctx.textAlign = 'center';
        ctx.fillStyle = arrowCount > 10 ? '#88ccff' : arrowCount > 0 ? '#ffaa44' : '#ff4444';
        ctx.fillText(`${arrowCount}`, cx, transform.position.y - spriteHeight - 24);
      }
    }
    
    ctx.restore();
  }

  /**
   * 渲染滑动刀光轨迹
   * @param {CanvasRenderingContext2D} ctx
   */
  renderSliceTrail(ctx) {
    if (this.sliceTrail.length < 2) return;
    
    const currentTime = performance.now() / 1000;
    
    ctx.save();
    
    for (let i = 1; i < this.sliceTrail.length; i++) {
      const p0 = this.sliceTrail[i - 1];
      const p1 = this.sliceTrail[i];
      
      const age = currentTime - p1.time;
      const alpha = Math.max(0, 1 - age / this.sliceTrailMaxAge);
      if (alpha <= 0) continue;
      
      const posRatio = i / this.sliceTrail.length;
      const widthCurve = Math.sin(posRatio * Math.PI);
      const width = widthCurve * 5 * alpha + 0.5;
      
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      
      ctx.strokeStyle = `rgba(200, 230, 255, ${alpha * 0.3})`;
      ctx.lineWidth = width + 6;
      ctx.lineCap = 'round';
      ctx.stroke();
      
      ctx.strokeStyle = `rgba(180, 220, 255, ${alpha * 0.6})`;
      ctx.lineWidth = width + 2;
      ctx.stroke();
      
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.9})`;
      ctx.lineWidth = width;
      ctx.stroke();
    }
    
    ctx.restore();
  }

  /**
   * 获取扇形方向（供外部使用）
   */
  getSectorDirection() {
    return this.sectorDirection;
  }

  /**
   * 自动瞄准辅助：最近存活敌人的方向向量（战斗辅助瞄准用）。
   * 排除死亡/濒死/剧情倒地目标；无玩家、无实体或射程外无敌人时返回 null。
   * @param {number} [maxRange=480] - 索敌半径（世界像素）
   * @returns {{x:number, y:number}|null} 归一化方向向量
   */
  getNearestEnemyDirection(maxRange = 480) {
    const transform = this.playerEntity?.getComponent?.('transform');
    if (!transform) return null;
    const px = transform.position.x;
    const py = transform.position.y;
    let best = null;
    let bestDistSq = maxRange * maxRange;
    for (const entity of this.entities || []) {
      if (!entity || entity.type !== 'enemy' || entity.isDead || entity.isDying || entity.plotDowned) continue;
      const enemyTransform = entity.getComponent?.('transform');
      if (!enemyTransform) continue;
      const dx = enemyTransform.position.x - px;
      const dy = enemyTransform.position.y - py;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = { x: dx, y: dy };
      }
    }
    if (!best) return null;
    const magnitude = Math.hypot(best.x, best.y) || 1;
    return { x: best.x / magnitude, y: best.y / magnitude };
  }

  /**
   * 获取是否远程攻击
   * @returns {boolean}
   */
  getIsRanged() {
    return this.sectorIsRanged;
  }

  /**
   * 清理系统状态
   */
  cleanup() {
    this.sliceTrail = [];
    this.sectorSlashEffects = [];
    this.slicedEnemies.clear();
    this.sliceCooldowns.clear();
    this.playerEntity = null;
    this.entities = [];
  }
}
