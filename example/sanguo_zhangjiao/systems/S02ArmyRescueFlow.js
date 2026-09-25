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

/**
 * S02ArmyRescueCoordinator - S02 废弃营地「山道救援」流程协调器（M4）
 *
 * 剧情编排归任务中心（触发器/对话/quest 数据），本协调器只承接
 * scenario.command 的军团救援操作（见 SanguoDomainCommandFacade 路由）：
 * - army.rescue.faint  —— 主角昏倒：置位倒地状态（禁用玩家操作，等待剧情裁决）
 * - army.rescue.begin  —— 张角选择「救他」：注册搬运目标与救援目标点，
 *                          开放军团指挥玩法（ArmyCommandSystem 搬运编排）
 * - army.rescue.awaken —— 伤者被抬回营地触发区：解除倒地状态，衔接苏醒过场
 *
 * 搬运完成由 ArmyCommandSystem.onRescueComplete 回调驱动本类触发
 * enterRegion 剧情事件（regionId 归触发器数据所有）。
 */
export class S02ArmyRescueCoordinator {
  constructor(scene) {
    if (!scene) throw new TypeError('S02ArmyRescueCoordinator requires scene');
    this.scene = scene;
    this._regionId = null;
    this._active = false;
  }

  /** 主角昏倒：置位倒地状态（对话锁输入之外的长效操作禁用）并开启剧情保护（敌人停止索敌）。 */
  faint() {
    const scene = this.scene;
    scene.playerDowned = true;
    const player = scene.playerEntity;
    if (player) player.plotDowned = true;
    const movement = player?.getComponent?.('movement');
    if (movement) movement.velocity = { x: 0, y: 0 };
    player?.getComponent?.('sprite')?.playAnimation?.('idle');
    return { ok: true };
  }

  /**
   * 开始救援搬运：注册倒地主角为搬运目标，开放军团指挥玩法。
   * @param {{regionId?: string, goalX?: number, goalY?: number}} params
   */
  beginArmyRescue({ regionId = null, goalX = null, goalY = null } = {}) {
    const scene = this.scene;
    const player = scene.playerEntity;
    if (!player) return { ok: false, code: 'playerUnavailable' };
    if (this._active) return { ok: true, idempotent: true };
    const system = scene.armyCommandFlow?.system;
    if (!system) return { ok: false, code: 'armyCommandUnavailable' };
    this._active = true;
    this._regionId = regionId || null;
    scene.playerDowned = true;
    if (player) player.plotDowned = true;
    const movement = player.getComponent?.('movement');
    if (movement) movement.velocity = { x: 0, y: 0 };
    // goal 是场景本地坐标（触发器数据），必须先投影到世界坐标再交给搬运逻辑，
    // 否则 _updateRescueMission 会以本地坐标对比世界坐标，拖动方向与距离全错。
    let goal = null;
    if (Number.isFinite(Number(goalX)) && Number.isFinite(Number(goalY))) {
      const offset = scene._worldLoadResult?.worldIndex?.getOffset?.(scene.currentSceneId) || { x: 0, y: 0 };
      goal = { x: Number(goalX) + (offset.x || 0), y: Number(goalY) + (offset.y || 0) };
    }
    system.setRescueTarget(player, { goal, regionId: this._regionId });
    system.onRescueComplete = payload => this._handleRescueComplete(payload);
    system.onRescueInterrupt = payload => this._handleRescueInterrupt(payload);
    scene._showScreenTip?.(
      '选中士兵（框选/编组条）后下达「抢救伤员」，他们会把伤者抬回营地。',
      { title: '军团指挥' }
    );
    return { ok: true, regionId: this._regionId, goal };
  }

  /** 苏醒：解除倒地状态（含剧情保护）并清理搬运任务（剧情链由触发器数据继续）。 */
  awakenFromRescue() {
    const scene = this.scene;
    scene.playerDowned = false;
    if (scene.playerEntity) scene.playerEntity.plotDowned = false;
    scene.armyCommandFlow?.system?.clearRescueTarget?.();
    this._active = false;
    return { ok: true };
  }

  /** 搬运完成：触发 enterRegion 剧情事件（苏醒触发区由触发器数据接手）。 */
  _handleRescueComplete(payload = {}) {
    const scene = this.scene;
    this._active = false;
    const regionId = payload.regionId || this._regionId;
    scene._showScreenTip?.('士兵们把伤者抬回了营地。', { title: '救援' });
    if (!regionId) return;
    scene.gameLoader?.triggerSystem?.fire?.('enterRegion', { regionId });
  }

  /** 搬运中断（遇敌）：提示放下伤员迎战，战后需重新下令（§2.3 裁定）。 */
  _handleRescueInterrupt() {
    this.scene._showScreenTip?.(
      '遭遇敌人！士兵放下伤员迎战；战斗结束后需重新下达「抢救伤员」继续搬运。',
      { title: '搬运中断' }
    );
  }
}

export default S02ArmyRescueCoordinator;
