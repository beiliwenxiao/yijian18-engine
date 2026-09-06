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

import { BaseGameScenePresentation } from './BaseGameScenePresentation.js';
import { EventTargetFlash } from '../../../src/rendering/EventTargetFlash.js';
import { emitWorldItemSparkles } from '../../../src/core/scene/SceneWorldItemEventPresenter.js';

export { CAMPAIGN_ID, SAVE_SCHEMA_VERSION } from './BaseGameSceneSetup.js';

/**
 * 场景薄组合根：保留稳定 import API 与生命周期入口；行为由显式父层和已注入服务承接。
 */
export class BaseGameScene extends BaseGameScenePresentation {
  constructor(sceneData = {}) {
    super(sceneData);
  }

  update(deltaTime) {
    return this._ensureFramePipeline().run(deltaTime);
  }

  render(ctx) {
    return this._ensureRenderPipeline().render(ctx);
  }

  exit() {
    super.exit();
    this._lifecycleCoordinator?.exit({ synchronous: true });
  }

  /** 惰性创建的世界空间事件目标闪光（星星闪光，仅事件触发时点亮）。 */
  get eventTargetFlash() {
    if (!this._eventTargetFlash) this._eventTargetFlash = new EventTargetFlash();
    return this._eventTargetFlash;
  }

  /**
   * application 事件成功消费后的目标物闪光入口。
   * 从事件 payload 解析目标世界坐标（payload.position 或由 entityId/groundId/targetId 反查实体），
   * 解析成功则在目标周围冒星星闪光；无位置信息的事件不闪。
   * @param {Object} event - application event
   */
  flashEventTarget(event) {
    const payload = event?.payload || {};
    let x = payload?.position?.x;
    let y = payload?.position?.y;

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      const entityId = payload?.entityId ?? payload?.groundId ?? payload?.targetId;
      if (entityId) {
        const target = (this.entities || []).find(entity => entity?.id === entityId);
        const pos = target?.getComponent?.('transform')?.position;
        if (pos) {
          x = pos.x;
          y = pos.y;
        }
      }
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    // 目标物周围同时冒出与丢弃物品一致的星形粒子闪光。
    emitWorldItemSparkles(this.particleSystem, { x, y });
    return this.eventTargetFlash.spawn({
      worldX: x,
      worldY: y,
      eventId: event?.eventId || null
    });
  }
}

export default BaseGameScene;
