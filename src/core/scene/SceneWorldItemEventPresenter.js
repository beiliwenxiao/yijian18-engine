/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

const PRESENTED_EVENT_TYPES = new Set([
  'worldItem.revealed',
  'item.dropped',
  'item.deathDropCreated'
]);

const finitePosition = value => Number.isFinite(value?.x) && Number.isFinite(value?.y);

/**
 * 星形粒子闪光（与物品掉落/死亡掉落表现一致）。
 * 供物品事件表现与事件目标闪光（flashEventTarget）共用。
 */
export function emitWorldItemSparkles(particleSystem, position, payload = {}) {
  const color = payload.sparkleColor || '#ffe27a';
  particleSystem?.emitBurst?.({
    position: { x: position.x, y: position.y - 18 },
    velocity: { x: 0, y: 0 },
    life: 620,
    size: 4.5,
    color,
    alpha: 1,
    gravity: 28,
    friction: 0.985,
    shape: 'star',
    isFire: false,
    renderLayer: 'worldDepth',
    sortY: position.y
  }, Math.max(6, Number(payload.sparkleCount) || 10), {
    velocityRange: { min: 24, max: 70 },
    angleRange: { min: Math.PI * 1.05, max: Math.PI * 1.95 },
    sizeRange: { min: 2.5, max: 6 },
    lifeRange: { min: 460, max: 760 }
  });
}

/** 物品发现/掉落的统一只读表现：通知、跳跃 render offset 与星形粒子。 */
export class SceneWorldItemEventPresenter {
  constructor(config = {}) {
    this.resolveTarget = config.resolveTarget || (() => null);
    // definitionId → 物品显示名（内容库查询注入；未注入时回退 definitionId）
    this.resolveItemName = typeof config.resolveItemName === 'function' ? config.resolveItemName : null;
    this.particleSystem = config.particleSystem || null;
    this.notify = config.notify || (() => {});
    this.animations = new Map();
    this.sequence = 0;
  }

  present(event = {}) {
    if (!PRESENTED_EVENT_TYPES.has(event.type)) return false;
    const payload = event.payload || {};
    if (payload.reason === 'restore' || payload.announce === false) return false;
    const target = this.resolveTarget(payload);
    const position = this._positionOf(target) || (finitePosition(payload.position) ? payload.position : null);
    if (target && typeof target === 'object') {
      this.animations.set(target, {
        elapsed: 0,
        delay: Math.min(0.3, (this.sequence++ % 5) * 0.075),
        duration: 0.48,
        height: Math.max(12, Number(payload.jumpHeight) || 18)
      });
    }
    if (position) this._emitSparkles(position, payload);
    const definitionId = payload.definitionId || payload.item?.definitionId || payload.item?.id || null;
    const resolvedName = definitionId && this.resolveItemName ? this.resolveItemName(definitionId) : null;
    const name = payload.name || payload.item?.name || resolvedName || definitionId || '物品';
    const defaultMessage = event.type === 'worldItem.revealed'
      ? `发现：${name}掉落在地上。`
      : (event.type === 'item.deathDropCreated' ? `${name}掉落在地上。` : `${name}已掉落。`);
    this.notify({
      title: payload.title || (event.type === 'item.deathDropCreated' ? '物资掉落' : '发现物品'),
      message: payload.message || defaultMessage,
      event,
      target
    });
    return true;
  }

  update(deltaTime) {
    const dt = Math.max(0, Math.min(0.1, Number(deltaTime) || 0));
    for (const [target, animation] of this.animations) {
      animation.elapsed += dt;
      if (animation.elapsed >= animation.delay + animation.duration) this.animations.delete(target);
    }
  }

  getRenderOffset(target) {
    const animation = target && this.animations.get(target);
    if (!animation || animation.elapsed < animation.delay) return { x: 0, y: 0 };
    const progress = Math.min(1, (animation.elapsed - animation.delay) / animation.duration);
    const primaryEnd = 0.78;
    const y = progress < primaryEnd
      ? -Math.sin(Math.PI * progress / primaryEnd) * animation.height
      : -Math.sin(Math.PI * (progress - primaryEnd) / (1 - primaryEnd)) * animation.height * 0.16;
    return { x: 0, y };
  }

  _positionOf(target) {
    const position = target?.getComponent?.('transform')?.position;
    if (finitePosition(position)) return position;
    if (finitePosition(target)) return target;
    return null;
  }

  _emitSparkles(position, payload) {
    emitWorldItemSparkles(this.particleSystem, position, payload);
  }

  dispose() {
    this.animations.clear();
  }
}

export default SceneWorldItemEventPresenter;