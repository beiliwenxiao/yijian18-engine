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

import { CollisionComponent } from '../../../src/ecs/components/CollisionComponent.js';
import { SelectedCharacterStore } from '../data/SelectedCharacterStore.js';

function createDefaultSkills() {
  // 新战役开局不再注入旧六幕的火焰/寒冰/治疗技能。
  // 职业确认后由 EffectResolver + SkillRegistry 投影 canonical 技能。
  return [];
}

const CLASS_APPEARANCE_LAYERS = Object.freeze({
  warrior: Object.freeze([{ assetId: 'player.appearance.class.warrior', width: 72, height: 72, offsetY: 2 }]),
  archer: Object.freeze([{ assetId: 'player.appearance.class.archer', width: 76, height: 72, offsetY: 2 }]),
  strategist: Object.freeze([{ assetId: 'player.appearance.class.strategist', width: 72, height: 78, offsetY: 2 }])
});

/** 张角 Demo 玩家内容工厂；底层 ECS 创建仍委托框架 EntityFactory。 */
export class DemoPlayerFactory {
  create(scene, { x = 420, y = 330 } = {}) {
    const selected = SelectedCharacterStore.get();
    this._loadSelectedAsset(scene, selected);
    const actorProfile = scene.presentationProfile?.actors;
    const visual = actorProfile?.player?.visual || { width: 64, height: 64 };
    const directionMode = actorProfile?.directionMode === 4 ? 4 : 8;
    const directionConfig = directionMode === 4 ? {
      spriteRows: 4,
      directionRowMap: { down: 0, left: 1, right: 2, up: 3, idle: 0 }
    } : { spriteRows: 8 };

    const player = scene.entityFactory.createPlayer({
      // 成长、存档和效果来源都以角色配置 ID 为键，不能使用每次创建都会变化的实体 ID。
      id: selected?.id || 'refugee',
      name: selected?.name || '玩家',
      class: selected?.class || 'refugee',
      spriteSheet: selected?.spriteSheet,
      spriteConfig: {
        // 角色配置只补充资源布局；游戏级表现规格最后覆盖尺寸和方向权威。
        ...(selected?.spriteConfig || {}),
        ...directionConfig,
        width: visual.width,
        height: visual.height
      },
      level: 1,
      position: { x, y },
      stats: {
        // 新角色开局资源保持紧张；后续由成长、装备与剧情奖励提升上限。
        maxHp: 100,
        hp: 10,
        maxMp: 100,
        mp: 10,
        attack: 0,
        defense: 0,
        // 显式基础移动速度（世界单位/秒）。旧值 0 会被 EntityFactory 的 `|| 100` 兜底，
        // 视口改为跟随窗口后视野更大，需要更高速度才不显得拖沓。
        speed: 100
      },
      skills: createDefaultSkills(),
      equipment: {},
      // S01 默认背包固定显示 6×4 格；容量规则仍由 InventoryComponent 管理。
      inventorySlots: 24,
      inventory: []
    });
    this.configurePlayer(scene, player);

    const sprite = player.getComponent('sprite');
    console.log('BaseGameScene: 玩家精灵组件', {
      spriteSheet: sprite?.spriteSheet,
      useDirectionalSprite: sprite?.useDirectionalSprite,
      direction: sprite?.direction,
      width: sprite?.width,
      height: sprite?.height
    });

    console.log('BaseGameScene: 创建玩家实体', player);
    return player;
  }

  /** 将表现规格投影到新建或跨场景继承的玩家，不改变 Transform 世界锚点。 */
  configurePlayer(scene, player) {
    const actor = scene.presentationProfile?.actors?.player;
    const offsetX = Number(actor?.collisionOffset?.offsetX) || 0;
    const offsetY = Number(actor?.collisionOffset?.offsetY) || 0;
    const radiusX = Number(actor?.collisionEllipse?.radiusX) || null;
    const radiusY = Number(actor?.collisionEllipse?.radiusY) || null;
    const collision = player?.getComponent?.('collision');
    if (collision) {
      collision.offsetX = offsetX;
      collision.offsetY = offsetY;
      collision.radiusX = radiusX;
      collision.radiusY = radiusY;
      return player;
    }
    player.addComponent(new CollisionComponent({ offsetX, offsetY, radiusX, radiusY }));
    return player;
  }

  /**
   * 将 canonical 职业投影为玩家基础动画之上的可替换外观叠层。
   * 领域事实仍由 ClassSystem/StoryState 持有，SpriteComponent 只持表现引用。
   */
  applyClassAppearance(scene, player, classId) {
    const sprite = player?.getComponent?.('sprite');
    if (!sprite?.setAppearanceLayers) return false;
    const layers = CLASS_APPEARANCE_LAYERS[classId] || [];
    sprite.setAppearanceLayers(layers);
    scene?.entityRenderer2D?.clearCaches?.();
    return layers.length > 0;
  }

  _loadSelectedAsset(scene, selected) {
    if (!selected?.assetImage || !scene.assetManager) return;
    const { key, path } = selected.assetImage;
    const manager = scene.assetManager;
    if (!manager.getImage || manager.images.has(key)) return;

    const fullPath = manager.resolveAssetPath
      ? manager.resolveAssetPath(path.replace(/^assets\//, ''))
      : path;
    const onError = () => {
      console.warn(`createPlayerEntity: 无法加载主角图片 ${path}`);
    };
    manager.loadImage(key, fullPath).catch(scene.resourceScope?.guard(onError) || onError);
  }
}

export default DemoPlayerFactory;
