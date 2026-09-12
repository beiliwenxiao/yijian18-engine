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
 * CombatSystem.js
 * 战斗系统 - 处理目标选择、攻击、技能释放等战斗逻辑
 */

import { ElementSystem } from './ElementSystem.js';
import { UnitSystem } from './UnitSystem.js';
import { CombatResolver } from './resolvers/CombatResolver.js';

/**
 * 战斗系统
 * 处理目标选择、攻击范围检测、伤害计算等
 */
export class CombatSystem {
  /**
   * @param {Object} config - 配置
   * @param {InputManager} config.inputManager - 输入管理器
   * @param {Camera} config.camera - 相机
   * @param {MockDataService} config.dataService - 数据服务（可选）
   * @param {SkillEffects} config.skillEffects - 技能特效系统（可选）
   * @param {StatusEffectSystem} config.statusEffectSystem - 状态效果系统（可选）
   * @param {WeaponRenderer} config.weaponRenderer - 武器渲染器（可选）
   * @param {EnemyWeaponRenderer} config.enemyWeaponRenderer - 敌人武器渲染器（可选）
   * @param {FloatingTextManager} config.floatingTextManager - 飘字管理器（可选）
   */
  constructor(config = {}) {
    this.inputManager = config.inputManager;
    this.camera = config.camera;
    this.dataService = config.dataService;
    this.skillEffects = config.skillEffects;
    this.statusEffectSystem = config.statusEffectSystem;
    this.weaponRenderer = config.weaponRenderer;
    this.enemyWeaponRenderer = config.enemyWeaponRenderer;
    this.floatingTextManager = config.floatingTextManager;
    this.now = typeof config.now === 'function' ? config.now : () => performance.now();
    this.effectAmountFilter = typeof config.effectAmountFilter === 'function'
      ? config.effectAmountFilter
      : null;
    
    // 初始化元素系统
    this.elementSystem = new ElementSystem();
    
    // 初始化兵种系统
    this.unitSystem = new UnitSystem();

    // 战斗随机源（§13 约定6）：单机为 null → Resolver 内部用 Math.random（与旧行为等价）；
    // 联网/回放时注入种子 RNG（RNG 实例）实现确定性结算。
    this.combatRng = config.combatRng || null;
    
    // 玩家实体引用
    this.playerEntity = null;
    
    // 当前选中的目标
    this.selectedTarget = null;
    
    // 目标高亮配置
    this.highlightConfig = {
      color: '#ffff00',
      lineWidth: 2,
      radius: 30
    };
    
    // 伤害数字列表
    this.damageNumbers = [];
    
    // 技能快捷键映射（1-2药水，3-7技能）
    this.skillKeyMap = {
      'skill3': 0,
      'skill4': 1,
      'skill5': 2,
      'skill6': 3,
      'skill7': 4
    };
    
    // 药水快捷键映射
    this.potionKeyMap = {
      'skill1': 'health',
      'skill2': 'mana'
    };
    
    // 格挡状态：记录哪些敌人的攻击被格挡了
    // Map<enemyId, { blocked: boolean, time: number }>
    this.blockedAttacks = new Map();
    
    // 主动格挡状态
    this._activeBlock = {
      active: false,       // 是否正在格挡
      startTime: 0,        // 格挡开始时间（ms）
      duration: 1000,      // 格挡持续时间（ms）
      cooldownMs: 8000,    // 冷却时间（ms）
      lastUseTime: 0       // 上次使用时间（ms）
    };
    
    // 武器碰撞冷却：防止同一次攻击重复触发碰撞
    // Map<enemyId, number> - 记录上次碰撞时间
    this.weaponCollisionCooldowns = new Map();
    
    // 技能范围指示器列表
    this.skillRangeIndicators = [];
    
    // 技能颜色映射
    this.skillColorMap = {
      'flame_palm': '#ff6600',
      'ice_finger': '#00ccff',
      'inferno_palm': '#ff3300',
      'heal': '#00ff00',
      'meditation': '#88ccff',
      'fireball': '#ff6600',
      'ice_lance': '#00ccff',
      'flame_burst': '#ff3300'
    };
    
    // 战斗状态管理
    this.combatState = {
      inCombat: false,
      lastCombatTime: 0,
      combatExitTimer: 0,
      combatExitDelay: 5,  // 脱离战斗延迟（秒）
      combatRange: 300     // 战斗检测范围（像素）
    };
    
    // 战斗状态回调
    this.onEnterCombatCallback = null;
    this.onExitCombatCallback = null;
    this.onDamageCallback = null;
    this._damageListeners = new Set();
    this.onPlayerDeathCallback = null;
    this.isPlayerInputLocked = typeof config.isPlayerInputLocked === 'function'
      ? config.isPlayerInputLocked
      : () => false;
    // 击杀回调（敌人死亡时触发，供数据驱动 kill 事件源 / 任务计数用）
    this.onKillCallback = null;
    // 尸体保留回调由场景运行时注入，CombatSystem 不解释具体怪物或采集定义。
    this.onCorpseCreateCallback = null;

    // 战斗日志降频：同一 key 每 intervalMs 至多打印一条，避免多狼齐攻时同步 console 卡顿主线程。
    this._logThrottleMap = new Map();
    this._logThrottleInterval = 1000;

    console.log('CombatSystem: Initialized');
  }

  /** 降频日志：同 key 在 interval 内只 console.log 一次，其余丢弃。 */
  _logThrottled(message, key = 'global') {
    const now = Date.now();
    const last = this._logThrottleMap.get(key) || 0;
    if (now - last < this._logThrottleInterval) return;
    this._logThrottleMap.set(key, now);
    console.log(message);
  }

  /** 注入领域效果量过滤器；返回旧过滤器，便于场景退出时恢复。 */
  setEffectAmountFilter(filter = null) {
    const previous = this.effectAmountFilter;
    this.effectAmountFilter = typeof filter === 'function' ? filter : null;
    return previous;
  }

  _filterEffectAmount(effectType, sourceEntity, targetEntity, amount) {
    const normalized = Math.max(0, Number(amount) || 0);
    if (!this.effectAmountFilter) return normalized;
    const targetFactionId = targetEntity?.factionId
      || targetEntity?.faction
      || targetEntity?.getComponent?.('stats')?.factionId
      || null;
    const filtered = this.effectAmountFilter({
      effectType,
      sourceEntityId: sourceEntity?.id || null,
      targetEntityId: targetEntity?.id || null,
      targetFactionId,
      sourceEntity,
      targetEntity
    }, normalized);
    return Math.max(0, Number(filtered) || 0);
  }

  /**
   * 设置玩家实体
   * @param {Entity} entity - 玩家实体
   */
  setPlayerEntity(entity) {
    this.playerEntity = entity;
  }

  /**
   * 更新系统
   * @param {number} deltaTime - 帧间隔时间（秒）
   * @param {Array<Entity>} entities - 实体列表
   */
  update(deltaTime, entities) {
    const currentTime = this.now();
    
    // 清理过期的格挡标记（超过0.5秒）
    this.cleanupBlockedAttacks(currentTime);
    
    // 更新大规模战斗（如果激活）
    if (this.largeBattle && this.largeBattle.active) {
      this.updateLargeScaleBattle(deltaTime, currentTime);
    }
    
    // 处理目标选择输入
    this.handleTargetSelection(entities);
    
    // 自动选中最近的敌人（如果没有目标）
    this.autoSelectNearestEnemy(entities);
    
    // 处理技能输入
    this.handleSkillInput(currentTime, entities);
    
    // 处理自动攻击
    this.handleAutoAttack(currentTime, entities);
    
    // 武器碰撞已禁用（使用滑动攻击）
    // this.checkWeaponCollisions(entities);
    
    // 检查死亡
    this.checkDeath(entities);
    
    // 更新伤害数字
    this.updateDamageNumbers(deltaTime);
    
    // 更新技能范围指示器
    this.updateSkillRangeIndicators(deltaTime);
    
    // 更新战斗组件
    for (const entity of entities) {
      const combat = entity.getComponent('combat');
      if (combat) {
        combat.update(deltaTime);
      }
    }
  }
  
  /**
   * 清理过期的格挡标记
   * @param {number} currentTime - 当前时间（毫秒）
   */
  cleanupBlockedAttacks(currentTime) {
    const expireTime = 500; // 0.5秒后过期
    
    for (const [enemyId, blockInfo] of this.blockedAttacks.entries()) {
      if (currentTime - blockInfo.time > expireTime) {
        this.blockedAttacks.delete(enemyId);
      }
    }
    
    // 清理过期的碰撞冷却记录
    const collisionExpireTime = 1000; // 1秒后过期
    for (const [enemyId, collisionTime] of this.weaponCollisionCooldowns.entries()) {
      if (currentTime - collisionTime > collisionExpireTime) {
        this.weaponCollisionCooldowns.delete(enemyId);
      }
    }
    
    // 主动格挡超时自动结束
    if (this._activeBlock.active && (currentTime - this._activeBlock.startTime >= this._activeBlock.duration)) {
      this._activeBlock.active = false;
    }
  }

  /**
   * 激活主动格挡（持续1秒挡住所有攻击）
   * @returns {boolean} 是否成功激活
   */
  activateBlock() {
    const now = this.now();
    // 冷却检查
    if (now - this._activeBlock.lastUseTime < this._activeBlock.cooldownMs) {
      return false;
    }
    // 已在格挡中
    if (this._activeBlock.active) {
      return false;
    }
    this._activeBlock.active = true;
    this._activeBlock.startTime = now;
    this._activeBlock.lastUseTime = now;
    return true;
  }

  /**
   * 获取主动格挡冷却剩余时间（毫秒）
   * @returns {number}
   */
  getBlockCooldownRemaining() {
    const elapsed = this.now() - this._activeBlock.lastUseTime;
    return Math.max(0, this._activeBlock.cooldownMs - elapsed);
  }

  /**
   * 获取主动格挡冷却总时间（毫秒）
   * @returns {number}
   */
  getBlockCooldownTotal() {
    return this._activeBlock.cooldownMs;
  }

  /**
   * 是否正在主动格挡中
   * @returns {boolean}
   */
  isBlocking() {
    if (!this._activeBlock.active) return false;
    if (this.now() - this._activeBlock.startTime >= this._activeBlock.duration) {
      this._activeBlock.active = false;
      return false;
    }
    return true;
  }

  /**
   * 处理目标选择
   * @param {Array<Entity>} entities - 实体列表
   */
  handleTargetSelection(entities) {
    if (!this.inputManager || !this.playerEntity) return;
    
    // 检测鼠标点击（左键）
    if (this.inputManager.isMouseClicked() && this.inputManager.getMouseButton() === 0) {
      const clickPos = this.inputManager.getMouseWorldPosition();
      
      // 查找点击位置的敌人
      const clickedEnemy = this.findEnemyAtPosition(clickPos, entities);
      
      if (clickedEnemy) {
        // 选中敌人
        this.selectTarget(clickedEnemy);
        console.log(`CombatSystem: Selected target: ${clickedEnemy.name || clickedEnemy.id}`);
      } else {
        // 点击空白处，取消选中
        // 注意：这里不取消选中，因为点击空白处可能是移动指令
        // 只有在点击到其他敌人或按ESC时才取消选中
      }
    }
    
    // 按ESC取消选中
    if (this.inputManager.isKeyPressed('escape')) {
      this.clearTarget();
    }
    
    // 检查当前目标是否仍然有效
    if (this.selectedTarget) {
      const stats = this.selectedTarget.getComponent('stats');
      if (!stats || stats.hp <= 0) {
        // 目标已死亡，清除选中
        this.clearTarget();
      }
    }
  }

  /**
   * 查找指定位置的敌人
   * @param {Object} position - 位置 {x, y}
   * @param {Array<Entity>} entities - 实体列表
   * @returns {Entity|null}
   */
  findEnemyAtPosition(position, entities) {
    // 点击检测半径
    const clickRadius = 30;
    
    // 查找所有敌人
    const enemies = entities.filter(e => e.type === 'enemy');
    
    // 查找最近的敌人
    let closestEnemy = null;
    let closestDistance = Infinity;
    
    for (const enemy of enemies) {
      const transform = enemy.getComponent('transform');
      if (!transform) {
        console.warn(`Enemy ${enemy.id} has no transform component`);
        continue;
      }
      
      // 计算距离
      const dx = transform.position.x - position.x;
      const dy = transform.position.y - position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // 如果在点击范围内且更近
      if (distance <= clickRadius && distance < closestDistance) {
        closestDistance = distance;
        closestEnemy = enemy;
      }
    }
    
    return closestEnemy;
  }

  /**
   * 选中目标
   * @param {Entity} target - 目标实体
   */
  selectTarget(target) {
    // 清除之前的目标
    if (this.selectedTarget) {
      const oldCombat = this.playerEntity.getComponent('combat');
      if (oldCombat) {
        oldCombat.clearTarget();
      }
    }
    
    // 设置新目标
    this.selectedTarget = target;
    
    // 更新玩家的战斗组件
    const combat = this.playerEntity.getComponent('combat');
    if (combat) {
      combat.setTarget(target);
    }
  }

  /**
   * 清除目标
   */
  clearTarget() {
    if (this.selectedTarget) {
      console.log('CombatSystem: Target cleared');
    }
    
    this.selectedTarget = null;
    
    // 清除玩家的战斗组件目标
    if (this.playerEntity) {
      const combat = this.playerEntity.getComponent('combat');
      if (combat) {
        combat.clearTarget();
      }
    }
  }

  /**
   * 获取当前选中的目标
   * @returns {Entity|null}
   */
  getSelectedTarget() {
    return this.selectedTarget;
  }
  
