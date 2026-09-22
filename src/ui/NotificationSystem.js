/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-02-10
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

import { UIElement } from './UIElement.js';
import { InputHints } from '../core/input/InputHints.js';

/**
 * 通知消息类
 */
class Notification {
  /**
   * @param {string} message - 消息内容
   * @param {string} type - 消息类型 (info, success, warning, error)
   * @param {number} duration - 显示时长（毫秒）
   */
  constructor(message, type = 'info', duration = 3000) {
    this.message = message;
    this.type = type;
    this.duration = duration;
    this.elapsed = 0;
    this.alpha = 0; // 用于淡入淡出动画
    this.state = 'fadein'; // fadein, show, fadeout, done
  }

  /**
   * 更新通知状态
   * @param {number} deltaTime - 帧间隔时间（毫秒）
   */
  update(deltaTime) {
    this.elapsed += deltaTime;

    const fadeTime = 300; // 淡入淡出时间（毫秒）

    if (this.state === 'fadein') {
      this.alpha = Math.min(1, this.elapsed / fadeTime);
      if (this.alpha >= 1) {
        this.state = 'show';
        this.elapsed = 0;
      }
    } else if (this.state === 'show') {
      this.alpha = 1;
      if (this.elapsed >= this.duration - fadeTime) {
        this.state = 'fadeout';
        this.elapsed = 0;
      }
    } else if (this.state === 'fadeout') {
      this.alpha = Math.max(0, 1 - this.elapsed / fadeTime);
      if (this.alpha <= 0) {
        this.state = 'done';
      }
    }
  }

  /**
   * 检查通知是否完成
   * @returns {boolean}
   */
  isDone() {
    return this.state === 'done';
  }

  /**
   * 获取颜色
   * @returns {string}
   */
  getColor() {
    switch (this.type) {
      case 'success':
        return '#00ff00';
      case 'warning':
        return '#ffaa00';
      case 'error':
        return '#ff0000';
      case 'exp':
        return '#ffff00';
      case 'levelup':
        return '#ff00ff';
      default:
        return '#ffffff';
    }
  }
}

/**
 * 通知系统
 * 管理和显示游戏通知消息
 */
export class NotificationSystem extends UIElement {
  /**
   * @param {Object} options - 配置选项
   * @param {number} [options.maxNotifications=5] - 最大同时显示的通知数量
   * @param {number} [options.notificationHeight=30] - 单个通知的高度
   * @param {number} [options.notificationSpacing=5] - 通知之间的间距
   * @param {string} [options.backgroundColor='rgba(0, 0, 0, 0.8)'] - 背景颜色
   */
  constructor(options = {}) {
    super(options);
    
    this.maxNotifications = options.maxNotifications || 5;
    this.notificationHeight = options.notificationHeight || 30;
    this.notificationSpacing = options.notificationSpacing || 5;
    this.backgroundColor = options.backgroundColor || 'rgba(0, 0, 0, 0.8)';
    // 底锚：设置后通知贴在该 y（底边）上方堆叠，最新一条最靠下；未设置时维持从 this.y 向下的旧行为
    this.anchorBottom = options.anchorBottom ?? null;
    
    this.notifications = [];
    this.padding = 10;
    
    // 设置zIndex较高，确保在其他UI之上
    this.zIndex = 30;
  }

  /**
   * 添加通知
   * @param {string} message - 消息内容
   * @param {string} [type='info'] - 消息类型
   * @param {number} [duration=3000] - 显示时长（毫秒）
   */
  addNotification(message, type = 'info', duration = 3000) {
    // 支持 {bag}、{key:pickup} 等按键占位符（Canvas 渲染，用纯文本版替换）
    const notification = new Notification(InputHints.format(message), type, duration);
    this.notifications.push(notification);

    // 限制通知数量
    if (this.notifications.length > this.maxNotifications) {
      this.notifications.shift();
    }
  }

  /**
   * 添加经验值通知
   * @param {number} exp - 获得的经验值
   */
  addExpNotification(exp) {
    this.addNotification(`获得 ${exp} 点经验`, 'exp', 2000);
  }

  /**
   * 添加升级通知
   * @param {number} level - 新等级
   */
  addLevelUpNotification(level) {
    this.addNotification(`等级提升！当前 ${level} 级`, 'levelup', 4000);
  }

  /**
   * 添加成功通知
   * @param {string} message - 消息内容
   */
  addSuccess(message) {
    this.addNotification(message, 'success', 3000);
  }

  /**
   * 添加警告通知
   * @param {string} message - 消息内容
   */
  addWarning(message) {
    this.addNotification(message, 'warning', 3000);
  }

  /**
   * 添加错误通知
   * @param {string} message - 消息内容
   */
  addError(message) {
    this.addNotification(message, 'error', 4000);
  }

  /**
   * 清空所有通知
   */
  clear() {
    this.notifications = [];
  }

  /**
   * 更新通知系统
   * @param {number} deltaTime - 帧间隔时间（毫秒）
   */
  update(deltaTime) {
    // 更新所有通知
    for (const notification of this.notifications) {
      notification.update(deltaTime);
    }

    // 移除已完成的通知
    this.notifications = this.notifications.filter(n => !n.isDone());
  }

  /**
   * 渲染通知系统
   * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
   */
  render(ctx) {
    if (!this.visible || this.notifications.length === 0) return;

    ctx.save();

    // 底锚模式：最新通知最靠近底边，向上生长；否则从 this.y 向下堆叠（旧行为）
    const rowPitch = this.notificationHeight + this.notificationSpacing;
    const firstY = this.anchorBottom != null
      ? this.anchorBottom - this.notifications.length * rowPitch + this.notificationSpacing
      : this.y;

    // 从上到下渲染通知
    for (let i = 0; i < this.notifications.length; i++) {
      const notification = this.notifications[i];
      const y = firstY + i * rowPitch;

      this.renderNotification(ctx, notification, this.x, y);
    }

    ctx.restore();
  }

  /**
   * 渲染单个通知
   * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
   * @param {Notification} notification - 通知对象
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   */
  renderNotification(ctx, notification, x, y) {
    // 应用透明度
    ctx.globalAlpha = notification.alpha;

    // 测量文字宽度
    ctx.font = '14px Arial';
    const textWidth = ctx.measureText(notification.message).width;
    const boxWidth = textWidth + this.padding * 2;

    // 绘制背景
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(x, y, boxWidth, this.notificationHeight);

    // 绘制边框
    ctx.strokeStyle = notification.getColor();
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, boxWidth, this.notificationHeight);

    // 绘制文字
    ctx.fillStyle = notification.getColor();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      notification.message,
      x + this.padding,
      y + this.notificationHeight / 2
    );

    ctx.globalAlpha = 1;
  }

  /**
   * 获取当前通知数量
   * @returns {number}
   */
  getNotificationCount() {
    return this.notifications.length;
  }

  /**
   * 检查是否有通知
   * @returns {boolean}
   */
  hasNotifications() {
    return this.notifications.length > 0;
  }
}
