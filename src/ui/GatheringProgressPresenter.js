/**
 * GatheringProgressPresenter - 世界空间头顶动作进度表现。
 * 默认消费 GatheringSystem 事件，也允许其他短时动作使用独立 owner；只读表现不持有业务状态。
 */
export class GatheringProgressPresenter {
  constructor({ width = 168, height = 9, offsetY = 18 } = {}) {
    this.width = Math.max(20, Number(width) || 84);
    this.height = Math.max(4, Number(height) || 9);
    this.offsetY = Math.max(0, Number(offsetY) || 18);
    this.actor = null;
    this.owner = null;
    this.progress = 0;
    this.visible = false;
  }

  handleEvent(event, data = {}, actor = null, owner = 'gathering') {
    const normalizedOwner = owner || 'gathering';
    if (event === 'started') {
      this.owner = normalizedOwner;
      this.actor = actor || null;
      this.progress = Math.max(0, Math.min(1, Number(data.progress) || 0));
      this.visible = Boolean(this.actor);
      return this.visible;
    }
    if (event === 'progress') {
      if (this.owner !== normalizedOwner) return false;
      this.actor = actor || this.actor;
      this.progress = Math.max(0, Math.min(1, Number(data.progress) || 0));
      this.visible = Boolean(this.actor);
      return this.visible;
    }
    if ((event === 'completed' || event === 'interrupted') && this.owner === normalizedOwner) {
      this.clear();
    }
    return false;
  }

  render(ctx, viewport = null) {
    if (!this.visible) return false;
    // 屏幕空间：水平居中、垂直居中（屏幕上下正中间）
    const width = Math.max(1, Number(viewport?.width) || 0);
    const height = Math.max(1, Number(viewport?.height) || 0);
    if (!width || !height) return false;
    const left = width / 2 - this.width / 2;
    const top = height / 2 - this.height / 2;
    const fillWidth = Math.max(0, (this.width - 2) * this.progress);

    ctx.save();
    ctx.fillStyle = 'rgba(12, 10, 8, 0.88)';
    ctx.fillRect(left - 2, top - 2, this.width + 4, this.height + 4);
    ctx.fillStyle = '#362f25';
    ctx.fillRect(left, top, this.width, this.height);
    if (fillWidth > 0) {
      ctx.fillStyle = this.progress >= 1 ? '#e5c45b' : '#7fc45b';
      ctx.fillRect(left + 1, top + 1, fillWidth, this.height - 2);
    }
    ctx.strokeStyle = '#ead89a';
    ctx.lineWidth = 1;
    ctx.strokeRect(left - 0.5, top - 0.5, this.width + 1, this.height + 1);
    ctx.restore();
    return true;
  }

  clear() {
    this.actor = null;
    this.owner = null;
    this.progress = 0;
    this.visible = false;
  }

  dispose() {
    this.clear();
  }
}

export default GatheringProgressPresenter;