  /**
   * 自动选中最近的敌人
   * @param {Array<Entity>} entities - 实体列表
   */
  autoSelectNearestEnemy(entities) {
    if (!this.playerEntity) return;
    
    // 如果已经有目标
    if (this.selectedTarget) {
      const stats = this.selectedTarget.getComponent('stats');
      // 只有当目标死亡时才清除选中
      if (!stats || stats.hp <= 0 || this.selectedTarget.isDead) {
        this.clearTarget();
      } else {
        // 目标还活着，保持选中状态
        return;
      }
    }
    
    // 没有目标时，自动选中最近的敌人
    const playerTransform = this.playerEntity.getComponent('transform');
    if (!playerTransform) return;
    
    // 查找最近的敌人
    const enemies = entities.filter(e => e.type === 'enemy' && !e.isDead);
    if (enemies.length === 0) return;
    
    let nearestEnemy = null;
    let nearestDistance = 200; // 自动选中范围：200像素
    
    for (const enemy of enemies) {
      const enemyTransform = enemy.getComponent('transform');
      const enemyStats = enemy.getComponent('stats');
      
      if (!enemyTransform || !enemyStats || enemyStats.hp <= 0) continue;
      
      const dx = enemyTransform.position.x - playerTransform.position.x;
      const dy = enemyTransform.position.y - playerTransform.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestEnemy = enemy;
      }
    }
    
