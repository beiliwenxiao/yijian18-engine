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
 * SpriteComponent.js
 * 精灵组件 - 管理实体的精灵图和动画状态
 */

import { Component } from '../Component.js';

/**
 * 精灵组件
 * 存储精灵渲染所需的信息
 */
export class SpriteComponent extends Component {
  /**
   * @param {string} spriteSheet - 精灵图集名称
   * @param {Object} config - 配置
   */
  constructor(spriteSheet, config = {}) {
    super('sprite');
    
    this.spriteSheet = spriteSheet;
    this.currentAnimation = config.defaultAnimation || 'idle';
    this.frame = 0;
    this.frameTime = 0;
    this.animations = new Map();
    
    // 渲染属性
    this.width = config.width || 32;
    this.height = config.height || 32;
    this.offsetX = config.offsetX || 0;
    this.offsetY = config.offsetY || 0;
    this.flipX = false;
    this.flipY = false;
    this.alpha = 1.0;
    this.tint = null; // 颜色叠加
    
    // 九宫格方向支持（旧格式 3x3）
    this.useDirectionalSprite = config.useDirectionalSprite || false;
    
    // 新格式：4列x9行精灵图支持
    this.useAnimatedSprite = config.useAnimatedSprite || false;
    this.spriteColumns = config.spriteColumns || 4;  // 列数（动画帧数）
    this.spriteRows = config.spriteRows || 8;        // 行数（方向数）
    
    // 静态单图精灵：整张图作为一个角色立绘渲染（不分帧/不分方向）
    this.isStatic = config.isStatic || false;
    
    this.direction = config.direction || 'down'; // up, down, left, right, up-left, up-right, down-left, down-right
    
    // 旧格式方向映射（3x3）
    this.directionFrameMap = config.directionFrameMap || {
      'up-left': 0,
      'up': 1,
      'up-right': 2,
      'left': 3,
      'idle': 4,
      'down': 4,  // 默认朝下
      'right': 5,
      'down-left': 6,
      'down-right': 8
    };
    
    // 新格式方向到行的映射（4x8）
    this.directionRowMap = config.directionRowMap || {
      'down-left': 0,
      'up-right': 1,
      'up-left': 2,
      'down-right': 3,
      'left': 4,
      'right': 5,
      'up': 6,
      'down': 7,
      'idle': 7       // idle用down行
    };
    
    // 行走动画状态
    this.isWalking = false;
    this.isStopping = false;
    this.walkFrame = 0;
    this.walkFrameTime = 0;
    this.walkFrameDuration = config.walkFrameDuration || 150; // 每帧150ms
    
    // 可组合外观叠层（装备、职业轮廓等）；只保存稳定资源 ID 和相对脚底锚点。
    this.appearanceLayers = [];
    this.setAppearanceLayers(config.appearanceLayers || []);

    // 可见性
    this.visible = true;
  }

  /**
   * 替换外观叠层。叠层不拥有业务状态，只是实体外观的运行时投影。
   * @param {Array<Object>} layers
   */
  setAppearanceLayers(layers = []) {
    if (!Array.isArray(layers)) throw new TypeError('SpriteComponent.setAppearanceLayers: layers 必须是数组');
    this.appearanceLayers = layers
      .filter(layer => layer && typeof (layer.assetId || layer.imageId) === 'string')
      .map(layer => ({
        assetId: layer.assetId || layer.imageId,
        width: Number.isFinite(layer.width) && layer.width > 0 ? layer.width : this.width,
        height: Number.isFinite(layer.height) && layer.height > 0 ? layer.height : this.height,
        offsetX: Number.isFinite(layer.offsetX) ? layer.offsetX : 0,
        offsetY: Number.isFinite(layer.offsetY) ? layer.offsetY : 0,
        alpha: Number.isFinite(layer.alpha) ? Math.max(0, Math.min(1, layer.alpha)) : 1,
        visible: layer.visible !== false
      }));
    return this.appearanceLayers;
  }

  clearAppearanceLayers() {
    this.appearanceLayers = [];
  }

  /**
   * 添加动画
   * @param {string} name - 动画名称
   * @param {Object} animation - 动画数据
   * @param {number[]} animation.frames - 帧序列
   * @param {number} animation.frameRate - 帧率（帧/秒）
   * @param {boolean} animation.loop - 是否循环
   */
  addAnimation(name, animation) {
    this.animations.set(name, {
      frames: animation.frames || [0],
      frameRate: animation.frameRate || 10,
      loop: animation.loop !== undefined ? animation.loop : true,
      frameDuration: 1000 / (animation.frameRate || 10)
    });
  }

  /**
   * 播放动画
   * @param {string} name - 动画名称
   * @param {boolean} force - 是否强制重新播放
   */
  playAnimation(name, force = false) {
    // 骨骼实体：兼容转发到 SkeletonComponent.playClip（帧动画已清空，避免告警）
    if (this.isSkeleton) {
      this.skeletonDelegate?.playClip?.(name, force);
      return;
    }
    if (!this.animations.has(name)) {
      console.warn(`Animation "${name}" not found`);
      return;
    }
    
    if (this.currentAnimation !== name || force) {
      this.currentAnimation = name;
      this.frame = 0;
      this.frameTime = 0;
    }
  }

