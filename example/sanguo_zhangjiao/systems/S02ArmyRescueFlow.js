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
 *                          开放担架载具玩法（ArmyCommandSystem 搬运编排：
 *                          士兵走近伤员触发框自动挂载，玩家驾驶担架回营地）
 * - army.rescue.awaken —— 伤者被抬回营地触发区：解除倒地状态，衔接苏醒过场
 * - army.march         —— 军团剧情行军（M2 军队路过）：沿触发器给的场景局部
 *                          路径点行军入画，到点停并 fire armyMarchArrived 剧情事件
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
    // 离散动作接线：平躺待搬运（循环剪辑保持，苏醒时切回）
    player?.getComponent?.('sprite')?.playAnimation?.('stretcher');
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
    // 担架载具：挂载=伤员登上担架接管移动（玩家驾驶组合体）；解散=伤员重新倒地等待再挂载
    system.onCarryStart = () => this._handleCarryStart();
    system.onCarryEnd = () => this._handleCarryEnd();
    scene._showScreenTip?.(
      '指挥士兵走近伤员周围的触发框，两人将自动抬起担架；随后由你亲自驾驶担架返回营地。',
      { title: '军团指挥' }
    );
    return { ok: true, regionId: this._regionId, goal };
  }

  /** 担架挂载：两名士兵成为「载具」，伤员恢复移动输入亲自驾驶组合体。 */
  _handleCarryStart() {
    const scene = this.scene;
    scene.playerDowned = false;
    const player = scene.playerEntity;
    if (player) player.plotDowned = false;
    scene._showScreenTip?.('担架已就位：用 WASD 抬着伤员返回营地。', { title: '担架载具' });
  }

  /** 担架解散（遇敌/担架兵折损）：伤员重新倒地，等待士兵重新走近触发框。 */
  _handleCarryEnd() {
    const scene = this.scene;
    scene.playerDowned = true;
    const player = scene.playerEntity;
    if (player) {
      player.plotDowned = true;
      const movement = player.getComponent?.('movement');
      if (movement && movement.velocity) movement.velocity = { x: 0, y: 0 };
    }
  }

  /** 苏醒：解除倒地状态（含剧情保护）并清理搬运任务（剧情链由触发器数据继续）。 */
  awakenFromRescue() {
    const scene = this.scene;
    scene.playerDowned = false;
    if (scene.playerEntity) {
      scene.playerEntity.plotDowned = false;
      // 离散动作接线：苏醒起立（释放 stretcher 循环 hold）
      scene.playerEntity.getComponent?.('sprite')?.playAnimation?.('idle');
    }
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

  /** 搬运中断（遇敌）：放下伤员迎战，士兵走近伤员触发框后自动重新挂载（§担架载具）。 */
  _handleRescueInterrupt() {
    this.scene._showScreenTip?.(
      '遭遇敌人！担架解散，士兵放下伤员迎战；战斗结束后走近伤员即可重新抬起担架。',
      { title: '搬运中断' }
    );
  }

  /**
   * 军团剧情行军（army.march）：沿路径点行军入画，到点停。
   * waypoints 为场景局部坐标（触发器数据），此处投影到世界坐标后交给
   * ArmyCommandSystem 剧情行军原语；抵达终点后 fire armyMarchArrived
   * 剧情事件（prologue 等后续链由触发器数据接管）。
   * @param {{armyId?: string, waypoints?: Array<{x:number,y:number}>}} params
   */
  marchArmy({ armyId = '', waypoints = [] } = {}) {
    const scene = this.scene;
    const system = scene.armyCommandFlow?.system;
    if (!system?.startMarch) return { ok: false, code: 'armyCommandUnavailable' };
    const offset = scene._worldLoadResult?.worldIndex?.getOffset?.(scene.currentSceneId) || { x: 0, y: 0 };
    const worldWaypoints = (Array.isArray(waypoints) ? waypoints : [])
      .filter(point => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)))
      .map(point => ({ x: Number(point.x) + (offset.x || 0), y: Number(point.y) + (offset.y || 0) }));
    const result = system.startMarch({ armyId, waypoints: worldWaypoints });
    if (result.ok) {
      system.onMarchComplete = payload => {
        try {
          scene.gameLoader?.triggerSystem?.fire?.('armyMarchArrived', {
            armyId: payload?.armyId || armyId
          });
        } catch (error) {
          console.warn('[S02ArmyRescueCoordinator] armyMarchArrived fire failed', error?.message || error);
        }
      };
    }
    return result;
  }

  // ─── M3 扎营 + 操控张角（possession） ─────────────────────────────────────

  /** 扎营作业进行中（幂等防重入）。 */
  _campActive = false;
  /** possession 激活状态（{protagonist, zhangjiao}；null=未附身）。 */
  _possession = null;

  /**
   * 军团扎营（army.camp）：全军切原地防守 → 环绕营地倒计时施工 →
   * 完成后 fire armyCampLaid 剧情事件（装饰生成/事实提交/围剿预警由触发器数据接管）。
   * @param {{x?: number, y?: number}} [params] - 营地坐标（场景局部，缺省玩家脚下）
   */
  campArmy({ x = null, y = null } = {}) {
    const scene = this.scene;
    const system = scene.armyCommandFlow?.system;
    if (!system?.startConstruction) return { ok: false, code: 'armyCommandUnavailable' };
    if (this._campActive) return { ok: true, idempotent: true };
    const units = [...system.units.values()]
      .map(unit => unit.entity)
      .filter(entity => entity && entity.isDead !== true && entity.isDying !== true);
    if (!units.length) return { ok: false, code: 'noUnits' };
    let pos = null;
    if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
      const offset = scene._worldLoadResult?.worldIndex?.getOffset?.(scene.currentSceneId) || { x: 0, y: 0 };
      pos = { x: Number(x) + (offset.x || 0), y: Number(y) + (offset.y || 0) };
    } else {
      const transform = scene.playerEntity?.getComponent?.('transform');
      pos = transform ? { x: transform.position.x, y: transform.position.y } : { x: 0, y: 0 };
    }
    // 扎营 = 原地防守语义：全军切 hold、驻点记营地中心（剧情直改命令状态，不借玩家选择槽）
    for (const entity of units) {
      const command = entity.getComponent?.('commandState');
      if (!command) continue;
      command.stance = 'hold';
      command.post = { x: pos.x, y: pos.y };
      command.goal = null;
    }
    this._campActive = true;
    const result = system.startConstruction('camp', pos, units);
    if (!result.ok) {
      this._campActive = false;
      return result;
    }
    system.onConstructionComplete = (commandKey, builtPos) => {
      if (commandKey !== 'camp') return;
      this._campActive = false;
      scene._showScreenTip?.('营地扎立完成：篝火燃起，全军就地驻守。', { title: '扎营' });
      try {
        scene.gameLoader?.triggerSystem?.fire?.('armyCampLaid', { x: builtPos?.x, y: builtPos?.y });
      } catch (error) {
        console.warn('[S02ArmyRescueCoordinator] armyCampLaid fire failed', error?.message || error);
      }
    };
    return { ok: true, count: units.length, pos };
  }

  /**
   * 附身张角（army.possess）：玩家操控实体从主角切到大贤良师。
   * bindPlayer 总绑定原语一次切换 playerEntity/相机/战斗/移动/背包/底栏/状态 HUD，
   * 近战系统单独补绑；主角置 plotDowned 观战（碰撞跳过 + AI 索敌免疫，不播倒地动画）。
   */
  possessCommander() {
    const scene = this.scene;
    if (this._possession) return { ok: true, idempotent: true };
    const protagonist = scene.context?.player?.entity || scene.playerEntity;
    if (!protagonist) return { ok: false, code: 'playerUnavailable' };
    const layout = scene.context?.ui?.layout;
    if (!layout?.bindPlayer) return { ok: false, code: 'panelLayoutUnavailable' };
    const zhangjiao = this._ensureZhangjiaoEntity(protagonist);
    if (!zhangjiao) return { ok: false, code: 'zhangjiaoCreateFailed' };
    // 主角退观战：plotDowned 提供碰撞跳过与 AI 索敌免疫（isTargetDead 过滤 plotDowned）
    protagonist.plotDowned = true;
    const movement = protagonist.getComponent?.('movement');
    if (movement?.velocity) {
      movement.velocity.x = 0;
      movement.velocity.y = 0;
    }
    layout.bindPlayer(zhangjiao, { syncCameraPosition: true, log: false });
    scene.meleeAttackSystem?.setPlayerEntity?.(zhangjiao);
    this._possession = { protagonist, zhangjiao };
    scene._possessionActive = true;
    const transform = zhangjiao.getComponent?.('transform');
    scene.floatingTextManager?.add?.({
      x: transform?.position?.x || 0,
      y: (transform?.position?.y || 0) - 70,
      text: '大贤良师 张角',
      fontSize: 16,
      duration: 2000,
      velocity: { x: 0, y: -22 },
      fadeStart: 1200
    });
    scene._showScreenTip?.('你已化身为大贤良师张角，指挥全军迎敌！（WASD 移动 · 军团指挥照常可用）', { title: '附身' });
    return { ok: true };
  }

  /** 解除附身（army.possess.release）：绑定还原主角，张角实体留驻营地。 */
  releaseCommander() {
    const scene = this.scene;
    if (!this._possession) return { ok: true, idempotent: true };
    const { protagonist, zhangjiao } = this._possession;
    const layout = scene.context?.ui?.layout;
    if (protagonist) {
      protagonist.plotDowned = false;
      layout?.bindPlayer?.(protagonist, { syncCameraPosition: true, log: false });
      scene.meleeAttackSystem?.setPlayerEntity?.(protagonist);
    }
    // 张角留驻营地（M4 行军段复用；兵败重开时 _ensureZhangjiaoEntity 幂等重建）
    if (zhangjiao) {
      const movement = zhangjiao.getComponent?.('movement');
      if (movement?.velocity) {
        movement.velocity.x = 0;
        movement.velocity.y = 0;
      }
      zhangjiao.getComponent?.('sprite')?.playAnimation?.('idle');
    }
    this._possession = null;
    scene._possessionActive = false;
    return { ok: true };
  }

  /**
   * 兵败溃退（army.raid.defeat）：官军去而复返前清场——两波敌 placement 写
   * 带 refreshAt 的墓碑（到期释放重新可生成），张角/全军回满血，全军收拢回营。
   * 复活位置与昏迷结算由 PlayerDefeatService 特殊昏迷链负责（触发器走兵败旁白）。
   * @param {{regroupX?: number, regroupY?: number}} [params] - 全军收拢点（场景局部）
   */
  handleRaidDefeat({ regroupX = null, regroupY = null } = {}) {
    const scene = this.scene;
    const runtime = scene.context?.services?.placements || null;
    if (runtime) {
      const raidPlacements = (runtime.placements || []).filter(placement => (
        placement?.group === 'S02-raid-vanguard' || placement?.group === 'S02-raid-mainforce'
      ));
      const refreshAt = Date.now() + 7000; // 7 秒后墓碑释放，触发器 wait 8s 后重刷前锋
      for (const placement of raidPlacements) {
        runtime.tombstonePlacement?.(placement.id, { reason: 'raidDefeat', refreshAt });
      }
    }
    const system = scene.armyCommandFlow?.system;
    if (system) {
      for (const unit of system.units.values()) {
        const entity = unit.entity;
        if (!entity || entity.isDead === true || entity.isDying === true) continue;
        const stats = entity.getComponent?.('stats');
        if (stats) stats.hp = stats.maxHp;
      }
      // 全军收拢回营地中心（场景局部坐标 → 世界）
      if (Number.isFinite(Number(regroupX)) && Number.isFinite(Number(regroupY))) {
        const offset = scene._worldLoadResult?.worldIndex?.getOffset?.(scene.currentSceneId) || { x: 0, y: 0 };
        const goal = { x: Number(regroupX) + (offset.x || 0), y: Number(regroupY) + (offset.y || 0) };
        for (const unit of system.units.values()) {
          const command = unit.entity?.getComponent?.('commandState');
          if (!command) continue;
          command.goal = { ...goal };
          command.post = { ...goal };
        }
      }
    }
    // 张角回满血（昏迷结算 revivePlayer 已复活；这里兜底满状态整军再战）
    const zhangjiao = this._possession?.zhangjiao || scene.playerEntity;
    const zStats = zhangjiao?.getComponent?.('stats');
    if (zStats) zStats.hp = zStats.maxHp;
    scene._showScreenTip?.('整军再战：官军暂时退去，稍候将卷土重来。', { title: '兵败溃退' });
    return { ok: true };
  }

  /**
   * 惰性创建（或复用）附身用张角玩家形实体：静态方向图 + 玩家全套组件，
   * 加入场景实体集后由全系统（渲染/碰撞/AI）正常对待。
   */
  _ensureZhangjiaoEntity(protagonist) {
    const scene = this.scene;
    // 实体级缓存（独立于 _possession）：release 后留驻营地，再附身复用同一实体
    if (this._zhangjiaoEntity && this._zhangjiaoEntity.isDead !== true && this._zhangjiaoEntity.isDying !== true) {
      return this._zhangjiaoEntity;
    }
    if (!scene.entityFactory?.createPlayer) return null;
    const anchor = protagonist?.getComponent?.('transform')?.position || { x: 420, y: 330 };
    const zhangjiao = scene.entityFactory.createPlayer({
      id: 'zhangjiao-possessed',
      name: '张角',
      class: 'strategist',
      spriteSheet: 's09.character.zhangjiao',
      spriteConfig: {
        isStatic: true,
        width: 64,
        height: 88
      },
      level: 3,
      position: { x: anchor.x + 48, y: anchor.y + 16 },
      stats: {
        maxHp: 120,
        hp: 120,
        maxMp: 100,
        mp: 100,
        attack: 10,
        defense: 4,
        speed: 100
      },
      equipment: {},
      inventorySlots: 8,
      inventory: []
    });
    if (!zhangjiao) return null;
    // 椭碰撞规格与主角同源（presentationProfile.actors.player，DemoPlayerFactory.configurePlayer）
    scene._playerFactory?.configurePlayer?.(scene, zhangjiao);
    zhangjiao.name = '张角';
    scene.context?.entities?.add?.(zhangjiao);
    this._zhangjiaoEntity = zhangjiao;
    return zhangjiao;
  }
}

export default S02ArmyRescueCoordinator;
