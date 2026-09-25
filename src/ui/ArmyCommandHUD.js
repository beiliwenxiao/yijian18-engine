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

import { UIElement } from './UIElement.js';
import { ARMY_SELECTION_SLOTS } from '../systems/ArmyCommandSystem.js';
import { ARMY_STANCES } from '../ecs/components/CommandStateComponent.js';

const BUTTON_WIDTH = 66;
const BUTTON_HEIGHT = 38;
const BUTTON_GAP = 6;
const STANCE_WIDTH = 76;
const STANCE_HEIGHT = 28;
const PROGRESS_HEIGHT = 8;

const GOLD = '#c9a227';
const PANEL_BG = 'rgba(13, 19, 38, 0.86)';
const BUTTON_BG = '#1a2f55';
const BUTTON_BG_ACTIVE = '#3a4a7e';
const STANCE_BG = '#233055';
const STANCE_BG_ACTIVE = '#4a3a1d';

/**
 * ArmyCommandHUD - 军团指挥 HUD
 *
 * Row 1  编组选择条：武将/全军/前/后/左/中/右军（7 槽）
 * Row 2  攻击命令面板：6 姿态（全速进攻/原地防守/缓慢推进/稳步撤退/抢救伤员/快速逃命）
 *        —— 仅编组选择激活时显示；PC 左键点选即生效，手柄 RB 循环 + A 确认
 * Row 3  命令达成倒计时进度条 / 自定义选择提示 / 「命令已达成」
 *
 * 叠加渲染：选中单位金色椭圆圈、框选矩形、命令目标脉冲标记。
 * 经 uiClickHandler.registerElement 接管点击；无军队时不渲染不拦截。
 * 特殊命令已收口：建造类不再提供 HUD 下令按钮（由任务/触发器驱动）。
 */
export class ArmyCommandHUD extends UIElement {
  /**
   * @param {Object} config
   * @param {import('../systems/ArmyCommandSystem.js').ArmyCommandSystem} config.system
   * @param {Object|null} config.camera - 相机（worldToScreen）
   * @param {Object|null} [config.dragState] - 框选拖拽状态（由 SceneArmyCommandFlow 维护）
   */
  constructor({ system, camera = null, dragState = null } = {}) {
    super({ x: 0, y: 0, width: 10, height: 10, visible: true, zIndex: 205 });
    this.system = system;
    this.camera = camera;
    this.dragState = dragState;
    this._buttons = [];
    this._stanceButtons = [];
    this._pulse = 0;
  }

  /** 由 ScenePanelLayout/装配方在初始化与 resize 时调用。 */
  layout(width, height) {
    const total = ARMY_SELECTION_SLOTS.length * BUTTON_WIDTH + (ARMY_SELECTION_SLOTS.length - 1) * BUTTON_GAP;
    this.x = Math.round((width - total) / 2);
    this.y = height - 196;
    this.width = total;
  }

  /** @param {CanvasRenderingContext2D} ctx */
  render(ctx) {
    if (!this.system.getUnitCount()) return;
    this._pulse += 0.12;
    const showStance = this.system.hasSquadSelection();
    const extraRows = showStance ? (STANCE_HEIGHT + 4) : 0;
    this.height = BUTTON_HEIGHT + extraRows + PROGRESS_HEIGHT + 10;
    this._drawSelectionRings(ctx);
    this._drawDragRect(ctx);
    this._drawOrderMarker(ctx);
    this._drawPanel(ctx, showStance);
  }

  containsPoint(x, y) {
    return x >= this.x && x <= this.x + this.width && y >= this.y && y <= this.y + this.height;
  }

  /** @returns {boolean} 是否消费该点击（编组/姿态按钮命中才消费） */
  handleMouseClick(x, y, button) {
    if (button !== 'left') return false;
    for (const item of this._stanceButtons) {
      if (x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height) {
        this.system.applyStance(item.stanceKey);
        this.system.pendingStance = item.stanceKey;
        return true;
      }
    }
    for (const item of this._buttons) {
      if (x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height) {
        this.system.setSelection(item.slotKey);
        return true;
      }
    }
    return false;
  }

