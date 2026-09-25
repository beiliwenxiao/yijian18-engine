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
 * SquadMemberComponent - 军团分队成员组件
 *
 * 标记一个实体属于某支军队（Army）的某个分队（Squad：前/后/左/中/右军）。
 * 由 ArmyCommandSystem 消费：编组选择、阵型移动下令、命令倒计时。
 * 生成来源：场景 placement（kind:'soldier'，见 PlacementSpawner）。
 */
export class SquadMemberComponent extends Component {
  /**
   * @param {Object} [options]
   * @param {string} [options.armyId] - 所属军队定义 ID（如 army.s02.guard）
   * @param {string} [options.squadId] - 分队 ID（qian/hou/zuo/zhong/you）
   * @param {number} [options.formationIndex] - 分队内阵型序号（同队相邻排序用）
   */
  constructor({ armyId = '', squadId = '', formationIndex = 0 } = {}) {
    super('squadMember');
    this.armyId = armyId;
    this.squadId = squadId;
    this.formationIndex = Math.max(0, Math.floor(Number(formationIndex) || 0));
  }
}

export default SquadMemberComponent;
