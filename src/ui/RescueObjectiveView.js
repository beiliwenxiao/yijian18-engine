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

/************************************************************
 * YiJian18-Engine - read-only rescue objective HUD
 ************************************************************/

import { UIElement } from './UIElement.js';
import { RescueStatus } from '../systems/RescueSystem.js';

const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));

/** 只消费 RescueSystem 快照，不持有或修改救援领域状态。 */
export class RescueObjectiveView extends UIElement {
  constructor(options = {}) {
    super({
      x: 16,
      y: options.y || 142,
      width: options.width || 500,
      height: options.height || 112,
      visible: false,
      zIndex: 82
    });
    this.snapshot = null;
    this.title = options.title || '限时救援';
  }

  setSnapshot(snapshot) {
    this.snapshot = clone(snapshot);
    this.visible = !!snapshot && snapshot.status !== RescueStatus.IDLE;
  }

  clear() {
    this.snapshot = null;
    this.visible = false;
  }

  render(ctx, viewWidth = ctx?.canvas?.width || 1280) {
    if (!this.visible || !this.snapshot || !ctx) return;
    const width = Math.min(this.width, viewWidth - 32);
    const x = (viewWidth - width) / 2;
    const remaining = Math.max(0, Number(this.snapshot.remaining) || 0);
    const seconds = Math.ceil(remaining);
    const active = this.snapshot.status === RescueStatus.ACTIVE;
    const succeeded = this.snapshot.status === RescueStatus.SUCCEEDED;

    ctx.save();
    ctx.fillStyle = 'rgba(18,20,24,0.92)';
    ctx.strokeStyle = succeeded ? '#72bd79' : (active ? '#d4ad52' : '#b9514b');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, this.y, width, this.height, 8);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f0d27e';
    ctx.font = 'bold 16px Arial';
    ctx.fillText(this.title, x + width / 2, this.y + 10);

    ctx.fillStyle = '#eeeeee';
    ctx.font = '14px Arial';
    const objective = this.snapshot.objective || '等待救援目标';
    ctx.fillText(objective, x + width / 2, this.y + 38);

    ctx.font = 'bold 18px Arial';
    ctx.fillStyle = active && seconds <= 15 ? '#ef6b61' : '#ffffff';
    const statusText = active
      ? `剩余 ${seconds} 秒`
      : (succeeded ? '救援成功' : `救援失败：${this.snapshot.failureReason || '目标未完成'}`);
    ctx.fillText(statusText, x + width / 2, this.y + 65);

    const stages = this.snapshot.completedStageIds?.length || 0;
    ctx.fillStyle = '#bababa';
    ctx.font = '11px Arial';
    ctx.fillText(`阶段 ${Math.min(Number(this.snapshot.totalStages) || 0, stages + (active ? 1 : 0))} / ${Number(this.snapshot.totalStages) || stages}`,
      x + width / 2, this.y + 91);
    ctx.restore();
  }
}

export default RescueObjectiveView;