  _drawPanel(ctx, showStance) {
    ctx.save();
    ctx.fillStyle = PANEL_BG;
    ctx.strokeStyle = 'rgba(58, 74, 126, 0.9)';
    ctx.lineWidth = 1;
    this._roundRect(ctx, this.x - 8, this.y - 6, this.width + 16, this.height + 12, 8);
    ctx.fill();
    ctx.stroke();

    // Row 1：编组选择
    const selectedSlot = this.system.getSelectionSlot();
    this._buttons = ARMY_SELECTION_SLOTS.map((slot, index) => {
      const item = {
        slotKey: slot.key,
        label: slot.label,
        x: this.x + index * (BUTTON_WIDTH + BUTTON_GAP),
        y: this.y,
        width: BUTTON_WIDTH,
        height: BUTTON_HEIGHT
      };
      const active = !this.system.isCustomSelection() && item.slotKey === selectedSlot;
      ctx.fillStyle = active ? BUTTON_BG_ACTIVE : BUTTON_BG;
      ctx.strokeStyle = active ? GOLD : 'rgba(90, 110, 170, 0.7)';
      ctx.lineWidth = active ? 2 : 1;
      this._roundRect(ctx, item.x, item.y, item.width, item.height, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = active ? GOLD : 'rgba(255, 255, 255, 0.88)';
      ctx.font = '12px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.label, item.x + item.width / 2, item.y + item.height / 2 + 1);
      return item;
    });

    // Row 2：攻击命令面板（仅编组选择激活时）
    const stanceY = this.y + BUTTON_HEIGHT + 4;
    this._stanceButtons = [];
    const activeStance = showStance ? this.system.getSelectedStance() : null;
    if (showStance) {
      ARMY_STANCES.forEach((stance, index) => {
        const item = {
          stanceKey: stance.key,
          label: stance.label,
          x: this.x + index * (STANCE_WIDTH + BUTTON_GAP),
          y: stanceY,
          width: STANCE_WIDTH,
          height: STANCE_HEIGHT
        };
        this._stanceButtons.push(item);
        const isActive = item.stanceKey === activeStance;
        const isPending = item.stanceKey === this.system.pendingStance;
        ctx.fillStyle = isActive ? STANCE_BG_ACTIVE : STANCE_BG;
        ctx.strokeStyle = isActive ? GOLD : (isPending ? 'rgba(201, 162, 39, 0.7)' : 'rgba(90, 110, 170, 0.6)');
        ctx.lineWidth = isActive ? 2 : 1;
        if (isPending && !isActive) ctx.setLineDash([4, 3]);
        this._roundRect(ctx, item.x, item.y, item.width, item.height, 5);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = isActive ? GOLD : 'rgba(255, 255, 255, 0.85)';
        ctx.font = '11px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.label, item.x + item.width / 2, item.y + item.height / 2 + 1);
      });
    }

    // Row 3：状态/倒计时（施工进度为任务驱动的建造作业显示）
    const progressY = stanceY + (showStance ? STANCE_HEIGHT + 4 : 0);
    const constructionJob = this.system.constructionJob;
    const order = this.system.getActiveOrder();
    if (constructionJob && !constructionJob.done) {
      const ratio = constructionJob.total > 0 ? constructionJob.countdown / constructionJob.total : 0;
      const label = `${constructionJob.def.label} 施工中 ${constructionJob.countdown.toFixed(1)}s`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.fillRect(this.x, progressY, this.width, PROGRESS_HEIGHT);
      ctx.fillStyle = 'rgba(76, 175, 80, 0.9)';
      ctx.fillRect(this.x, progressY, this.width * (1 - ratio), PROGRESS_HEIGHT);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.font = '10px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, this.x + this.width / 2, progressY + PROGRESS_HEIGHT / 2 + 8);
    } else if (this.system.isCustomSelection()) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.font = '10px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.system.getSelectionLabel(), this.x + this.width / 2, progressY + PROGRESS_HEIGHT / 2);
    } else if (order && !order.done) {
      const ratio = order.duration > 0 ? order.countdown / order.duration : 0;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.fillRect(this.x, progressY, this.width, PROGRESS_HEIGHT);
      ctx.fillStyle = GOLD;
      ctx.fillRect(this.x, progressY, this.width * ratio, PROGRESS_HEIGHT);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.font = '10px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${order.countdown.toFixed(1)}s`, this.x + this.width - 2, progressY + PROGRESS_HEIGHT / 2);
    } else if (order?.done) {
      ctx.fillStyle = 'rgba(76, 175, 80, 0.9)';
      ctx.font = '10px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('命令已达成', this.x + this.width / 2, progressY + PROGRESS_HEIGHT / 2);
    }
    ctx.restore();
  }

  _drawSelectionRings(ctx) {
    const units = this.system.getSelectedUnits();
    if (!units.length) return;
    ctx.save();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    for (const entity of units) {
      const transform = entity.getComponent?.('transform');
      if (!transform) continue;
      const screen = this._worldToScreen(transform.position.x, transform.position.y);
      if (!screen) continue;
      ctx.beginPath();
      ctx.ellipse(screen.x, screen.y + 6, 20, 10, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawOrderMarker(ctx) {
    const order = this.system.getActiveOrder();
    if (!order || order.done) return;
    const screen = this._worldToScreen(order.goal.x, order.goal.y);
    if (!screen) return;
    const pulse = 10 + Math.sin(this._pulse) * 3;
    ctx.save();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(screen.x, screen.y, pulse + 8, (pulse + 8) * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  _drawDragRect(ctx) {
    const drag = this.dragState;
    if (!drag?.active) return;
    const x = Math.min(drag.startX, drag.currentX);
    const y = Math.min(drag.startY, drag.currentY);
    const width = Math.abs(drag.currentX - drag.startX);
    const height = Math.abs(drag.currentY - drag.startY);
    ctx.save();
    ctx.fillStyle = 'rgba(201, 162, 39, 0.12)';
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
    ctx.restore();
  }

  _worldToScreen(worldX, worldY) {
    if (this.camera?.worldToScreen) return this.camera.worldToScreen(worldX, worldY);
    return null;
  }

  _roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }
}

export default ArmyCommandHUD;