  /**
   * 更新动画
   * @param {number} deltaTime - 帧间隔时间（秒）
   */
  update(deltaTime) {
    if (!this.visible) return;

    // 骨骼实体：帧推进由 SkeletonComponent 负责（每帧毫秒转秒由 Entity 链统一）
    if (this.isSkeleton) return;

    // 转换为毫秒
    const deltaMs = deltaTime * 1000;
    
    // 4x9格式的行走动画更新
    if (this.useAnimatedSprite) {
      if (this.isWalking || this.isStopping) {
        this.walkFrameTime += deltaMs;
        if (this.walkFrameTime >= this.walkFrameDuration) {
          this.walkFrameTime -= this.walkFrameDuration;
          this.walkFrame = (this.walkFrame + 1) % this.spriteColumns;
          
          // 如果正在停止且回到第0帧，完成停止
          if (this.isStopping && this.walkFrame === 0) {
            this.isWalking = false;
            this.isStopping = false;
            this.walkFrame = 0;
            this.walkFrameTime = 0;
          }
        }
      }
      return;
    }
    
    // 旧格式动画更新
    const animation = this.animations.get(this.currentAnimation);
    if (!animation) return;
    
    this.frameTime += deltaMs;
    
    if (this.frameTime >= animation.frameDuration) {
      this.frameTime -= animation.frameDuration;
      this.frame++;
      
      if (this.frame >= animation.frames.length) {
        if (animation.loop) {
          this.frame = 0;
        } else {
          this.frame = animation.frames.length - 1;
        }
      }
    }
  }

  /**
   * 获取当前帧索引
   * @returns {number}
   */
  getCurrentFrame() {
    // 4x9格式：返回行和列信息
    if (this.useAnimatedSprite) {
      const row = this.directionRowMap[this.direction] ?? this.directionRowMap['idle'];
      const col = this.walkFrame;
      return { row, col };
    }
    
    // 旧格式：如果使用方向精灵，返回方向对应的帧
    if (this.useDirectionalSprite) {
      return this.directionFrameMap[this.direction] || this.directionFrameMap['idle'];
    }
    
    const animation = this.animations.get(this.currentAnimation);
    if (!animation) return 0;
    return animation.frames[this.frame] || 0;
  }

  /**
   * 获取4x9格式的帧信息
   * @returns {{row: number, col: number}}
   */
  getAnimatedFrame() {
    const row = this.directionRowMap[this.direction] ?? this.directionRowMap['idle'];
    const col = this.isWalking ? this.walkFrame : 0;
    return { row, col };
  }

  /**
   * 设置行走状态
   * @param {boolean} walking - 是否在行走
   */
  setWalking(walking) {
    if (walking) {
      // 开始行走时，如果之前不在走，立即切到第1帧（跳过静止帧0）
      if (!this.isWalking) {
        this.isWalking = true;
        this.walkFrame = 1;
        this.walkFrameTime = 0;
      }
    } else {
      // 停止行走：标记为停止中，让当前循环播完
      if (this.isWalking) {
        this.isStopping = true;
      }
    }
  }

  /**
   * 设置精灵方向（用于九宫格精灵）
   * @param {string} direction - 方向 (up, down, left, right, up-left, up-right, down-left, down-right)
   */
  setDirection(direction) {
    if (this.useDirectionalSprite) {
      this.direction = direction;
    }
  }

  /**
   * 根据速度向量设置方向
   * @param {number} vx - X方向速度
   * @param {number} vy - Y方向速度
   */
  setDirectionFromVelocity(vx, vy) {
    if (!this.useDirectionalSprite && !this.useAnimatedSprite) return;
    
    // 如果速度为0，停止行走
    if (vx === 0 && vy === 0) {
      this.setWalking(false);
      return;
    }
    
    // 有速度时设置行走状态
    this.setWalking(true);
    
    // 计算角度
    const angle = Math.atan2(vy, vx);
    const degrees = angle * 180 / Math.PI;
    
    // 根据角度确定方向（8方向）
    if (degrees >= -22.5 && degrees < 22.5) {
      this.direction = 'right';
    } else if (degrees >= 22.5 && degrees < 67.5) {
      this.direction = 'down-right';
    } else if (degrees >= 67.5 && degrees < 112.5) {
      this.direction = 'down';
    } else if (degrees >= 112.5 && degrees < 157.5) {
      this.direction = 'down-left';
    } else if (degrees >= 157.5 || degrees < -157.5) {
      this.direction = 'left';
    } else if (degrees >= -157.5 && degrees < -112.5) {
      this.direction = 'up-left';
    } else if (degrees >= -112.5 && degrees < -67.5) {
      this.direction = 'up';
    } else if (degrees >= -67.5 && degrees < -22.5) {
      this.direction = 'up-right';
    }
  }

  /**
   * 设置水平翻转
   * @param {boolean} flip - 是否翻转
   */
  setFlipX(flip) {
    this.flipX = flip;
  }

  /**
   * 设置垂直翻转
   * @param {boolean} flip - 是否翻转
   */
  setFlipY(flip) {
    this.flipY = flip;
  }

  /**
   * 设置透明度
   * @param {number} alpha - 透明度 (0-1)
   */
  setAlpha(alpha) {
    this.alpha = Math.max(0, Math.min(1, alpha));
  }

  /**
   * 设置颜色叠加
   * @param {string} color - 颜色值
   */
  setTint(color) {
    this.tint = color;
  }

  /**
   * 清除颜色叠加
   */
  clearTint() {
    this.tint = null;
  }

  /**
   * 显示精灵
   */
  show() {
    this.visible = true;
  }

  /**
   * 隐藏精灵
   */
  hide() {
    this.visible = false;
  }
}
