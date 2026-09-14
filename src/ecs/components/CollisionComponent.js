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

import { Component } from '../Component.js';

/**
 * 实体物理碰撞中心相对 Transform 脚点的偏移。
 * Transform 保持视觉、交互和存档的世界锚点；碰撞系统只使用本组件派生物理中心。
 */
export class CollisionComponent extends Component {
  constructor({ offsetX = 0, offsetY = 0 } = {}) {
    super('collision');
    this.offsetX = Number.isFinite(offsetX) ? offsetX : 0;
    this.offsetY = Number.isFinite(offsetY) ? offsetY : 0;
  }
}
