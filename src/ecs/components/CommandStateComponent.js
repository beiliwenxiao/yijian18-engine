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

/** 攻击命令姿态（互斥；语义见 .kiro/steering/army-command-design.md §2.2）。 */
export const ARMY_STANCES = Object.freeze([
  { key: 'assault', label: '全速进攻' },
  { key: 'hold', label: '原地防守' },
  { key: 'advance', label: '缓慢推进' },
  { key: 'retreat', label: '稳步撤退' },
  { key: 'rescue', label: '抢救伤员' },
  { key: 'flee', label: '快速逃命' }
]);

/**
 * CommandStateComponent - 军团单位命令状态组件
 *
 * 记录单位的当前姿态与指挥目标，由 ArmyCommandSystem 姿态机消费：
 * - stance：当前行为姿态（6 选 1，互斥）
 * - post：驻守点（hold 姿态的锚点，姿态应用/移动下令到达时更新）
 * - goal：移动下令的临时阵型目标点（到达后清除；姿态决定途中行为）
 * - carryState：搬运状态（'carrying'=正在抬运伤员；null=未搬运，M4）
 */
export class CommandStateComponent extends Component {
  /**
   * @param {Object} [options]
   * @param {string} [options.stance] - 初始姿态（缺省 hold 原地防守）
   */
  constructor({ stance = 'hold' } = {}) {
    super('commandState');
    this.stance = ARMY_STANCES.some(entry => entry.key === stance) ? stance : 'hold';
    /** @type {{x:number,y:number}|null} 驻守点 */
    this.post = null;
    /** @type {{x:number,y:number}|null} 移动下令目标（阵型偏移点） */
    this.goal = null;
    /** @type {'carrying'|null} 搬运状态（rescue 姿态由 ArmyCommandSystem 编排） */
    this.carryState = null;
  }
}

export default CommandStateComponent;