    // 如果找到了最近的敌人，自动选中
    if (nearestEnemy) {
      this.selectTarget(nearestEnemy);
    }
  }

  /**
   * 渲染战斗系统UI
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  render(ctx) {
    // 渲染大规模战斗态势UI
    if (this.largeBattle && this.largeBattle.active) {
      this.renderBattleSituation(ctx);
    }
    
    // 渲染目标高亮 - 已禁用
    // if (this.selectedTarget) {
    //   this.renderTargetHighlight(ctx, this.selectedTarget);
    // }
    
    // 渲染目标框架UI - 已禁用（不再需要选中敌人）
    // if (this.selectedTarget) {
    //   this.renderTargetFrame(ctx, this.selectedTarget);
    // }
    
    // 渲染伤害数字
    this.renderDamageNumbers(ctx);
  }

  /**
   * 渲染伤害数字
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderDamageNumbers(ctx) {
    if (this.damageNumbers.length === 0) return;

    const currentTime = this.now();
    // 调试日志（每秒只输出一次）
    if (this._lastDamageNumberLog == null || currentTime - this._lastDamageNumberLog > 1000) {
      console.log(`[renderDamageNumbers] 正在渲染 ${this.damageNumbers.length} 个伤害数字`);
      this._lastDamageNumberLog = currentTime;
    }

    ctx.save();

    for (const dn of this.damageNumbers) {
      // 转换为屏幕坐标
      const screenPos = this.worldToScreen({ x: dn.x, y: dn.y });
      const isWeaponCollision = typeof dn.damageType === 'string'
        && dn.damageType.startsWith('武器碰撞');

      // 调试：武器碰撞可能持续多帧，坐标日志最多每秒输出一次。
      if (isWeaponCollision
        && (this._lastWeaponCollisionRenderLog == null
          || currentTime - this._lastWeaponCollisionRenderLog > 1000)) {
        console.log(`[renderDamageNumbers] 武器碰撞伤害 世界坐标:(${dn.x.toFixed(0)}, ${dn.y.toFixed(0)}) -> 屏幕坐标:(${screenPos.x.toFixed(0)}, ${screenPos.y.toFixed(0)})`);
        this._lastWeaponCollisionRenderLog = currentTime;
      }

      // 计算透明度（根据生命周期）
      const alpha = dn.life / dn.maxLife;

      // 计算缩放（开始时放大，然后缩小）
      const scale = alpha > 0.8 ? 1.0 + (1.0 - alpha) * 2 : 1.0;

      // 绘制数字
      ctx.globalAlpha = alpha;
      // 根据伤害类型选择颜色
      if (dn.isHeal) {
        ctx.fillStyle = '#00ff00'; // 治疗为绿色
      } else if (dn.damage === 0) {
        ctx.fillStyle = '#aaaaaa'; // 0伤害（格挡/Miss）为灰色
      } else if (isWeaponCollision) {
        ctx.fillStyle = '#ff6666'; // 武器碰撞为红色
      } else {
        ctx.fillStyle = '#ffff00'; // 普通伤害为黄色
      }
      ctx.strokeStyle = '#000000';
      ctx.font = `bold ${Math.floor(24 * scale)}px Arial`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;

      // 构建显示文本：如果有伤害类型，显示"类型 -数值"，否则只显示"-数值"
      let text;
      if (dn.isHeal) {
        text = `+${dn.damage}`;
      } else if (dn.damage === 0) {
        // 0伤害显示为格挡或Miss
        if (dn.damageType && dn.damageType.includes('格挡')) {
          text = '格挡';
        } else if (dn.damageType && dn.damageType.includes('碰撞')) {
          text = '碰撞';
        } else {
          text = 'Miss';
        }
      } else if (dn.damageType) {
        text = `${dn.damageType} -${dn.damage}`;
      } else {
        text = `-${dn.damage}`;
      }

      // 描边
      ctx.strokeText(text, screenPos.x, screenPos.y);
      // 填充
      ctx.fillText(text, screenPos.x, screenPos.y);
    }

    ctx.restore();
  }

  /**
   * 渲染目标高亮
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Entity} target - 目标实体
   */
  renderTargetHighlight(ctx, target) {
    const transform = target.getComponent('transform');
    if (!transform) return;
    
    // 转换为屏幕坐标
    const screenPos = this.worldToScreen(transform.position);
    
    // 绘制高亮圆圈
    ctx.save();
    ctx.strokeStyle = this.highlightConfig.color;
    ctx.lineWidth = this.highlightConfig.lineWidth;
    ctx.beginPath();
    ctx.arc(
      screenPos.x,
      screenPos.y,
      this.highlightConfig.radius,
      0,
      Math.PI * 2
    );
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 渲染目标框架UI
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Entity} target - 目标实体
   */
  renderTargetFrame(ctx, target) {
    const stats = target.getComponent('stats');
    if (!stats) return;
    
    // 目标框架位置（屏幕右上角）
    const frameX = ctx.canvas.width - 250;
    const frameY = 20;
    const frameWidth = 230;
    const frameHeight = 80;
    
    // 绘制背景
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(frameX, frameY, frameWidth, frameHeight);
    
    // 绘制边框
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 2;
    ctx.strokeRect(frameX, frameY, frameWidth, frameHeight);
    
    // 绘制目标名称
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(target.name || 'Unknown', frameX + 10, frameY + 25);
    
    // 绘制等级
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '14px Arial';
    ctx.fillText(`Lv.${target.level || 1}`, frameX + 10, frameY + 45);
    
    // 绘制生命值条
    const hpBarX = frameX + 10;
    const hpBarY = frameY + 55;
    const hpBarWidth = frameWidth - 20;
    const hpBarHeight = 15;
    
    // 生命值条背景
    ctx.fillStyle = '#333333';
    ctx.fillRect(hpBarX, hpBarY, hpBarWidth, hpBarHeight);
    
    // 生命值条
    const hpPercent = stats.hp / stats.maxHp;
    ctx.fillStyle = this.getHealthBarColor(hpPercent);
    ctx.fillRect(hpBarX, hpBarY, hpBarWidth * hpPercent, hpBarHeight);
    
    // 生命值文本
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(
      `${Math.ceil(stats.hp)} / ${stats.maxHp}`,
      hpBarX + hpBarWidth / 2,
      hpBarY + hpBarHeight - 3
    );
    
    ctx.restore();
  }

  /**
   * 获取生命值条颜色
   * @param {number} percent - 生命值百分比
   * @returns {string}
   */
  getHealthBarColor(percent) {
    if (percent > 0.5) {
      return '#00ff00'; // 绿色
    } else if (percent > 0.25) {
      return '#ffff00'; // 黄色
    } else {
      return '#ff0000'; // 红色
    }
  }

  /**
   * 处理自动攻击 - 已移除自动攻击逻辑
   * @param {number} currentTime - 当前时间（毫秒）
   * @param {Array<Entity>} entities - 实体列表
   */
  handleAutoAttack(currentTime, entities) {
    // 自动攻击已移除，玩家需要按1键手动攻击
  }

  /**
   * 检查是否在攻击范围内
   * @param {Entity} attacker - 攻击者
   * @param {Entity} target - 目标
   * @param {number} range - 攻击范围
   * @returns {boolean}
   */
  isInRange(attacker, target, range) {
    const attackerTransform = attacker.getComponent('transform');
    const targetTransform = target.getComponent('transform');
    
    if (!attackerTransform || !targetTransform) return false;
    
    const dx = targetTransform.position.x - attackerTransform.position.x;
    const dy = targetTransform.position.y - attackerTransform.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    return distance <= range;
  }

  /**
   * 执行攻击
   * @param {Entity} attacker - 攻击者
   * @param {Entity} target - 目标
   * @param {number} currentTime - 当前时间（毫秒）
   */
  performAttack(attacker, target, currentTime) {
    const combat = attacker.getComponent('combat');
    const sprite = attacker.getComponent('sprite');
    const attackerTransform = attacker.getComponent('transform');
    const targetTransform = target.getComponent('transform');
    
    if (!combat) return;
    
    // 检查敌人攻击是否被格挡
    if (attacker.type === 'enemy' && target.type === 'player') {
      // 主动格挡检查（优先级最高）
      const now = this.now();
      if (this._activeBlock.active && (now - this._activeBlock.startTime < this._activeBlock.duration)) {
        // 主动格挡生效
        if (targetTransform && this.floatingTextManager) {
          this.floatingTextManager.addText(
            targetTransform.position.x,
            targetTransform.position.y - 60,
            '格挡！',
            '#00ffff'
          );
        }
        combat.attack(currentTime);
        return;
      }
      // 主动格挡超时自动结束
      if (this._activeBlock.active && (now - this._activeBlock.startTime >= this._activeBlock.duration)) {
        this._activeBlock.active = false;
      }
      
      // 检查玩家武器是否眩晕（无法格挡）
      if (this.weaponRenderer && this.weaponRenderer.stunned.active) {
        console.log(`${attacker.name || attacker.id} 的攻击命中！玩家武器眩晕中，无法格挡`);
        // 武器眩晕，无法格挡，继续正常攻击流程
      } else {
        // 武器未眩晕，检查是否有格挡标记
        const blockInfo = this.blockedAttacks.get(attacker.id);
        if (blockInfo && blockInfo.blocked) {
          // 攻击被格挡，不造成伤害
          console.log(`${attacker.name || attacker.id} 的攻击被格挡！`);
          
          // 显示格挡提示
          if (targetTransform && this.floatingTextManager) {
            this.floatingTextManager.addText(
              targetTransform.position.x,
              targetTransform.position.y - 60,
              '格挡！',
              '#00ffff'
            );
          }
          
          // 清除格挡标记（格挡只生效一次）
          this.blockedAttacks.delete(attacker.id);
          
          // 更新冷却时间但不造成伤害
          combat.attack(currentTime);
          return;
        }
      }
    }
    
    // 执行攻击（更新冷却时间）
    if (combat.attack(currentTime)) {
      // 播放攻击动画
      if (sprite) {
        sprite.playAnimation('attack');
        
        // 攻击动画结束后恢复待机动画
        setTimeout(() => {
          if (sprite.currentAnimation === 'attack') {
            sprite.playAnimation('idle');
          }
        }, 300); // 假设攻击动画持续300ms
      }
      
      // 如果是敌人攻击，触发敌人武器动画
      if (attacker.type === 'enemy' && this.enemyWeaponRenderer && attackerTransform && targetTransform) {
        this._logThrottled(`[敌人攻击] 触发武器动画: ${attacker.id}`);
        this.enemyWeaponRenderer.startAttack(attacker, targetTransform.position);
      }
      
      // 创建攻击特效
      if (this.skillEffects && attackerTransform) {
        this.skillEffects.createSkillEffect('basic_attack', attackerTransform.position);
      }
      
      // 计算并应用伤害（传入攻击类型）
      const damage = this.calculateDamage(attacker, target);
      const attackType = this.getAttackText(attacker);
      this.applyDamage(target, damage, null, attackType, { sourceEntity: attacker });

      this._logThrottled(`${attacker.name || attacker.id} 攻击 ${target.name || target.id}，造成 ${damage} 点伤害`);
    }
  }
  
  /**
   * 获取攻击方式文本
   * @param {Entity} attacker - 攻击者
   * @returns {string} 攻击方式文本
   */
  getAttackText(attacker) {
    // 根据敌人的templateId或名字判断攻击方式
    const templateId = attacker.templateId || '';
    const name = attacker.name || '';
    
    // 野狗用咬的
    if (templateId === 'wild_dog' || name.includes('野狗')) {
      return '撕咬';
    }
    
    // 其他敌人用武器攻击
    // 可以根据不同敌人类型返回不同的攻击方式
    if (templateId === 'soldier' || name.includes('士兵')) {
      return '刀砍';
    }
    
    if (templateId === 'bandit' || name.includes('土匪')) {
      return '剑刺';
    }
    
    if (templateId === 'starving' || name.includes('饥民')) {
      return '棍击';
    }
    
    // 默认攻击方式
    return '攻击';
  }

  /**
   * 计算伤害
   * @param {Entity} attacker - 攻击者
   * @param {Entity} target - 目标
   * @param {number} skillElementType - 技能元素类型（可选，默认为攻击者主元素）
   * @returns {number} 伤害值
   */
  calculateDamage(attacker, target, skillElementType = null) {
    const attackerStats = attacker.getComponent('stats');
    const targetStats = target.getComponent('stats');
    
    if (!attackerStats || !targetStats) return 0;
    
    // 获取修改后的属性（考虑状态效果）
    let attack = attackerStats.attack;
    let defense = targetStats.defense;
    
    if (this.statusEffectSystem) {
      const modifiedAttackerStats = this.statusEffectSystem.getModifiedStats(attacker);
      const modifiedTargetStats = this.statusEffectSystem.getModifiedStats(target);
      attack = modifiedAttackerStats.attack;
      defense = modifiedTargetStats.defense;
    }
    
    // 委托 CombatResolver 做权威结算（§13 约定5：伤害逻辑集中于 Resolver）
    // 兵种/元素相克通过闭包注入真实 stats（保持与旧逻辑等价）；
    // 单机 rng=null → Resolver 内部用 Math.random（与旧行为统计等价）；联网时注入种子 RNG。
    const result = CombatResolver.resolveAttack({
      attacker: {
        attack,
        element: skillElementType !== null ? skillElementType : attackerStats.getMainElement(),
        moraleMultiplier: attackerStats.moraleMultiplier || 1
      },
      target: {
        defense,
        hp: targetStats.hp,
        moraleMultiplier: targetStats.moraleMultiplier || 1
      },
      skill: skillElementType !== null ? { element: skillElementType } : null
    }, {
      rng: this.combatRng || null,
      unitCalc: this.unitSystem
        ? (a, t, dmg) => this.unitSystem.calculateUnitDamage(attackerStats, targetStats, dmg)
        : null,
      elementCalc: this.elementSystem
        ? (a, t, el, dmg) => this.elementSystem.calculateElementDamage(attackerStats, targetStats, el, dmg)
        : null
    });
    return result.damage;
  }

  /**
   * 应用伤害
   * @param {Entity} target - 目标
   * @param {number} damage - 伤害值
   * @param {Object} knockbackDir - 击退方向（可选）{x, y}
   * @param {string} damageType - 伤害类型（可选），如"刺击"、"扫击"、"火焰掌"等
   * @param {Object} context - 可选来源上下文 { sourceEntity }
   */
  applyDamage(target, damage, knockbackDir = null, damageType = null, context = {}) {
    const stats = target.getComponent('stats');
    const transform = target.getComponent('transform');

    if (!stats) return null;

    const sourceEntity = context.sourceEntity
      || (target !== this.playerEntity ? this.playerEntity : null);
    const requestedDamage = this._filterEffectAmount('damage', sourceEntity, target, damage);
    const hpBefore = Number(stats.hp) || 0;
    const wasDead = hpBefore <= 0;
    stats.takeDamage(requestedDamage);
    const hpAfter = Number(stats.hp) || 0;
    const appliedDamage = Math.max(0, hpBefore - hpAfter);
    const isDead = hpAfter <= 0;
    const damageEvent = {
      target,
      sourceEntity,
      sourceEntityId: sourceEntity?.id || null,
      attackKind: context.attackKind || 'unknown',
      requestedDamage,
      appliedDamage,
      damageType,
      hpBefore,
      hpAfter,
      isDead
    };
    let finalized = false;

    const finalize = () => {
      if (finalized) return false;
      finalized = true;
      if (appliedDamage > 0) {
        if (this.onDamageCallback) {
          try { this.onDamageCallback(damageEvent); }
          catch (error) { console.warn('CombatSystem: 受伤回调执行失败', error); }
        }
        for (const listener of [...this._damageListeners]) {
          try { listener(damageEvent); }
          catch (error) { console.warn('CombatSystem: 受伤监听器执行失败', error); }
        }
      }
      if (transform) this.showDamageNumber(transform.position, appliedDamage, damageType);
      const sprite = target.getComponent('sprite');
      if (sprite && appliedDamage > 0) this.playHitEffect(target);
      if (!wasDead && isDead && context.deferDeathEffects !== true) {
        if (target.type === 'player') this.handleDeath(target, damageEvent);
        else {
          this.spawnLoot(target);
          this._retainCorpse(target);
          this.triggerDeathEffect(target);
        }
      }
      return true;
    };

    const rollback = () => {
      if (finalized || Number(stats.hp) !== hpAfter) return false;
      stats.hp = hpBefore;
      return true;
    };

    if (context.deferPresentationEffects !== true) finalize();
    return {
      ...damageEvent,
      ...(context.deferPresentationEffects === true ? { finalize, rollback } : {})
    };
  }
  
  /**
   * 应用击退效果
   * @param {Entity} target - 目标
   * @param {Object} direction - 击退方向 {x, y}（已归一化）
   */
  applyKnockback(target, direction) {
    const transform = target.getComponent('transform');
    if (!transform) return;
    
    // 击退距离（像素）
    const knockbackDistance = 20;
    
    // 应用击退
    transform.position.x += direction.x * knockbackDistance;
    transform.position.y += direction.y * knockbackDistance;
    
    // 创建击退粒子效果
    if (this.skillEffects && this.skillEffects.particleSystem) {
      const particleSystem = this.skillEffects.particleSystem;
      
      // 在目标位置创建冲击波粒子
      for (let i = 0; i < 5; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 50 + Math.random() * 50;
        
        particleSystem.emit({
          position: { x: transform.position.x, y: transform.position.y },
          velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
          life: 0.3,
          size: 3 + Math.random() * 3,
          color: '#ffaa00',
          alpha: 0.8
        });
      }
    }
  }
  
  /**
   * 触发死亡特效
   * @param {Entity} target - 目标
   */
  triggerDeathEffect(target) {
    const transform = target.getComponent('transform');
    if (!transform) return;
    
    // 立即标记为正在死亡，停止AI行为
    target.isDying = true;

    // 通知击杀（数据驱动 kill 事件源 / 任务计数）
    this._notifyKill(target);

    // 随机选择死亡特效类型
    const effectType = Math.random() < 0.5 ? 'explode' : 'slice';
    
    if (effectType === 'explode') {
      // 爆炸特效
      this.createExplosionEffect(transform.position);
    } else {
      // 切割特效
      this.createSliceEffect(transform.position);
    }
    
    // 延迟很短时间后标记为已死亡（让特效播放）
    setTimeout(() => {
      target.isDead = true;
    }, 100);
  }
  
  /**
   * 创建爆炸特效
   * @param {Object} position - 位置 {x, y}
   */
  createExplosionEffect(position) {
    if (!this.skillEffects || !this.skillEffects.particleSystem) return;
    
    const particleSystem = this.skillEffects.particleSystem;
    
    // 爆炸粒子
    for (let i = 0; i < 30; i++) {
      const angle = (i / 30) * Math.PI * 2;
      const speed = 100 + Math.random() * 100;
      
      particleSystem.emit({
        position: { x: position.x, y: position.y },
        velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        life: 0.5 + Math.random() * 0.3,
        size: 4 + Math.random() * 4,
        color: Math.random() < 0.5 ? '#ff4444' : '#ffaa00',
        alpha: 1.0,
        gravity: 200
      });
    }
    
    // 中心闪光
    for (let i = 0; i < 10; i++) {
      particleSystem.emit({
        position: { x: position.x, y: position.y },
        velocity: { x: (Math.random() - 0.5) * 50, y: (Math.random() - 0.5) * 50 },
        life: 0.3,
        size: 8 + Math.random() * 8,
        color: '#ffffff',
        alpha: 1.0
      });
    }
  }
  
  /**
   * 创建切割特效
   * @param {Object} position - 位置 {x, y}
   */
  createSliceEffect(position) {
    if (!this.skillEffects || !this.skillEffects.particleSystem) return;
    
    const particleSystem = this.skillEffects.particleSystem;
    
    // 随机切割角度
    const sliceAngle = Math.random() * Math.PI * 2;
    
    // 创建2-3块碎片
    const numPieces = 2 + Math.floor(Math.random() * 2); // 2或3块
    
    for (let i = 0; i < numPieces; i++) {
      // 碎片飞出方向（垂直于切割线）
      const pieceAngle = sliceAngle + (i - numPieces / 2) * 0.5;
      const speed = 80 + Math.random() * 60;
      
      // 创建多个粒子组成一块碎片
      for (let j = 0; j < 8; j++) {
        const offsetAngle = pieceAngle + (Math.random() - 0.5) * 0.3;
        const offsetSpeed = speed + (Math.random() - 0.5) * 40;
        
        particleSystem.emit({
          position: { 
            x: position.x + (Math.random() - 0.5) * 10,
            y: position.y + (Math.random() - 0.5) * 10
          },
          velocity: { 
            x: Math.cos(offsetAngle) * offsetSpeed,
            y: Math.sin(offsetAngle) * offsetSpeed
          },
          life: 0.6 + Math.random() * 0.3,
          size: 5 + Math.random() * 5,
          color: '#ff4444',
          alpha: 1.0,
          gravity: 250,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 10
        });
      }
    }
    
    // 血液飞溅效果
    for (let i = 0; i < 15; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 80;
      
      particleSystem.emit({
        position: { x: position.x, y: position.y },
        velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        life: 0.4 + Math.random() * 0.2,
        size: 2 + Math.random() * 3,
        color: '#aa0000',
        alpha: 0.8,
        gravity: 300
      });
    }
  }

  /**
   * 显示伤害数字
   * @param {Object} position - 位置 {x, y}
   * @param {number} damage - 伤害值
   * @param {string} damageType - 伤害类型（可选）
   */
  showDamageNumber(position, damage, damageType = null) {
    const currentTime = this.now();
    const shouldLog = this._lastDamageNumberCreateLog == null
      || currentTime - this._lastDamageNumberCreateLog > 1000;
    // 调试日志保留，但高频群战时最多每秒输出一组。
    if (shouldLog) {
      console.log(`[showDamageNumber] 位置: (${position?.x?.toFixed(0)}, ${position?.y?.toFixed(0)}), 伤害: ${damage}, 类型: ${damageType}`);
      this._lastDamageNumberCreateLog = currentTime;
    }

    // 武器碰撞的伤害数字显示在更高的位置，避免重叠
    const isWeaponCollision = typeof damageType === 'string'
      && damageType.startsWith('武器碰撞');
    const yOffset = isWeaponCollision ? -50 : -20;

    const damageNumber = {
      x: position.x,
      y: position.y + yOffset, // 从实体上方开始
      damage: damage,
      damageType: damageType, // 添加伤害类型
      life: 2.0, // 生命周期（秒）
      maxLife: 3.0,
      velocity: { x: (Math.random() - 0.5) * 20, y: -50 } // 向上飘动
    };

    this.damageNumbers.push(damageNumber);
    if (shouldLog) console.log(`[showDamageNumber] damageNumbers数组长度: ${this.damageNumbers.length}`);
  }

  /**
   * 更新伤害数字
   * @param {number} deltaTime - 帧间隔时间（秒）
   */
  updateDamageNumbers(deltaTime) {
    // 更新所有伤害数字
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const dn = this.damageNumbers[i];
      
      // 更新位置
      dn.x += dn.velocity.x * deltaTime;
      dn.y += dn.velocity.y * deltaTime;
      
      // 减速
      dn.velocity.y += 100 * deltaTime; // 重力效果
      
      // 减少生命周期
      dn.life -= deltaTime;
      
      // 移除过期的伤害数字
      if (dn.life <= 0) {
        this.damageNumbers.splice(i, 1);
      }
    }
  }

  /**
   * 播放受击效果
   * @param {Entity} target - 目标
   */
  playHitEffect(target) {
    const sprite = target.getComponent('sprite');
    if (!sprite) return;
    
    // 简单的闪烁效果
    sprite.flash = true;
    sprite.flashTime = 0.2; // 闪烁持续时间
    
    setTimeout(() => {
      if (sprite) {
        sprite.flash = false;
      }
    }, 200);
  }

  /**
   * 加载角色技能
   * @param {Entity} entity - 实体
   * @param {Array<string>} skillIds - 技能ID列表
   */
  loadSkills(entity, skillIds) {
    if (!this.dataService) {
      console.warn('CombatSystem: No data service provided, cannot load skills');
      return;
    }
    
    const combat = entity.getComponent('combat');
    if (!combat) return;
    
    // 清空现有技能
    combat.skills = [];
    combat.skillCooldowns.clear();
    
    // 加载技能数据
    for (const skillId of skillIds) {
      const skillData = this.dataService.getSkillData(skillId);
      if (skillData) {
        combat.addSkill(skillData);
      }
    }
    
    console.log(`CombatSystem: Loaded ${combat.skills.length} skills for ${entity.name || entity.id}`);
  }

  /**
   * 处理技能输入
   * @param {number} currentTime - 当前时间（毫秒）
   * @param {Array<Entity>} entities - 实体列表
   */
  handleSkillInput(currentTime, entities) {
    if (!this.inputManager || !this.playerEntity || this.isPlayerInputLocked()) return;
    
    const combat = this.playerEntity.getComponent('combat');
    if (!combat) return;
    
    // 检查药水快捷键
    for (const [key, potionType] of Object.entries(this.potionKeyMap)) {
      if (this.inputManager.isKeyPressed(key)) {
        if (this.onPotionUse) {
          this.onPotionUse(potionType);
        }
      }
    }
    
    // 检查技能快捷键
    for (const [key, index] of Object.entries(this.skillKeyMap)) {
      if (this.inputManager.isKeyPressed(key)) {
        // 获取对应的技能
        if (index < combat.skills.length) {
          const skill = combat.skills[index];
          
          // 技能1（普通攻击）：使用武器攻击
          if (skill.id === 'basic_attack' || skill.isAutoAttack) {
            // 需要选中目标
            if (this.selectedTarget) {
              this.tryUseWeaponAttack(this.playerEntity, skill, currentTime, entities);
            } else {
              console.log('普通攻击需要选择目标');
            }
          } 
          // 特殊处理：治疗技能（对自己释放）
          else if (skill.id === 'heal') {
            const casterTransform = this.playerEntity.getComponent('transform');
            if (casterTransform) {
              this.tryUseSkillAtPosition(this.playerEntity, skill, casterTransform.position, currentTime, entities);
            }
          }
          // 特殊处理：打坐技能（通过场景回调处理）
          else if (skill.id === 'meditation') {
            // 打坐技能需要通过场景的onSkillClicked回调处理
            // 因为它涉及到场景的meditationState状态管理
            if (this.onMeditationSkill) {
              this.onMeditationSkill(skill);
            } else {
              console.log('打坐技能需要场景支持');
            }
          }
          else {
            // 其他技能：如果场景有瞄准模式支持（PC），则委托场景处理
            // 否则直接使用鼠标位置释放
            if (this.onSkillAimRequest) {
              this.onSkillAimRequest(index);
            } else {
              const mouseWorldPos = this.inputManager.getMouseWorldPosition(this.camera);
              this.tryUseSkillAtPosition(this.playerEntity, skill, mouseWorldPos, currentTime, entities);
            }
          }
        }
      }
    }
  }

  /**
   * 尝试使用武器攻击
   * @param {Entity} caster - 施法者
   * @param {Object} skill - 技能数据
   * @param {number} currentTime - 当前时间（毫秒）
   * @param {Array<Entity>} entities - 实体列表
   * @returns {boolean} 是否成功使用
   */
  tryUseWeaponAttack(caster, skill, currentTime, entities) {
    const combat = caster.getComponent('combat');
    const stats = caster.getComponent('stats');
    const casterTransform = caster.getComponent('transform');
    
    if (!combat || !stats || !casterTransform) return false;
    
    // 检查冷却
    if (!combat.canUseSkill(skill.id, currentTime)) {
      console.log(`技能 ${skill.name} 冷却中`);
      return false;
    }
    
    // 获取攻击范围（从武器渲染器）
    const attackRange = this.weaponRenderer ? this.weaponRenderer.getAttackRange(caster) : 150;
    
    // 获取攻击范围内的所有敌人
    const enemiesInRange = this.weaponRenderer ? 
      this.weaponRenderer.getEnemiesInRange(casterTransform.position, entities, attackRange) : [];
    
    if (enemiesInRange.length === 0) {
      console.log('攻击范围内没有敌人');
      return false;
    }
    
    // 获取鼠标移动速度
    let speedKmh = 0;
    let isLowSpeed = false;
    if (this.weaponRenderer) {
      speedKmh = this.weaponRenderer.mouseMovement.speedKmh;
      // 标记低速攻击（< 10 km/h）
      isLowSpeed = speedKmh < 10;
    }
    
    // 使用技能
    const usedSkill = combat.useSkill(skill.id, currentTime);
    if (!usedSkill) return false;
    
    // 触发武器攻击动画
    if (this.weaponRenderer) {
      this.weaponRenderer.startAttack();
    }
    
    // 对范围内的所有敌人造成伤害
    for (const enemy of enemiesInRange) {
      let finalDamage;
      
      if (isLowSpeed) {
        // 低速攻击（< 10 km/h）：伤害为0-5随机值
        finalDamage = Math.floor(Math.random() * 6); // 0-5
        console.log(`低速攻击 (${speedKmh.toFixed(1)} km/h)，伤害: ${finalDamage}`);
      } else {
        // 正常速度攻击（≥10 km/h）：计算正常伤害
        // 获取滑动伤害倍率
        const damageMultiplier = this.weaponRenderer ? this.weaponRenderer.getSwipeDamageMultiplier() : 1.0;
        
        // 计算基础伤害
        let baseDamage = this.calculateSkillDamage(caster, enemy, skill);
        
        // 应用滑动倍率
        finalDamage = Math.floor(baseDamage * damageMultiplier);
      }
      
      // 应用伤害和击退效果
      const enemyTransform = enemy.getComponent('transform');
      if (enemyTransform) {
        // 计算击退方向
        const dx = enemyTransform.position.x - casterTransform.position.x;
        const dy = enemyTransform.position.y - casterTransform.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > 0) {
          const knockbackDir = {
            x: dx / distance,
            y: dy / distance
          };
          
          // 应用伤害和击退
          this.applyDamage(enemy, finalDamage, knockbackDir);
        } else {
          this.applyDamage(enemy, finalDamage);
        }
      } else {
        this.applyDamage(enemy, finalDamage);
      }
      
      // 创建攻击特效
      if (this.skillEffects && enemyTransform) {
        this.skillEffects.createSkillEffect('basic_attack', casterTransform.position, enemyTransform.position);
      }
    }
    
    // 显示攻击信息
    if (isLowSpeed) {
      console.log(`${caster.name || caster.id} 低速攻击，命中 ${enemiesInRange.length} 个敌人，速度: ${speedKmh.toFixed(1)} km/h`);
    } else {
      const damageMultiplier = this.weaponRenderer ? this.weaponRenderer.getSwipeDamageMultiplier() : 1.0;
      console.log(`${caster.name || caster.id} 使用武器攻击，命中 ${enemiesInRange.length} 个敌人，伤害倍率: ${damageMultiplier.toFixed(2)}x`);
    }
    
    return true;
  }

  /**
   * 尝试使用技能（针对单个目标）
   * @param {Entity} caster - 施法者
   * @param {Object} skill - 技能数据
   * @param {number} currentTime - 当前时间（毫秒）
   * @param {Array<Entity>} entities - 实体列表
   * @returns {boolean} 是否成功使用
   */
  tryUseSkill(caster, skill, currentTime, entities) {
    const combat = caster.getComponent('combat');
    const stats = caster.getComponent('stats');
    
    if (!combat || !stats) return false;
    
    // 检查冷却
    if (!combat.canUseSkill(skill.id, currentTime)) {
      console.log(`技能 ${skill.name} 冷却中`);
      return false;
    }
    
    // 检查魔法值
    if (stats.mp < skill.manaCost) {
      console.log(`魔法值不足，需要 ${skill.manaCost}，当前 ${stats.mp}`);
      return false;
    }
    
    // 检查目标（如果需要目标）
    let target = combat.target;
    if (skill.range > 0 && !target) {
      console.log(`技能 ${skill.name} 需要目标`);
      return false;
    }
    
    // 检查范围（如果有目标）
    if (target && skill.range > 0) {
      if (!this.isInRange(caster, target, skill.range)) {
        console.log(`目标超出技能范围`);
        return false;
      }
    }
    
    // 使用技能
    const usedSkill = combat.useSkill(skill.id, currentTime);
    if (!usedSkill) return false;
    
    // 消耗魔法值
    stats.consumeMana(skill.manaCost);
    
    // 应用技能效果
    this.applySkillEffects(caster, target, skill, currentTime);
    
    console.log(`${caster.name || caster.id} 使用技能 ${skill.name}`);
    return true;
  }

  /**
   * 尝试在指定位置使用技能（AOE技能）
   * @param {Entity} caster - 施法者
   * @param {Object} skill - 技能数据
   * @param {Object} targetPos - 目标位置 {x, y}
   * @param {number} currentTime - 当前时间（毫秒）
   * @param {Array<Entity>} entities - 实体列表
   * @returns {boolean} 是否成功使用
   */
  tryUseSkillAtPosition(caster, skill, targetPos, currentTime, entities) {
    const combat = caster.getComponent('combat');
    const stats = caster.getComponent('stats');
    const casterTransform = caster.getComponent('transform');
    
    if (!combat || !stats || !casterTransform) return false;
    
    // 检查冷却
    if (!combat.canUseSkill(skill.id, currentTime)) {
      console.log(`技能 ${skill.name} 冷却中`);
      return false;
    }
    
    // 检查魔法值
    if (stats.mp < skill.manaCost) {
      console.log(`魔法值不足，需要 ${skill.manaCost}，当前 ${stats.mp}`);
      return false;
    }
    
    // 检查距离（施法者到目标位置的距离）- range为0表示自身技能，跳过距离检查
    if (skill.range > 0) {
      const dx = targetPos.x - casterTransform.position.x;
      const dy = targetPos.y - casterTransform.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > skill.range) {
        console.log(`目标位置超出技能范围`);
        return false;
      }
    }
    
    // 使用技能
    const usedSkill = combat.useSkill(skill.id, currentTime);
    if (!usedSkill) return false;
    
    // 消耗魔法值
    stats.consumeMana(skill.manaCost);
    
    // 显示技能名称（在玩家头顶）
    if (this.floatingTextManager && caster.type === 'player') {
      this.floatingTextManager.addText(
        casterTransform.position.x,
        casterTransform.position.y - 50,
        skill.name,
        '#ffff00'
      );
    }
    
    // 应用AOE技能效果
    this.applyAOESkillEffects(caster, targetPos, skill, currentTime, entities);
    
    // 创建技能影响范围指示器（在技能落点处显示）
    if (caster.type === 'player') {
      this.addSkillRangeIndicator(casterTransform.position, targetPos, skill);
    }
    
    console.log(`${caster.name || caster.id} 在位置 (${Math.floor(targetPos.x)}, ${Math.floor(targetPos.y)}) 使用技能 ${skill.name}`);
    return true;
  }

  /**
   * AbilitySystem 执行器入口（S2 拆分）。
   *
   * 准入判定、消耗扣除、冷却与施法状态由 AbilitySystem 负责；
   * 本方法只负责表现与伤害结算，因此不再重复检查冷却与魔法值。
   *
   * @param {Object} context - AbilitySystem 传入的执行上下文
   * @param {Entity} context.caster - 施法者
   * @param {SkillDefinition} context.definition - 技能定义
   * @param {Object} context.params - 已被 skill.modify 效果解析后的运行期参数
   * @param {Entity|null} context.target - 目标实体
   * @param {Object|null} context.targetPosition - 目标位置
   * @param {Array<Entity>} context.entities - 实体列表
   * @param {number} context.currentTime - 当前时间（毫秒）
   * @returns {boolean} 是否执行成功
   */
  executeSkill(context) {
    const { caster, definition, params, target, targetPosition, entities, currentTime } = context || {};
    if (!caster || !definition) return false;

    // view 为形态解析后的运行期视图；无形态时退回基础定义
    const view = (context && context.view) || definition;

    const casterTransform = caster.getComponent('transform');
    if (!casterTransform) return false;

    // 把定义与运行期参数还原为执行层使用的技能对象，复用现有表现与结算逻辑
    const skill = {
      id: view.id || definition.id,
      name: view.name || definition.name,
      type: view.category || definition.category,
      ...params
    };
    if (view.vfx) Object.assign(skill, view.vfx);

    // 显示技能名称（在玩家头顶）
    if (this.floatingTextManager && caster.type === 'player') {
      this.floatingTextManager.addText(
        casterTransform.position.x,
        casterTransform.position.y - 50,
        skill.name,
        '#ffff00'
      );
    }

    const pos = targetPosition || (target && target.getComponent('transform')
      ? target.getComponent('transform').position
      : null);

    const targeting = view.targeting || definition.targeting;
    if (pos && (targeting === 'area' || targeting === 'position' || targeting === 'direction')) {
      this.applyAOESkillEffects(caster, pos, skill, currentTime, entities || []);
      if (caster.type === 'player') {
        this.addSkillRangeIndicator(casterTransform.position, pos, skill);
      }
      return true;
    }

    this.applySkillEffects(caster, target || null, skill, currentTime);
    return true;
  }

  /**
   * 应用技能效果（单目标）
   * @param {Entity} caster - 施法者
   * @param {Entity} target - 目标
   * @param {Object} skill - 技能数据
   * @param {number} currentTime - 当前时间（毫秒）
   */
  applySkillEffects(caster, target, skill, currentTime) {
    const sprite = caster.getComponent('sprite');
    const casterTransform = caster.getComponent('transform');
    const targetTransform = target ? target.getComponent('transform') : null;
    
    // 播放技能动画
    if (sprite && skill.animation) {
      sprite.playAnimation(skill.animation);
      
      // 技能动画结束后恢复待机动画
      setTimeout(() => {
        if (sprite.currentAnimation === skill.animation) {
          sprite.playAnimation('idle');
        }
      }, skill.castTime * 1000 || 500);
    }
    
    // 特殊技能处理：冲锋
    if (skill.id === 'warrior_charge' && target && targetTransform) {
      // 冲锋技能：快速移动到目标附近
      const casterMovement = caster.getComponent('movement');
      if (casterMovement) {
        // 计算目标附近的位置（保持攻击范围）
        const dx = targetTransform.position.x - casterTransform.position.x;
        const dy = targetTransform.position.y - casterTransform.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > 0) {
          // 移动到目标前方（保持40像素距离）
          const targetDistance = 40;
          const ratio = (distance - targetDistance) / distance;
          const chargeX = casterTransform.position.x + dx * ratio;
          const chargeY = casterTransform.position.y + dy * ratio;
          
          // 立即移动到目标位置
          casterTransform.setPosition(chargeX, chargeY);
        }
      }
      
      // 创建冲锋特效
      if (this.skillEffects) {
        this.skillEffects.createSkillEffect(skill.id, casterTransform.position, targetTransform.position);
      }
      
      // 应用伤害（传入技能名称作为伤害类型）
      const damage = this.calculateSkillDamage(caster, target, skill);
      this.applyDamage(target, damage, null, skill.name, {
        sourceEntity: caster,
        attackKind: 'skill-melee'
      });
      return;
    }
    
    // 创建技能特效
    if (this.skillEffects && casterTransform) {
      const targetPos = targetTransform ? targetTransform.position : null;
      
      // 对于抛射物技能，延迟应用伤害直到命中
      if (skill.type === 'physical' || skill.type === 'magic') {
        if (skill.range > 100 && target) {
          // 远程技能，使用抛射物
          this.skillEffects.createSkillEffect(
            skill.id,
            casterTransform.position,
            targetPos,
            () => {
              // 命中回调（传入技能名称）
              const damage = this.calculateSkillDamage(caster, target, skill);
              this.applyDamage(target, damage, null, skill.name, {
                sourceEntity: caster,
                attackKind: 'skill-ranged'
              });
            }
          );
          return; // 伤害将在命中时应用
        } else {
          // 近战技能，立即创建特效
          this.skillEffects.createSkillEffect(skill.id, casterTransform.position, targetPos);
        }
      } else {
        // 非伤害技能
        this.skillEffects.createSkillEffect(skill.id, casterTransform.position, targetPos);
      }
    }
    
    // 根据技能类型应用效果
    if (skill.type === 'physical' || skill.type === 'magic') {
      // 伤害技能（近战或没有特效系统）（传入技能名称）
      if (target && skill.range <= 100) {
        const damage = this.calculateSkillDamage(caster, target, skill);
        this.applyDamage(target, damage, null, skill.name, {
          sourceEntity: caster,
          attackKind: 'skill-melee'
        });
      }
    } else if (skill.type === 'heal') {
      // 治疗技能
      const healTarget = target || caster; // 如果没有目标，治疗自己
      this.applyHeal(healTarget, skill, caster);
    } else if (skill.type === 'buff') {
      // Buff技能
      this.applyBuff(caster, skill);
    }
    
    // 应用额外效果
    if (skill.effects && skill.effects.length > 0) {
      for (const effect of skill.effects) {
        this.applyEffect(caster, target, effect);
      }
    }
  }

  /**
   * 应用AOE技能效果
   * @param {Entity} caster - 施法者
   * @param {Object} targetPos - 目标位置 {x, y}
   * @param {Object} skill - 技能数据
   * @param {number} currentTime - 当前时间（毫秒）
   * @param {Array<Entity>} entities - 实体列表
   */
  applyAOESkillEffects(caster, targetPos, skill, currentTime, entities) {
    const sprite = caster.getComponent('sprite');
    const casterTransform = caster.getComponent('transform');
    
    // 播放技能动画
    if (sprite && skill.animation) {
      sprite.playAnimation(skill.animation);
      
      setTimeout(() => {
        if (sprite.currentAnimation === skill.animation) {
          sprite.playAnimation('idle');
        }
      }, skill.castTime * 1000 || 500);
    }
    
    // 治疗类技能统一治疗施法者及半径内非敌对实体，不依赖具体技能 ID。
    if (skill.type === 'heal' || skill.id === 'heal') {
      const radius = Math.max(0, Number(skill.aoeRadius ?? skill.radius) || 0);
      const recipients = [caster];
      for (const entity of entities || []) {
        if (!entity || entity === caster || entity.type === 'enemy' || entity.faction === 'enemy') continue;
        const transform = entity.getComponent?.('transform');
        if (!transform || !casterTransform) continue;
        const distance = Math.hypot(
          transform.position.x - casterTransform.position.x,
          transform.position.y - casterTransform.position.y
        );
        if (distance <= radius) recipients.push(entity);
      }
      for (const recipient of recipients) {
        if (!recipient.getComponent?.('stats')) continue;
        this.applyHeal(recipient, { healAmount: Number(skill.healAmount) || 0 }, caster);
      }
      if (this.skillEffects && casterTransform) {
        this.skillEffects.createSkillEffect('strategist_talisman_water', casterTransform.position);
      }
      return;
    }
    
    // 特殊处理：寒冰指（路径伤害）
    if (skill.id === 'ice_finger') {
      this.applyLinearPathDamage(caster, targetPos, skill, entities);
      return;
    }
    
    // 特殊处理：火焰掌（主伤害 + 溅射）
    if (skill.id === 'flame_palm') {
      this.applyFlamePalmDamage(caster, targetPos, skill, entities);
      return;
    }
    
    // 创建技能特效（抛射物飞向目标位置）
    if (this.skillEffects && casterTransform) {
      // 拷贝施法者位置，避免飞行期间玩家移动导致方向变化
      const castPos = { x: casterTransform.position.x, y: casterTransform.position.y };
      // 如果有抛射物速度，创建飞行特效
      if (skill.projectileSpeed && skill.projectileSpeed > 0) {
        this.skillEffects.createSkillEffect(
          skill.id,
          castPos,
          targetPos,
          () => {
            // 命中回调：对范围内所有敌人造成伤害
            this.applyAOEDamage(caster, targetPos, skill, entities);
          }
        );
      } else {
        // 立即生效的AOE技能
        this.skillEffects.createSkillEffect(skill.id, castPos, targetPos);
        this.applyAOEDamage(caster, targetPos, skill, entities);
      }
    } else {
      // 没有特效系统，直接应用伤害
      this.applyAOEDamage(caster, targetPos, skill, entities);
    }
  }
  
  /**
   * 应用直线路径伤害（路径 + 终点）- 用于寒冰指等技能
   * @param {Entity} caster - 施法者
   * @param {Object} targetPos - 目标位置
   * @param {Object} skill - 技能数据
   * @param {Array<Entity>} entities - 实体列表
   */
  applyLinearPathDamage(caster, targetPos, skill, entities) {
    const casterTransform = caster.getComponent('transform');
    if (!casterTransform) return;
    
    // 创建特效
    if (this.skillEffects) {
      this.skillEffects.createSkillEffect(
        skill.id,
        casterTransform.position,
        targetPos,
        () => {
          // 终点伤害
          this.applyAOEDamage(caster, targetPos, {
            ...skill,
            damageMin: skill.finalDamageMin,
            damageMax: skill.finalDamageMax,
            aoeRadius: 50
          }, entities);
        }
      );
    }
    
    // 路径伤害检测
    const dx = targetPos.x - casterTransform.position.x;
    const dy = targetPos.y - casterTransform.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // 防止除以零
    if (distance < 1) return;
    
    const dirX = dx / distance;
    const dirY = dy / distance;
    
    // 检测路径上的敌人
    const pathWidth = 30; // 路径宽度
    const enemies = entities.filter(e => e.type === 'enemy' && !e.isDead && !e.isDying);
    
    for (const enemy of enemies) {
      const enemyTransform = enemy.getComponent('transform');
      if (!enemyTransform) continue;
      
      // 计算敌人到路径的距离
      const ex = enemyTransform.position.x - casterTransform.position.x;
      const ey = enemyTransform.position.y - casterTransform.position.y;
      
      // 投影到路径方向
      const projection = ex * dirX + ey * dirY;
      
      // 如果投影在路径范围内
      if (projection >= 0 && projection <= distance) {
        // 计算垂直距离
        const perpX = ex - projection * dirX;
        const perpY = ey - projection * dirY;
        const perpDist = Math.sqrt(perpX * perpX + perpY * perpY);
        
        // 如果在路径宽度内，造成路径伤害（传入技能名称+路径标记）
        if (perpDist <= pathWidth) {
          const pathDamage = Math.floor(Math.random() * (skill.damageMax - skill.damageMin + 1)) + skill.damageMin;
          this.applyDamage(enemy, pathDamage, null, `${skill.name}[路径]`);
        }
      }
    }
  }
  
  /**
   * 应用火焰掌伤害（主伤害 + 溅射）
   * @param {Entity} caster - 施法者
   * @param {Object} targetPos - 目标位置
   * @param {Object} skill - 技能数据
   * @param {Array<Entity>} entities - 实体列表
   */
  applyFlamePalmDamage(caster, targetPos, skill, entities) {
    const casterTransform = caster.getComponent('transform');
    if (!casterTransform) return;
    
    // 拷贝施法者位置，避免飞行期间玩家移动导致方向变化
    const castPos = { x: casterTransform.position.x, y: casterTransform.position.y };
    
    // 创建特效
    if (this.skillEffects) {
      this.skillEffects.createSkillEffect(
        skill.id,
        castPos,
        targetPos,
        () => {
          // 主火焰伤害
          this.applyAOEDamage(caster, targetPos, skill, entities);
          
          // 溅射小火焰伤害
          const splashRadius = 80;
          const enemies = entities.filter(e => {
            if (e.type !== 'enemy' || e.isDead || e.isDying) return false;
            
            const transform = e.getComponent('transform');
            if (!transform) return false;
            
            const dx = transform.position.x - targetPos.x;
            const dy = transform.position.y - targetPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            return distance <= splashRadius;
          });
          
          // 对每个敌人造成溅射伤害（传入技能名称+溅射标记）
          for (const enemy of enemies) {
            const splashDamage = Math.floor(
              Math.random() * (skill.splashDamageMax - skill.splashDamageMin + 1)
            ) + skill.splashDamageMin;
            
            this.applyDamage(enemy, splashDamage, null, `${skill.name}[溅射]`);
          }
        }
      );
    }
  }

  /**
   * 应用AOE伤害
   * @param {Entity} caster - 施法者
   * @param {Object} centerPos - 中心位置 {x, y}
   * @param {Object} skill - 技能数据
   * @param {Array<Entity>} entities - 实体列表
   */
  applyAOEDamage(caster, centerPos, skill, entities) {
    // AOE 范围优先消费 canonical radius；旧内容仍可使用 aoeRadius。
    const configuredRadius = Number(skill.aoeRadius ?? skill.radius);
    const aoeRadius = Number.isFinite(configuredRadius) && configuredRadius >= 0
      ? configuredRadius
      : 150;
    
    // 查找范围内的所有敌人
    const enemies = entities.filter(e => {
      // 只对敌人造成伤害
      if (e.type !== 'enemy') return false;
      if (e.isDead || e.isDying) return false;
      
      const transform = e.getComponent('transform');
      if (!transform) return false;
      
      // 计算距离
      const dx = transform.position.x - centerPos.x;
      const dy = transform.position.y - centerPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      return distance <= aoeRadius;
    });
    
    console.log(`AOE技能 ${skill.name} 命中 ${enemies.length} 个敌人`);
    
    // 对每个敌人造成伤害（传入技能名称）
    for (const enemy of enemies) {
      const damage = this.calculateSkillDamage(caster, enemy, skill);
      this.applyDamage(enemy, damage, null, skill.name);
    }
  }

  /**
   * 计算技能伤害
   * @param {Entity} caster - 施法者
   * @param {Entity} target - 目标
   * @param {Object} skill - 技能数据
   * @returns {number} 伤害值
   */
  calculateSkillDamage(caster, target, skill) {
    const casterStats = caster.getComponent('stats');
    const targetStats = target.getComponent('stats');
    
    if (!casterStats || !targetStats) return 0;
    
    // 获取修改后的属性（考虑状态效果）
    let attack = casterStats.attack;
    let defense = targetStats.defense;
    
    if (this.statusEffectSystem) {
      const modifiedCasterStats = this.statusEffectSystem.getModifiedStats(caster);
      const modifiedTargetStats = this.statusEffectSystem.getModifiedStats(target);
      attack = modifiedCasterStats.attack;
      defense = modifiedTargetStats.defense;
    }
    
    // 委托 CombatResolver.resolveSkillAttack 做权威结算（§13 约定5）
    // damageMin/damageMax 定值随机、attack×倍率、physical 减防、min 1 等逻辑均在 Resolver 内镜像。
    const result = CombatResolver.resolveSkillAttack({
      caster: {
        attack,
        element: casterStats.getMainElement(),
        moraleMultiplier: casterStats.moraleMultiplier || 1
      },
      target: {
        defense,
        hp: targetStats.hp,
        moraleMultiplier: targetStats.moraleMultiplier || 1
      },
      skill
    }, {
      rng: this.combatRng || null,
      unitCalc: this.unitSystem
        ? (a, t, dmg) => this.unitSystem.calculateUnitDamage(casterStats, targetStats, dmg)
        : null,
      elementCalc: this.elementSystem
        ? (a, t, el, dmg) => this.elementSystem.calculateElementDamage(casterStats, targetStats, el, dmg)
        : null
    });
    return result.damage;
  }

  /**
   * 应用治疗
   * @param {Entity} target - 目标
   * @param {Object} skill - 技能数据
   * @param {Entity} sourceEntity - 治疗来源（可选）
   */
  applyHeal(target, skill, sourceEntity = null) {
    const stats = target.getComponent('stats');
    const transform = target.getComponent('transform');
    
    if (!stats) return 0;
    
    // 获取治疗量（支持两种格式）
    let healAmount = 0;
    if (skill.healAmount !== undefined) {
      // 使用 healAmount 属性
      healAmount = skill.healAmount;
    } else if (skill.effects && Array.isArray(skill.effects)) {
      // 使用 effects 数组
      const healEffect = skill.effects.find(e => e.type === 'heal');
      healAmount = healEffect?.value || 0;
    }
    const inferredSource = sourceEntity || (target !== this.playerEntity ? this.playerEntity : target);
    healAmount = this._filterEffectAmount('heal', inferredSource, target, healAmount);
    // 恢复生命值
    const actualHeal = stats.heal(healAmount);
    
    // 显示治疗数字（绿色）
    if (transform && actualHeal > 0) {
      this.showHealNumber(transform.position, actualHeal);
    }
    return actualHeal;
  }

  /**
   * 显示治疗数字
   * @param {Object} position - 位置 {x, y}
   * @param {number} amount - 治疗量
   */
  showHealNumber(position, amount) {
    const healNumber = {
      x: position.x,
      y: position.y - 20,
      damage: amount,
      life: 1.0,
      maxLife: 1.0,
      velocity: { x: (Math.random() - 0.5) * 20, y: -50 },
      isHeal: true // 标记为治疗数字
    };
    
    this.damageNumbers.push(healNumber);
  }

  /**
   * 应用Buff
   * @param {Entity} target - 目标
   * @param {Object} skill - 技能数据
   */
  applyBuff(target, skill) {
    // 简化实现，实际应该有完整的Buff系统
    console.log(`应用Buff: ${skill.name}`);
  }

  /**
   * 应用效果
   * @param {Entity} caster - 施法者
   * @param {Entity} target - 目标
   * @param {Object} effect - 效果数据
   */
  applyEffect(caster, target, effect) {
    // 简化实现，实际应该有完整的效果系统
    console.log(`应用效果: ${effect.type}`);
  }

  /**
   * 获取技能冷却进度
   * @param {Entity} entity - 实体
   * @param {number} skillIndex - 技能索引
   * @param {number} currentTime - 当前时间（可选，默认使用 performance.now()）
   * @returns {number} 冷却进度 0-1
   */
  getSkillCooldownProgress(entity, skillIndex, currentTime = null) {
    const combat = entity.getComponent('combat');
    if (!combat || skillIndex >= combat.skills.length) return 1;
    
    const skill = combat.skills[skillIndex];
    const lastUseTime = combat.skillCooldowns.get(skill.id) || 0;
    
    // 如果从未使用过，冷却完成
    if (lastUseTime === 0) return 1;
    
    const time = currentTime !== null ? currentTime : this.now();
    const remaining = combat.getSkillCooldownRemaining(skill.id, time);
    const progress = 1 - (remaining / skill.cooldown);
    
    return Math.max(0, Math.min(1, progress));
  }

  /**
   * 检查死亡
   * @param {Array<Entity>} entities - 实体列表
   */
  checkDeath(entities) {
    for (const entity of entities) {
      const stats = entity.getComponent('stats');
      if (!stats) continue;
      
      // 检查是否死亡
      if (stats.isDead() && !entity.isDying && !entity.isDead) {
        this.handleDeath(entity);
      }
    }
  }

  /**
   * 处理死亡
   * @param {Entity} entity - 实体
   */
  handleDeath(entity, deathEvent = null) {
    console.log(`${entity.name || entity.id} 死亡`);
    
    // 标记为正在死亡
    entity.isDying = true;
    
    // 播放死亡动画
    const sprite = entity.getComponent('sprite');
    if (sprite) {
      sprite.playAnimation('death');
    }
    
    // 清除战斗目标
    const combat = entity.getComponent('combat');
    if (combat) {
      combat.clearTarget();
    }
    
    // 如果是玩家死亡
    if (entity.type === 'player') {
      this.handlePlayerDeath(entity, deathEvent);
    } else {
      // 先在实际死亡位置转换尸体，再发布击杀事实；剧情消费者此时可立即访问尸体。
      const retainedCorpse = this._retainCorpse(entity);

      // 通知击杀（数据驱动 kill 事件源 / 任务计数）
      this._notifyKill(entity);

      // 敌人死亡，生成掉落物
      this.spawnLoot(entity);
      
      // 未接入尸体运行时的旧场景仍按原行为延迟移除。
      if (!retainedCorpse) {
        setTimeout(() => {
          this.removeDeadEntity(entity);
        }, 1000); // 等待死亡动画播放完成
      }
    }
  }

  /**
   * 生成掉落物
   * @param {Entity} entity - 死亡的实体
   */
  spawnLoot(entity) {
    const transform = entity.getComponent('transform');
    if (!transform) {
      console.log('CombatSystem: 实体没有 transform 组件，无法掉落');
      return;
    }
    
    console.log(`CombatSystem: 准备生成掉落物，位置: (${transform.position.x}, ${transform.position.y})`);
    
    // 触发掉落事件，让场景处理掉落物生成
    if (this.onLootDrop) {
      const lootItems = this.generateLoot(entity);
      console.log(`CombatSystem: 生成了 ${lootItems.length} 个掉落物`, lootItems);
      this.onLootDrop(transform.position, lootItems);
    } else {
      console.log('CombatSystem: 掉落回调未设置！');
    }
  }

  /**
   * 生成掉落物品列表
   * 优先按实体定义的 lootTable（数据驱动，{ chance, itemId, minQuantity, maxQuantity }）
   * 逐项掷骰；实体未声明 lootTable 时才回退到旧的内置药水掉落。
   * @param {Entity} entity - 死亡的实体
   * @returns {Array} 掉落物品列表
   */
  generateLoot(entity) {
    if (Array.isArray(entity?.lootTable)) {
      const loot = [];
      for (const entry of entity.lootTable) {
        const chance = Math.min(1, Math.max(0, Number(entry?.chance) || 0));
        const itemId = entry?.itemId || entry?.id;
        if (!itemId || Math.random() >= chance) continue;
        const parsedMin = Number(entry?.minQuantity);
        const min = Math.max(0, Math.floor(Number.isFinite(parsedMin) ? parsedMin : 1));
        const parsedMax = Number(entry?.maxQuantity);
        const max = Math.max(min, Math.floor(Number.isFinite(parsedMax) ? parsedMax : min));
        const quantity = min + Math.floor(Math.random() * (max - min + 1));
        if (quantity <= 0) continue;
        loot.push({
          itemId,
          name: entry?.name || itemId,
          quantity
        });
      }
      return loot;
    }

    // 旧场景兜底：30% 不掉落；70% 掉落红瓶/蓝瓶
    const loot = [];
    if (Math.random() < 0.3) {
      return loot;
    }

    // 70%概率掉落，其中50%红瓶，50%蓝瓶
    if (Math.random() < 0.5) {
      loot.push({
        type: 'health_potion',
        name: '生命药水',
        value: 50
      });
    } else {
      loot.push({
        type: 'mana_potion',
        name: '魔法药水',
        value: 30
      });
    }

    // 10%概率额外掉落第二瓶
    if (Math.random() < 0.1) {
      loot.push({
        type: Math.random() < 0.5 ? 'health_potion' : 'mana_potion',
        name: Math.random() < 0.5 ? '生命药水' : '魔法药水',
        value: Math.random() < 0.5 ? 50 : 30
      });
    }

    return loot;
  }

  /**
   * 设置掉落回调
   * @param {Function} callback - 掉落回调函数
   */
  setLootDropCallback(callback) {
    this.onLootDrop = callback;
  }

  /**
   * 注入敌人尸体保留器。返回 true 表示已在世界中保留尸体。
   * @param {(entity:Entity)=>boolean} callback
   */
  setOnCorpseCreateCallback(callback) {
    this.onCorpseCreateCallback = typeof callback === 'function' ? callback : null;
  }

  _retainCorpse(entity) {
    if (!entity || entity.type === 'player' || entity._corpseRetained === true) {
      return entity?._corpseRetained === true;
    }
    if (!this.onCorpseCreateCallback) return false;
    try {
      const retained = this.onCorpseCreateCallback(entity) === true;
      if (retained) entity._corpseRetained = true;
      return retained;
    } catch (error) {
      console.warn('CombatSystem: 尸体保留失败，回退旧清理流程', error);
      return false;
    }
  }

  /**
   * 处理玩家死亡
   * @param {Entity} player - 玩家实体
   */
  handlePlayerDeath(player, deathEvent = null) {
    console.log('玩家死亡，进入统一失败结算');
    this.clearTarget();
    player.isDead = true;
    if (this.onPlayerDeathCallback) {
      try {
        const handled = this.onPlayerDeathCallback({ player, deathEvent });
        if (handled === true || handled?.ok === true) return handled;
      } catch (error) {
        console.warn('CombatSystem: 玩家死亡回调执行失败，使用默认复活', error);
      }
    }
    const deathId = `player-death-fallback-${Date.now()}`;
    setTimeout(() => this.revivePlayer(player, { hp: 1, mp: 1 }), 10000);
    return { ok: true, fallback: true, deathId };
  }

  /**
   * 复活玩家
   * @param {Entity} player - 玩家实体
   */
  revivePlayer(player, { hp = null, mp = null, hpRatio = null, mpRatio = null } = {}) {
    const stats = player.getComponent('stats');
    if (!stats) return;

    console.log('玩家复活');

    // 显式绝对值优先，比例用于权威死亡/复活结算，避免 UI 或表现层直接修改属性。
    stats.fullRestore();
    if (Number.isFinite(hp)) {
      stats.hp = Math.max(0, Math.min(stats.maxHp, Math.floor(hp)));
    } else if (Number.isFinite(hpRatio)) {
      const ratio = Math.max(0, Math.min(1, hpRatio));
      stats.hp = Math.max(1, Math.min(stats.maxHp, Math.ceil(stats.maxHp * ratio)));
    }
    if (Number.isFinite(mp)) {
      stats.mp = Math.max(0, Math.min(stats.maxMp, Math.floor(mp)));
    } else if (Number.isFinite(mpRatio)) {
      const ratio = Math.max(0, Math.min(1, mpRatio));
      stats.mp = Math.max(0, Math.min(stats.maxMp, Math.ceil(stats.maxMp * ratio)));
    }

    // 清除死亡标记
    player.isDying = false;
    player.isDead = false;

    // 恢复待机动画
    const sprite = player.getComponent('sprite');
    if (sprite) {
      sprite.playAnimation('idle');
    }
  }

  /**
   * 移除死亡实体
   * @param {Entity} entity - 实体
   */
  removeDeadEntity(entity) {
    entity.isDead = true;
    console.log(`移除死亡实体: ${entity.name || entity.id}`);
    
    // 如果死亡的是当前目标，清除选中
    if (this.selectedTarget === entity) {
      this.clearTarget();
    }
    
    // 实际的实体移除应该由场景管理器处理
    // 这里只是标记为已死亡
  }

  /**
   * 获取死亡实体列表
   * @param {Array<Entity>} entities - 实体列表
   * @returns {Array<Entity>} 死亡的实体列表
   */
  getDeadEntities(entities) {
    return entities.filter(e => e.isDead === true);
  }

  /**
   * 获取存活实体列表
   * @param {Array<Entity>} entities - 实体列表
   * @returns {Array<Entity>} 存活的实体列表
   */
  getAliveEntities(entities) {
    return entities.filter(e => !e.isDead);
  }

  /**
   * 获取攻击冷却进度
   * @param {Entity} entity - 实体
   * @param {number} currentTime - 当前时间（可选，默认使用 performance.now()）
   * @returns {number} 冷却进度 0-1
   */
  getAttackCooldownProgress(entity, currentTime = null) {
    const combat = entity.getComponent('combat');
    if (!combat) return 1;
    
    // 如果从未攻击过，冷却完成
    if (combat.lastAttackTime === 0) return 1;
    
    const time = currentTime !== null ? currentTime : this.now();
    const remaining = combat.getAttackCooldownRemaining(time);
    const progress = 1 - (remaining / combat.attackCooldown);
    
    return Math.max(0, Math.min(1, progress));
  }

  /**
   * 世界坐标转屏幕坐标
   * @param {Object} worldPos - 世界坐标 {x, y}
   * @returns {Object} 屏幕坐标 {x, y}
   */
  worldToScreen(worldPos) {
    if (!this.camera) {
      return { x: worldPos.x, y: worldPos.y };
    }
    
    const viewBounds = this.camera.getViewBounds();
    return {
      x: worldPos.x - viewBounds.left,
      y: worldPos.y - viewBounds.top
    };
  }

  // ==================== 大规模战斗系统 ====================

  /**
   * 初始化大规模战斗
   * @param {Object} config - 战斗配置
   * @param {Array<Entity>} config.allies - 友军单位列表
   * @param {Array<Entity>} config.enemies - 敌军单位列表
   * @param {Object} config.battleArea - 战场区域 {x, y, width, height}
   */
  initLargeScaleBattle(config) {
    this.largeBattle = {
      active: true,
      allies: config.allies || [],
      enemies: config.enemies || [],
      battleArea: config.battleArea || { x: 0, y: 0, width: 2000, height: 2000 },
      allyMorale: 100,
      enemyMorale: 100,
      battleState: 'ongoing', // 'ongoing', 'ally_victory', 'enemy_victory'
      startTime: this.now()
    };

    // 为所有单位设置阵营标记
    for (const ally of this.largeBattle.allies) {
      ally.faction = 'ally';
      ally.isAI = true; // 标记为AI控制
    }

    for (const enemy of this.largeBattle.enemies) {
      enemy.faction = 'enemy';
      enemy.isAI = true;
    }

    console.log(`CombatSystem: 初始化大规模战斗 - 友军: ${this.largeBattle.allies.length}, 敌军: ${this.largeBattle.enemies.length}`);
  }

  /**
   * 更新大规模战斗
   * @param {number} deltaTime - 帧间隔时间（秒）
   * @param {number} currentTime - 当前时间（毫秒）
   */
  updateLargeScaleBattle(deltaTime, currentTime) {
    if (!this.largeBattle || !this.largeBattle.active) return;

    // 更新友军AI
    this.updateArmyAI(this.largeBattle.allies, this.largeBattle.enemies, currentTime);

    // 更新敌军AI
    this.updateArmyAI(this.largeBattle.enemies, this.largeBattle.allies, currentTime);

    // 更新战场态势
    this.updateBattleSituation();

    // 更新士气系统
    this.updateMorale(deltaTime);

    // 检查战斗结束条件
    this.checkBattleEndCondition();
  }

  /**
   * 更新军队AI
   * @param {Array<Entity>} army - 军队单位列表
   * @param {Array<Entity>} enemies - 敌军单位列表
   * @param {number} currentTime - 当前时间（毫秒）
   */
  updateArmyAI(army, enemies, currentTime) {
    for (const unit of army) {
      // 跳过死亡单位
      if (unit.isDead || unit.isDying) continue;

      // 跳过玩家控制的单位
      if (unit.type === 'player') continue;

      const combat = unit.getComponent('combat');
      if (!combat) continue;

      // 如果没有目标或目标已死亡，寻找新目标
      if (!combat.hasTarget() || this.isTargetDead(combat.target)) {
        const newTarget = this.findNearestEnemy(unit, enemies);
        if (newTarget) {
          combat.setTarget(newTarget);
        }
      }

      // 如果有目标，尝试攻击
      if (combat.hasTarget()) {
        const target = combat.target;

        // 检查是否在攻击范围内
        if (this.isInRange(unit, target, combat.attackRange)) {
          // 在范围内，尝试攻击
          if (combat.canAttack(currentTime)) {
            this.performAttack(unit, target, currentTime);
          }
        } else {
          // 不在范围内，移动到目标
          this.moveTowardsTarget(unit, target);
        }
      }
    }
  }

  /**
   * 检查目标是否死亡
   * @param {Entity} target - 目标实体
   * @returns {boolean}
   */
  isTargetDead(target) {
    if (!target) return true;
    const stats = target.getComponent('stats');
    return !stats || stats.hp <= 0 || target.isDead;
  }

  /**
   * 查找最近的敌人
   * @param {Entity} unit - 单位
   * @param {Array<Entity>} enemies - 敌军列表
   * @returns {Entity|null}
   */
  findNearestEnemy(unit, enemies) {
    const unitTransform = unit.getComponent('transform');
    if (!unitTransform) return null;

    let nearestEnemy = null;
    let nearestDistance = Infinity;

    for (const enemy of enemies) {
      // 跳过死亡敌人
      if (enemy.isDead || enemy.isDying) continue;

      const enemyStats = enemy.getComponent('stats');
      if (!enemyStats || enemyStats.hp <= 0) continue;

      const enemyTransform = enemy.getComponent('transform');
      if (!enemyTransform) continue;

      const dx = enemyTransform.position.x - unitTransform.position.x;
      const dy = enemyTransform.position.y - unitTransform.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestEnemy = enemy;
      }
    }

    return nearestEnemy;
  }

  /**
   * 移动到目标
   * @param {Entity} unit - 单位
   * @param {Entity} target - 目标
   */
  moveTowardsTarget(unit, target) {
    const unitTransform = unit.getComponent('transform');
    const targetTransform = target.getComponent('transform');
    const movement = unit.getComponent('movement');

    if (!unitTransform || !targetTransform || !movement) return;

    // 计算方向
    const dx = targetTransform.position.x - unitTransform.position.x;
    const dy = targetTransform.position.y - unitTransform.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 0) {
      // 归一化方向
      const dirX = dx / distance;
      const dirY = dy / distance;

      // 设置移动速度
      movement.velocity.x = dirX * movement.speed;
      movement.velocity.y = dirY * movement.speed;
    }
  }

  /**
   * 更新战场态势
   */
  updateBattleSituation() {
    if (!this.largeBattle) return;

    // 统计存活单位数量
    const aliveAllies = this.largeBattle.allies.filter(u => !u.isDead && !u.isDying).length;
    const aliveEnemies = this.largeBattle.enemies.filter(u => !u.isDead && !u.isDying).length;

    // 计算战场态势（-1到1，负数表示敌军优势，正数表示友军优势）
    const totalUnits = aliveAllies + aliveEnemies;
    if (totalUnits > 0) {
      this.largeBattle.situation = (aliveAllies - aliveEnemies) / totalUnits;
    } else {
      this.largeBattle.situation = 0;
    }

    // 存储单位数量
    this.largeBattle.aliveAllies = aliveAllies;
    this.largeBattle.aliveEnemies = aliveEnemies;
  }

  /**
   * 更新士气系统
   * @param {number} deltaTime - 帧间隔时间（秒）
   */
  updateMorale(deltaTime) {
    if (!this.largeBattle) return;

    // 根据战场态势调整士气
    const situation = this.largeBattle.situation || 0;

    // 友军士气变化
    if (situation > 0.3) {
      // 友军优势，士气上升
      this.largeBattle.allyMorale = Math.min(100, this.largeBattle.allyMorale + 5 * deltaTime);
    } else if (situation < -0.3) {
      // 友军劣势，士气下降
      this.largeBattle.allyMorale = Math.max(0, this.largeBattle.allyMorale - 10 * deltaTime);
    }

    // 敌军士气变化
    if (situation < -0.3) {
      // 敌军优势，士气上升
      this.largeBattle.enemyMorale = Math.min(100, this.largeBattle.enemyMorale + 5 * deltaTime);
    } else if (situation > 0.3) {
      // 敌军劣势，士气下降
      this.largeBattle.enemyMorale = Math.max(0, this.largeBattle.enemyMorale - 10 * deltaTime);
    }

    // 应用士气效果到单位
    this.applyMoraleEffects(this.largeBattle.allies, this.largeBattle.allyMorale);
    this.applyMoraleEffects(this.largeBattle.enemies, this.largeBattle.enemyMorale);
  }

  /**
   * 应用士气效果
   * @param {Array<Entity>} army - 军队单位列表
   * @param {number} morale - 士气值（0-100）
   */
  applyMoraleEffects(army, morale) {
    // 士气影响攻击力和防御力
    const moraleMultiplier = 0.5 + (morale / 100) * 0.5; // 0.5x 到 1.0x

    for (const unit of army) {
      if (unit.isDead || unit.isDying) continue;

      const stats = unit.getComponent('stats');
      if (!stats) continue;

      // 存储士气加成（用于伤害计算）
      stats.moraleMultiplier = moraleMultiplier;
    }
  }

  /**
   * 检查战斗结束条件
   */
  checkBattleEndCondition() {
    if (!this.largeBattle || this.largeBattle.battleState !== 'ongoing') return;

    const aliveAllies = this.largeBattle.aliveAllies || 0;
    const aliveEnemies = this.largeBattle.aliveEnemies || 0;

    // 检查友军全灭
    if (aliveAllies === 0) {
      this.largeBattle.battleState = 'enemy_victory';
      console.log('CombatSystem: 战斗结束 - 敌军胜利');
      this.onBattleEnd('enemy_victory');
      return;
    }

    // 检查敌军全灭
    if (aliveEnemies === 0) {
      this.largeBattle.battleState = 'ally_victory';
      console.log('CombatSystem: 战斗结束 - 友军胜利');
      this.onBattleEnd('ally_victory');
      return;
    }

    // 检查士气崩溃
    if (this.largeBattle.allyMorale <= 0) {
      this.largeBattle.battleState = 'enemy_victory';
      console.log('CombatSystem: 战斗结束 - 友军士气崩溃');
      this.onBattleEnd('enemy_victory');
      return;
    }

    if (this.largeBattle.enemyMorale <= 0) {
      this.largeBattle.battleState = 'ally_victory';
      console.log('CombatSystem: 战斗结束 - 敌军士气崩溃');
      this.onBattleEnd('ally_victory');
      return;
    }
  }

  /**
   * 战斗结束回调
   * @param {string} result - 战斗结果 'ally_victory' 或 'enemy_victory'
   */
  onBattleEnd(result) {
    if (!this.largeBattle) return;

    this.largeBattle.active = false;
    this.largeBattle.endTime = this.now();
    this.largeBattle.duration = (this.largeBattle.endTime - this.largeBattle.startTime) / 1000;

    // 触发战斗结束事件（可以被外部监听）
    if (this.onBattleEndCallback) {
      this.onBattleEndCallback(result, this.largeBattle);
    }
  }

  /**
   * 设置战斗结束回调
   * @param {Function} callback - 回调函数
   */
  setOnBattleEndCallback(callback) {
    this.onBattleEndCallback = callback;
  }

  /**
   * 获取战场态势
   * @returns {Object} 战场态势信息
   */
  getBattleSituation() {
    if (!this.largeBattle) return null;

    return {
      active: this.largeBattle.active,
      aliveAllies: this.largeBattle.aliveAllies || 0,
      aliveEnemies: this.largeBattle.aliveEnemies || 0,
      allyMorale: this.largeBattle.allyMorale,
      enemyMorale: this.largeBattle.enemyMorale,
      situation: this.largeBattle.situation || 0,
      battleState: this.largeBattle.battleState
    };
  }

  /**
   * 渲染战场态势UI
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderBattleSituation(ctx) {
    if (!this.largeBattle || !this.largeBattle.active) return;

    const situation = this.getBattleSituation();
    if (!situation) return;

    // 战场态势面板位置（屏幕左上角）
    const panelX = 20;
    const panelY = 20;
    const panelWidth = 250;
    const panelHeight = 120;

    ctx.save();

    // 绘制背景
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(panelX, panelY, panelWidth, panelHeight);

    // 绘制边框
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);

    // 绘制标题
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('战场态势', panelX + 10, panelY + 25);

    // 绘制单位数量
    ctx.font = '14px Arial';
    ctx.fillStyle = '#00ff00';
    ctx.fillText(`友军: ${situation.aliveAllies}`, panelX + 10, panelY + 50);

    ctx.fillStyle = '#ff0000';
    ctx.fillText(`敌军: ${situation.aliveEnemies}`, panelX + 130, panelY + 50);

    // 绘制士气条
    const moraleBarY = panelY + 65;
    const moraleBarHeight = 15;

    // 友军士气
    ctx.fillStyle = '#333333';
    ctx.fillRect(panelX + 10, moraleBarY, 100, moraleBarHeight);
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(panelX + 10, moraleBarY, situation.allyMorale, moraleBarHeight);
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('友军士气', panelX + 60, moraleBarY + 12);

    // 敌军士气
    ctx.fillStyle = '#333333';
    ctx.fillRect(panelX + 130, moraleBarY, 100, moraleBarHeight);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(panelX + 130, moraleBarY, situation.enemyMorale, moraleBarHeight);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('敌军士气', panelX + 180, moraleBarY + 12);

    // 绘制战场态势指示器
    const indicatorY = panelY + 95;
    const indicatorWidth = 200;
    const indicatorX = panelX + 25;

    // 背景
    ctx.fillStyle = '#333333';
    ctx.fillRect(indicatorX, indicatorY, indicatorWidth, 10);

    // 态势指示器（-1到1映射到0到200）
    const indicatorPos = indicatorX + (situation.situation + 1) * 100;
    ctx.fillStyle = situation.situation > 0 ? '#00ff00' : '#ff0000';
    ctx.beginPath();
    ctx.arc(indicatorPos, indicatorY + 5, 8, 0, Math.PI * 2);
    ctx.fill();

    // 中线
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(indicatorX + 100, indicatorY);
    ctx.lineTo(indicatorX + 100, indicatorY + 10);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * 结束大规模战斗
   */
  endLargeScaleBattle() {
    if (this.largeBattle) {
      this.largeBattle.active = false;
      console.log('CombatSystem: 大规模战斗已结束');
    }
  }

  /**
   * 检测武器碰撞并应用反作用力
   * @param {Array<Entity>} entities - 实体列表
   */
  checkWeaponCollisions(entities) {
    if (!this.weaponRenderer || !this.enemyWeaponRenderer || !this.playerEntity) return;
    
    const playerTransform = this.playerEntity.getComponent('transform');
    if (!playerTransform) return;
    
    const currentTime = this.now();
    
    // 检查玩家武器是否被禁用
    if (this.weaponRenderer.disabled && this.weaponRenderer.disabled.active) {
      if (currentTime < this.weaponRenderer.disabled.endTime) {
        return;
      } else {
        this.weaponRenderer.disabled.active = false;
      }
    }
    
    // 获取玩家武器速度
    const playerSpeed = this.weaponRenderer.mouseMovement.speedKmh || 0;
    
    // 确定武器方向
    const weaponDirection = this.weaponRenderer.currentMouseAngle;
    
    // 计算玩家武器的位置和范围
    const playerWeaponPos = this.getWeaponTipPosition(
      playerTransform.position,
      weaponDirection,
      60
    );
    const playerWeaponRadius = 35;
    
    // 检查与所有敌人的碰撞
    for (const enemy of entities) {
      if (enemy.type !== 'enemy' || enemy.isDead || enemy.isDying) continue;
      
      const enemyTransform = enemy.getComponent('transform');
      if (!enemyTransform) continue;
      
      // 检查敌人武器是否被禁用
      const enemyDisabled = this.enemyWeaponDisabled?.get(enemy.id);
      if (enemyDisabled && enemyDisabled.active && currentTime < enemyDisabled.endTime) {
        continue;
      } else if (enemyDisabled && enemyDisabled.active) {
        enemyDisabled.active = false;
      }
      
      // 检测敌人是否在攻击
      const enemyWeaponAnimation = this.enemyWeaponRenderer.attackAnimations.get(enemy.id);
      const enemyIsAttacking = enemyWeaponAnimation && enemyWeaponAnimation.active;
      
      // 只有敌人在攻击时才检测武器碰撞
      if (!enemyIsAttacking) {
        continue;
      }
      
      // 检查碰撞冷却
      const lastCollisionTime = this.weaponCollisionCooldowns.get(enemy.id) || 0;
      if (currentTime - lastCollisionTime < 500) {
        continue;
      }
      
      // 计算敌人武器位置
      const enemyWeaponAngle = enemyWeaponAnimation.angle;
      const enemyWeaponPos = this.getWeaponTipPosition(
        enemyTransform.position,
        enemyWeaponAngle,
        50
      );
      const enemyWeaponRadius = 30;
      
      // 检测武器之间的碰撞
      const weaponDx = playerWeaponPos.x - enemyWeaponPos.x;
      const weaponDy = playerWeaponPos.y - enemyWeaponPos.y;
      const weaponDistance = Math.sqrt(weaponDx * weaponDx + weaponDy * weaponDy);
      
      if (weaponDistance < playerWeaponRadius + enemyWeaponRadius) {
        // 武器碰撞发生！
        this.weaponCollisionCooldowns.set(enemy.id, currentTime);
        
        // 获取敌人武器速度
        let enemySpeed = 30;
        const templateId = enemy.templateId || '';
        if (templateId === 'wild_dog') {
          enemySpeed = 40;
        } else if (templateId === 'soldier' || templateId === 'bandit') {
          enemySpeed = 35;
        } else if (templateId === 'starving') {
          enemySpeed = 25;
        }
        
        // 计算伤害倍率：速度<3为随机0-5，速度3-100为50%-200%递进
        const calcDamageMultiplier = (speed) => {
          if (speed < 3) {
            return null; // 返回null表示使用随机0-5伤害
          }
          // 速度3-100，倍率50%-200%
          // 线性插值：3km/h -> 0.5, 100km/h -> 2.0
          const ratio = Math.min((speed - 3) / (100 - 3), 1);
          return 0.5 + ratio * 1.5;
        };
        
        const playerMultiplier = calcDamageMultiplier(playerSpeed);
        const enemyMultiplier = calcDamageMultiplier(enemySpeed);
        
        const knockbackDir = {
          x: weaponDx / weaponDistance,
          y: weaponDy / weaponDistance
        };
        
        // 比较速度，决定胜负
        if (playerSpeed > enemySpeed) {
          // 玩家胜出
          const stats = this.playerEntity.getComponent('stats');
          const baseDamage = stats?.attack || 15;
          let finalDamage;
          let damageText;
          
          if (playerMultiplier === null) {
            finalDamage = Math.floor(Math.random() * 6);
            damageText = `${finalDamage}`;
          } else {
            finalDamage = Math.floor(baseDamage * playerMultiplier);
            damageText = `${Math.floor(playerMultiplier * 100)}%`;
          }
          
          this.applyDamage(enemy, finalDamage, knockbackDir, `武器碰撞${damageText}`);
          
          // 禁用敌人武器3秒
          if (!this.enemyWeaponDisabled) {
            this.enemyWeaponDisabled = new Map();
          }
          this.enemyWeaponDisabled.set(enemy.id, {
            active: true,
            endTime: currentTime + 3000
          });
          
          if (enemyWeaponAnimation) {
            enemyWeaponAnimation.active = false;
          }
          
          if (this.floatingTextManager) {
            this.floatingTextManager.addText(
              playerTransform.position.x,
              playerTransform.position.y - 80,
              `${playerSpeed.toFixed(1)}km/h 胜出！`,
              '#00ff00'
            );
            this.floatingTextManager.addText(
              enemyTransform.position.x,
              enemyTransform.position.y - 80,
              `武器失效3秒`,
              '#ff4444'
            );
          }
          
        } else if (playerSpeed < enemySpeed) {
          // 敌人胜出
          const enemyStats = enemy.getComponent('stats');
          const baseDamage = enemyStats?.attack || 10;
          let finalDamage;
          let damageText;
          
          if (enemyMultiplier === null) {
            finalDamage = Math.floor(Math.random() * 6);
            damageText = `${finalDamage}`;
          } else {
            finalDamage = Math.floor(baseDamage * enemyMultiplier);
            damageText = `${Math.floor(enemyMultiplier * 100)}%`;
          }
          
          this.applyDamage(this.playerEntity, finalDamage, { x: -knockbackDir.x, y: -knockbackDir.y }, `武器碰撞${damageText}`);
          
          // 禁用玩家武器3秒
          this.weaponRenderer.disabled = {
            active: true,
            endTime: currentTime + 3000
          };
          
          if (this.floatingTextManager) {
            this.floatingTextManager.addText(
              enemyTransform.position.x,
              enemyTransform.position.y - 80,
              `${enemySpeed}km/h 胜出！`,
              '#00ff00'
            );
            this.floatingTextManager.addText(
              playerTransform.position.x,
              playerTransform.position.y - 80,
              `武器失效3秒`,
              '#ff4444'
            );
          }
          
        } else {
          // 速度相等：双方弹开，无伤害，但显示碰撞提示
          if (this.floatingTextManager) {
            this.floatingTextManager.addText(
              (playerTransform.position.x + enemyTransform.position.x) / 2,
              (playerTransform.position.y + enemyTransform.position.y) / 2 - 50,
              '势均力敌！',
              '#ffff00'
            );
          }
          
          // 显示碰撞提示（即使没有伤害）
          this.showDamageNumber(playerTransform.position, 0, '武器碰撞[格挡]');
          this.showDamageNumber(enemyTransform.position, 0, '武器碰撞[格挡]');
        }
        
        // 弹开双方
        this.applyKnockbackToEntity(enemy, knockbackDir, 25);
        this.applyKnockbackToEntity(this.playerEntity, { x: -knockbackDir.x, y: -knockbackDir.y }, 15);
        
        // 创建碰撞火花特效
        this.createWeaponClashEffect(
          (playerWeaponPos.x + enemyWeaponPos.x) / 2,
          (playerWeaponPos.y + enemyWeaponPos.y) / 2
        );
      }
    }
  }

  /**
   * 创建武器碰撞火花特效
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   */
  createWeaponClashEffect(x, y) {
    if (!this.skillEffects || !this.skillEffects.particleSystem) return;
    
    this.skillEffects.particleSystem.emitBurst(
      {
        position: { x, y },
        velocity: { x: 0, y: 0 },
        life: 300,
        size: 5,
        color: '#ffff00',
        gravity: 0
      },
      20,
      {
        velocityRange: { min: 100, max: 180 },
        angleRange: { min: 0, max: Math.PI * 2 },
        sizeRange: { min: 3, max: 7 }
      }
    );
  }

  /**
   * 创建武器击中特效
   * @param {Object} position - 位置 {x, y}
   */
  createWeaponHitEffect(position) {
    if (!this.skillEffects || !this.skillEffects.particleSystem) return;
    
    this.skillEffects.particleSystem.emitBurst(
      {
        position: { ...position },
        velocity: { x: 0, y: 0 },
        life: 400,
        size: 4,
        color: '#ff8800',
        gravity: 50
      },
      12,
      {
        velocityRange: { min: 60, max: 120 },
        angleRange: { min: 0, max: Math.PI * 2 },
        sizeRange: { min: 3, max: 6 }
      }
    );
  }

  /**
   * 获取武器尖端位置
   * @param {Object} entityPos - 实体位置 {x, y}
   * @param {number} weaponAngle - 武器角度（弧度）
   * @param {number} weaponLength - 武器长度
   * @returns {Object} 武器尖端位置 {x, y}
   */
  getWeaponTipPosition(entityPos, weaponAngle, weaponLength) {
    return {
      x: entityPos.x + Math.cos(weaponAngle) * weaponLength,
      y: entityPos.y + Math.sin(weaponAngle) * weaponLength
    };
  }

  /**
   * 应用击退效果到实体
   * @param {Entity} entity - 实体
   * @param {Object} direction - 击退方向 {x, y}（已归一化）
   * @param {number} strength - 击退强度
   */
  applyKnockbackToEntity(entity, direction, strength) {
    const transform = entity.getComponent('transform');
    if (!transform) return;
    
    // 应用击退
    transform.position.x += direction.x * strength;
    transform.position.y += direction.y * strength;
  }

  /**
   * 添加技能影响范围指示器
   * @param {Object} casterPos - 施法者位置 {x, y}
   * @param {Object} targetPos - 技能落点位置 {x, y}
   * @param {Object} skill - 技能数据
   */
  addSkillRangeIndicator(casterPos, targetPos, skill) {
    const color = this.skillColorMap[skill.effectType] || '#ffff00';
    
    // 治疗和打坐不显示范围
    if (skill.id === 'heal' || skill.id === 'meditation') return;
    
    // 寒冰指：线性路径 + 终点圆
    if (skill.id === 'ice_finger') {
      this.skillRangeIndicators.push({
        type: 'path',
        startX: casterPos.x,
        startY: casterPos.y,
        endX: targetPos.x,
        endY: targetPos.y,
        pathWidth: 30,
        endRadius: 50,
        color: color,
        life: 2.0,
        maxLife: 2.0,
        dashOffset: 0,
        skillName: skill.name
      });
      return;
    }
    
    // 火焰掌：主AOE + 溅射范围
    if (skill.id === 'flame_palm') {
      this.skillRangeIndicators.push({
        type: 'circle',
        x: targetPos.x,
        y: targetPos.y,
        radius: skill.aoeRadius || 150,
        color: color,
        life: 2.0,
        maxLife: 2.0,
        dashOffset: 0,
        skillName: skill.name
      });
      // 溅射范围（内圈）
      this.skillRangeIndicators.push({
        type: 'circle',
        x: targetPos.x,
        y: targetPos.y,
        radius: 80,
        color: '#ffaa00',
        life: 2.0,
        maxLife: 2.0,
        dashOffset: 0,
        skillName: '溅射'
      });
      return;
    }
    
    // 其他AOE技能：圆形范围
    const aoeRadius = skill.aoeRadius || 150;
    this.skillRangeIndicators.push({
      type: 'circle',
      x: targetPos.x,
      y: targetPos.y,
      radius: aoeRadius,
      color: color,
      life: 2.0,
      maxLife: 2.0,
      dashOffset: 0,
      skillName: skill.name
    });
  }

  /**
   * 更新技能范围指示器
   * @param {number} deltaTime - 帧间隔时间（秒）
   */
  updateSkillRangeIndicators(deltaTime) {
    for (let i = this.skillRangeIndicators.length - 1; i >= 0; i--) {
      const indicator = this.skillRangeIndicators[i];
      indicator.life -= deltaTime;
      // 虚线旋转动画
      indicator.dashOffset += deltaTime * 20;
      if (indicator.life <= 0) {
        this.skillRangeIndicators.splice(i, 1);
      }
    }
  }

  /**
   * 渲染技能影响范围指示器（在世界坐标系中调用）
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文（已应用相机变换）
   */
  renderSkillRangeIndicators(ctx) {
    if (this.skillRangeIndicators.length === 0) return;

    ctx.save();
    for (const indicator of this.skillRangeIndicators) {
      // 根据剩余生命计算透明度（最后0.5秒淡出）
      let alpha = 1.0;
      if (indicator.life < 0.5) {
        alpha = indicator.life / 0.5;
      }

      if (indicator.type === 'path') {
        // 线性路径指示器（寒冰指）
        this.renderPathIndicator(ctx, indicator, alpha);
      } else {
        // 圆形AOE指示器
        this.renderCircleIndicator(ctx, indicator, alpha);
      }
    }
    ctx.restore();
  }

  /**
   * 渲染圆形范围指示器
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} indicator
   * @param {number} alpha
   */
  renderCircleIndicator(ctx, indicator, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha * 0.6;
    ctx.strokeStyle = indicator.color;
    ctx.lineWidth = 5;
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -indicator.dashOffset;

    // 2.5D椭圆（纵向压扁0.5，模拟俯视透视）
    ctx.beginPath();
    ctx.ellipse(indicator.x, indicator.y, indicator.radius, indicator.radius * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 技能名称
    ctx.setLineDash([]);
    ctx.globalAlpha = alpha * 0.8;
    ctx.fillStyle = indicator.color;
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(indicator.skillName, indicator.x, indicator.y - indicator.radius * 0.5 - 8);
    ctx.restore();
  }

  /**
   * 渲染路径范围指示器（寒冰指）
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} indicator
   * @param {number} alpha
   */
  renderPathIndicator(ctx, indicator, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha * 0.5;
    ctx.strokeStyle = indicator.color;
    ctx.lineWidth = 5;
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -indicator.dashOffset;

    // 计算路径方向
    const dx = indicator.endX - indicator.startX;
    const dy = indicator.endY - indicator.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) { ctx.restore(); return; }

    // 2.5D法线：Y方向压扁0.5模拟俯视透视
    const nx = -dy / dist;
    const ny = dx / dist;
    const hw = indicator.pathWidth; // 半宽
    // 应用2.5D压扁到法线的Y分量
    const nx25d = nx;
    const ny25d = ny * 0.5;

    // 绘制路径矩形（2.5D虚线边框）
    ctx.beginPath();
    ctx.moveTo(indicator.startX + nx25d * hw, indicator.startY + ny25d * hw);
    ctx.lineTo(indicator.endX + nx25d * hw, indicator.endY + ny25d * hw);
    ctx.lineTo(indicator.endX - nx25d * hw, indicator.endY - ny25d * hw);
    ctx.lineTo(indicator.startX - nx25d * hw, indicator.startY - ny25d * hw);
    ctx.closePath();
    ctx.stroke();

    // 终点AOE椭圆（2.5D）
    ctx.beginPath();
    ctx.ellipse(indicator.endX, indicator.endY, indicator.endRadius, indicator.endRadius * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 技能名称
    ctx.setLineDash([]);
    ctx.globalAlpha = alpha * 0.8;
    ctx.fillStyle = indicator.color;
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(indicator.skillName, indicator.endX, indicator.endY - indicator.endRadius * 0.5 - 8);
    ctx.restore();
  }

  // ==================== 战斗状态管理 ====================

  /**
   * 更新战斗状态
   * @param {number} deltaTime - 帧间隔时间（秒）
   * @param {Array} entities - 实体列表
   */
  updateCombatState(deltaTime, entities) {
    if (this.playerEntity?.isSoulState === true) {
      if (this.combatState.inCombat) this.exitCombat();
      return;
    }
    const currentTime = this.now() / 1000;
    const hasNearby = this.checkNearbyEnemies(entities);
    
    if (hasNearby) {
      if (!this.combatState.inCombat) {
        this.enterCombat();
      }
      this.combatState.lastCombatTime = currentTime;
      this.combatState.combatExitTimer = this.combatState.combatExitDelay;
    } else if (this.combatState.inCombat) {
      const elapsed = currentTime - this.combatState.lastCombatTime;
      this.combatState.combatExitTimer = Math.max(0, this.combatState.combatExitDelay - elapsed);
      
      if (this.combatState.combatExitTimer <= 0) {
        this.exitCombat();
      }
    }
  }

  /**
   * 检查附近是否有敌人
   * @param {Array} entities - 实体列表
   * @returns {boolean}
   */
  checkNearbyEnemies(entities) {
    if (!this.playerEntity) return false;
    
    const pt = this.playerEntity.getComponent('transform');
    if (!pt) return false;
    
    const range = this.combatState.combatRange;
    
    for (const entity of entities) {
      if (entity.type !== 'enemy' || entity.isDead || entity.isDying) continue;
      
      const et = entity.getComponent('transform');
      const es = entity.getComponent('stats');
      if (!et || !es || es.hp <= 0) continue;
      
      const dx = et.position.x - pt.position.x;
      const dy = et.position.y - pt.position.y;
      if (dx * dx + dy * dy <= range * range) {
        return true;
      }
    }
    return false;
  }

  /**
   * 进入战斗状态
   */
  enterCombat() {
    this.combatState.inCombat = true;
    this.combatState.lastCombatTime = this.now() / 1000;
    this.combatState.combatExitTimer = this.combatState.combatExitDelay;
    
    if (this.onEnterCombatCallback) {
      this.onEnterCombatCallback();
    }
    
    console.log('CombatSystem: 进入战斗状态');
  }

  /**
   * 脱离战斗状态
   */
  exitCombat() {
    this.combatState.inCombat = false;
    this.combatState.combatExitTimer = 0;
    
    if (this.onExitCombatCallback) {
      this.onExitCombatCallback();
    }
    
    console.log('CombatSystem: 脱离战斗状态');
  }

  /**
   * 是否在战斗中
   * @returns {boolean}
   */
  isInCombat() {
    return this.combatState.inCombat;
  }

  /**
   * 获取脱离战斗倒计时
   * @returns {number}
   */
  getCombatExitTimer() {
    return this.combatState.combatExitTimer;
  }

  /** 设置玩家主动输入锁；不会冻结 AI、环境或战斗结算。 */
  setPlayerInputLock(callback) {
    this.isPlayerInputLocked = typeof callback === 'function' ? callback : () => false;
  }

  /** 设置单一兼容受伤回调。新代码优先使用 addDamageListener。 */
  setOnDamageCallback(callback) {
    this.onDamageCallback = typeof callback === 'function' ? callback : null;
  }

  /** 订阅实际伤害事件；返回可取消函数，避免场景监听器泄漏。 */
  addDamageListener(callback) {
    if (typeof callback !== 'function') return () => {};
    this._damageListeners.add(callback);
    return () => this._damageListeners.delete(callback);
  }

  /** 设置玩家死亡的唯一领域结算回调。 */
  setOnPlayerDeathCallback(callback) {
    this.onPlayerDeathCallback = typeof callback === 'function' ? callback : null;
  }

  /**
   * 设置进入战斗回调
   * @param {Function} callback
   */
  setOnEnterCombat(callback) {
    this.onEnterCombatCallback = callback;
  }

  /**
   * 设置脱离战斗回调
   * @param {Function} callback
   */
  setOnExitCombat(callback) {
    this.onExitCombatCallback = callback;
  }

  /**
   * 设置击杀回调（敌人死亡时触发一次）
   * @param {Function} callback - (entity) => void
   */
  setOnKillCallback(callback) {
    this.onKillCallback = callback;
  }

  /**
   * 通知一次击杀（内部统一入口，用实体标记防重，仅非玩家）
   * 供数据驱动 kill 事件源 / 任务击杀计数消费。
   * @param {Entity} entity - 死亡实体
   * @private
   */
  _notifyKill(entity) {
    if (!entity || entity.type === 'player') return;
    if (entity._killNotified) return;
    entity._killNotified = true;
    if (this.onKillCallback) {
      try {
        this.onKillCallback(entity);
      } catch (e) {
        console.warn('CombatSystem: onKillCallback 执行出错', e);
      }
    }
  }
}

