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
 * NameComponent.js
 * 名字组件 - 存储实体的显示名称
 */

import { Component } from '../Component.js';

/**
 * 名字组件
 * 用于在实体头顶显示名字
 */
export class NameComponent extends Component {
  /**
   * @param {string} name - 显示名称
   * @param {Object} options - 配置选项
   */
  constructor(name, options = {}) {
    super('name');
    this.name = name;
    this.visible = options.visible !== undefined ? options.visible : true;
    this.color = options.color || '#ffffff';
    this.fontSize = options.fontSize || 14;
    this.offsetY = options.offsetY || -10;
  }

  /**
   * 设置名字
   * @param {string} name - 新名字
   */
  setName(name) {
    this.name = name;
  }

  /**
   * 显示/隐藏名字
   * @param {boolean} visible - 是否可见
   */
  setVisible(visible) {
    this.visible = visible;
  }

  /**
   * 设置颜色
   * @param {string} color - 颜色值
   */
  setColor(color) {
    this.color = color;
  }
}
