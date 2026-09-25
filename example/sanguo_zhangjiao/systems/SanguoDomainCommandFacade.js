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

const asResult = value => value === false || value == null ? { ok: false, code: 'facadeRejected' } : value;

/**
 * 《三国张角传》历史编排 Facade。
 * Trigger 只提交 canonical descriptor；此 Facade 只按通用 command type 和稳定
 * definition ID 转发到既有 Transaction Service/coordinator，不保存业务状态、
 * 不生成 operationId，也不以 SXX/content operation 名称选择处理器。
 */
export class SanguoDomainCommandFacade {
  constructor(scene) {
    if (!scene) throw new TypeError('SanguoDomainCommandFacade requires scene');
    this.scene = scene;
    const routes = [
      ['scenario.command', 'campfire.ignite', () => scene._campfireService.ignite({ runtime: { particleSystem: scene.particleSystem } })],
      ['scenario.command', 'class.confirm', p => scene._showClassConfirmation(p)],
      ['scenario.command', 'class.select', (p, context) => scene.s09ClassSelectionCoordinator.selectClass({
        ...p, operationId: context.operationId
      })],
      ['scenario.command', 'yuzhou.travel', () => scene.s03s08Coordinator.travelToS03()],
      ['scenario.command', 'route.choose', () => scene.s03s08Coordinator.openS04RouteChoice()],
      ['scenario.command', 'mine.prepare', () => scene.s05SceneCoordinator.prepareS05Mine()],
      ['scenario.command', 'mine.status', () => scene.s05SceneCoordinator.showS05MineStatus()],
      ['scenario.command', 'mine.retreat', () => scene.s05SceneCoordinator.completeS05MineRetreat()],
      ['scenario.command', 'defense.choose', () => scene.s06SceneCoordinator.openS06DefenseChoice()],
      ['scenario.command', 'recall.s06', () => scene.s06SceneCoordinator.completeS06Recall()],
      ['scenario.command', 'delay.commit', p => scene.s07s08Coordinator.commitS07DelayPoint(p)],
      ['scenario.command', 'retreat.choose', () => scene.s07s08Coordinator.openS08RetreatChoice()],
      ['scenario.command', 'recall.s08', () => scene.s07s08Coordinator.completeS08Recall()],
      ['scenario.command', 'story.death', () => scene.s10StoryCoordinator.commitS10ZhangJiaoDeath()],
      ['scenario.command', 'camp.inspect', () => scene.s10StoryCoordinator.acknowledgeS10TemporaryCamp()],
      ['scenario.command', 'camp.relocate', () => scene.s10StoryCoordinator.completeS10CampRelocation()],
      ['scenario.command', 'exit.s03', () => scene.s03s08Coordinator.checkS03Exit()],
      ['scenario.command', 'exit.s05', () => scene.s05SceneCoordinator.checkS05Exit()],
      ['scenario.command', 'exit.s07', p => scene.s07s08Coordinator.checkS07Exit(p)],
      ['scenario.command', 'exit.s10', () => scene.s10ConstructionCoordinator.checkS10Exit()],
      ['scenario.command', 'exit.s11', () => scene.s11s14SceneCoordinator.checkS11Exit()],
      ['scenario.command', 'exit.s12', () => scene.s11s14SceneCoordinator.advancePostRescueRoute()],
      ['scenario.command', 'exit.s13', () => scene.s11s14SceneCoordinator.checkS13Exit()],
      ['battle.command', 'battle.open.s03', () => scene.s03s14BattleCoordinator.open('S03')],
      ['battle.command', 'battle.open.s04', () => scene.s03s14BattleCoordinator.open('S04')],
      ['battle.command', 'battle.open.s05', () => scene.s03s14BattleCoordinator.open('S05')],
      ['battle.command', 'battle.open.s07', () => scene.s03s14BattleCoordinator.open('S07')],
      ['battle.command', 'battle.open.s11', () => scene.s03s14BattleCoordinator.open('S11')],
      ['battle.command', 'battle.open.s12', () => scene.s03s14BattleCoordinator.open('S12')],
      ['battle.command', 'battle.open.s13', () => scene.s03s14BattleCoordinator.open('S13')],
      ['rescue.command', 'rescue.start.s04', () => scene.s03s08Coordinator.startS04BocaiRescue()],
      ['rescue.command', 'rescue.advance.s04', () => scene.s03s08Coordinator.completeS04BocaiEvacuation()],
      ['rescue.command', 'rescue.start.s05', () => scene.s05SceneCoordinator.startS05ZhangManchengRescue()],
      ['scenario.command', 'army.rescue.faint', () => scene.s02ArmyRescueCoordinator.faint()],
      ['scenario.command', 'army.rescue.begin', p => scene.s02ArmyRescueCoordinator.beginArmyRescue(p)],
      ['scenario.command', 'army.rescue.awaken', () => scene.s02ArmyRescueCoordinator.awakenFromRescue()],
      ['construction.command', 'construction.start.s01', p => scene._s01s02Coordinator.startShelterConstruction(p)],
      ['construction.command', 'construction.start.s06', p => scene.s06SceneCoordinator.startS06FieldConstruction(p)],
      ['construction.command', 'construction.start.s10', p => scene.s10ConstructionCoordinator.startS10Construction(p)]
    ];
    this.routes = new Map(routes.map(([commandType, operation, handler]) => [`${commandType}:${operation}`, handler]));
  }

  execute({ commandType, payload = {}, operationId = null } = {}) {
    const context = { operationId };
    const coordinator = this.scene.s11s14SceneCoordinator;
    if (commandType === 'rescue.command' && coordinator?.executeRescueCommand
      && !this.routes.has(`${commandType}:${payload.operation}`)) {
      return Promise.resolve(coordinator.executeRescueCommand(payload)).then(asResult);
    }
    if (commandType === 'vehicle.command' && coordinator?.executeVehicleCommand) {
      return Promise.resolve(coordinator.executeVehicleCommand(payload)).then(asResult);
    }
    if (commandType === 'ending.command' && coordinator?.executeEndingCommand) {
      return Promise.resolve(coordinator.executeEndingCommand(payload)).then(asResult);
    }
    const route = this.routes.get(`${commandType}:${payload.operation}`);
    if (!route) return { ok: false, code: 'unknownCanonicalOperation', operation: payload.operation };
    return Promise.resolve(route(payload, context)).then(asResult);
  }
}

export default SanguoDomainCommandFacade;