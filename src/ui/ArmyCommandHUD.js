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
import { ARMY_SELECTION_SLOTS, SQUAD_PRESET_OPTIONS } from '../systems/ArmyCommandSystem.js';

const BUTTON_HEIGHT = 38;
const BUTTON_GAP = 6;
const STANCE_HEIGHT = 28;
const PROGRESS_HEIGHT = 8;
const COMBO_ROW_HEIGHT = 26;      // 合并行：预设开关 + 状态文字（常显）
const DEFAULT_BAR_WIDTH = 316;    // 底部快捷栏 7 槽宽度（7×40+6×6），HUD 与其对齐
const PRESET_TOGGLE_WIDTH = 70;
const PRESET_ROW_HEIGHT = 30;
const PRESET_OPTION_WIDTH = 50;
const PRESET_LABEL_WIDTH = 30;

const GOLD = '#c9a227';
const PANEL_BG = 'rgba(13, 19, 38, 0.86)';
const BUTTON_BG = '#1a2f55';
const BUTTON_BG_ACTIVE = '#3a4a7e';
const STANCE_BG = '#233055';
const STANCE_BG_ACTIVE = '#4a3a1d';

/**
 * Row 2 可见姿态（用户裁定 §11.1.5 收敛）：跟随武将 + 4 战术姿态。
 * 抢救伤员=剧情专用（army.rescue.begin 驱动，不走按钮）；快速逃命=全军紧急按钮（后做）；
 * 救援类操作直接用移动命令把军队派到目标位置即可。
 */
const VISIBLE_STANCES = Object.freeze([
  { key: 'escort', label: '跟随武将' },
  { key: 'assault', label: '全速进攻' },
  { key: 'hold', label: '原地防守' },
  { key: 'advance', label: '缓慢推进' },
  { key: 'retreat', label: '稳步撤退' }
]);

/** 预设面板的军行顺序（与 ArmyCommandSystem.squadPresets 键一致）。 */
const PRESET_SQUADS = Object.freeze([
  { key: 'qian', label: '前军' },
  { key: 'zuo', label: '左军' },
  { key: 'zhong', label: '中军' },
  { key: 'you', label: '右军' },
  { key: 'hou', label: '后军' }
]);

/**
 * ArmyCommandHUD - 军团指挥 HUD
 *
 * Row 1  编组选择条：武将/全军/前/后/左/中/右军（7 槽）+「预设」开关
 * Row 2  姿态命令面板：跟随武将/全速进攻/原地防守/缓慢推进/稳步撤退（§11.1.5 收敛）
 *        —— 仅编组选择激活时显示；抢救伤员=剧情专用（army.rescue.begin），
 *        快速逃命=全军紧急按钮（后做）；救援类操作直接用移动命令派兵到位
 * Row 3  命令执行状态提示 / 自定义选择提示 / 「命令已达成」
 * Row 4+ 战前预设面板（M5-3）：per 军默认战术姿态（跟随/进攻/防守/推进/撤退），
 *        开战自动应用；点击 Row1「预设」展开/收起
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
    this._presetToggle = null;
    this._presetButtons = [];
    this.presetOpen = false;
    this._pulse = 0;
  }

  /** 由 ScenePanelLayout/装配方在初始化与 resize 时调用；barWidth=底部快捷栏 7 槽总宽，HUD 与其对齐。 */
  layout(width, height, barWidth = DEFAULT_BAR_WIDTH) {
    this._barWidth = barWidth;
    this.x = Math.round((width - barWidth) / 2);
    this._baseY = height - 196;
    this.y = this._baseY;
    this.width = barWidth;
  }

  /** @param {CanvasRenderingContext2D} ctx */
  render(ctx) {
    if (!this.system.getUnitCount()) return;
    this._pulse += 0.12;
    const showStance = this.system.hasSquadSelection();
    const stanceRows = showStance ? (STANCE_HEIGHT + 6) : 0;
    this._stanceRows = stanceRows;
    // 向上展开（用户裁定）：姿态行/状态行显示在编组条上方，预设面板再向上；AABB 覆盖全部按钮
    this._presetRows = this.presetOpen ? PRESET_SQUADS.length * PRESET_ROW_HEIGHT + 22 : 0;
    this.y = this._baseY - stanceRows - this._presetRows;
    this.height = BUTTON_HEIGHT + COMBO_ROW_HEIGHT + stanceRows + this._presetRows;
    this._drawSelectionRings(ctx);
    this._drawDragRect(ctx);
    this._drawOrderMarker(ctx);
    this._drawPanel(ctx, showStance);
  }

  containsPoint(x, y) {
    return x >= this.x && x <= this.x + this.width && y >= this.y && y <= this.y + this.height;
  }

  /** @returns {boolean} 是否消费该点击（预设面板/编组/姿态按钮命中才消费） */
  handleMouseClick(x, y, button) {
    if (button !== 'left') return false;
    // 预设面板按钮（展开时位于最上层）
    for (const item of this._presetButtons) {
      if (x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height) {
        this.system.setSquadPreset(item.squadKey, item.stanceKey);
        return true;
      }
    }
    // 预设开关
    const toggle = this._presetToggle;
    if (toggle && x >= toggle.x && x <= toggle.x + toggle.width && y >= toggle.y && y <= toggle.y + toggle.height) {
      this.presetOpen = !this.presetOpen;
      return true;
    }
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

    // Row 1：编组选择（最底行；姿态/状态/预设面板按需向上展开）
    const presetRows = this._presetRows || 0;
    const stanceRows = this._stanceRows || 0;
    const row1Y = this.y + presetRows + stanceRows + COMBO_ROW_HEIGHT;
    const slotW = (this.width - (ARMY_SELECTION_SLOTS.length - 1) * BUTTON_GAP) / ARMY_SELECTION_SLOTS.length;
    const selectedSlot = this.system.getSelectionSlot();
    this._buttons = ARMY_SELECTION_SLOTS.map((slot, index) => {
      const item = {
        slotKey: slot.key,
        label: slot.label,
        x: this.x + index * (slotW + BUTTON_GAP),
        y: row1Y,
        width: slotW,
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

    // 合并行（Row1 上方常显）：左=战前预设开关，中=状态/提示文字
    const comboY = this.y + presetRows + stanceRows;
    this._presetToggle = {
      label: '⚙ 预设',
      x: this.x,
      y: comboY,
      width: PRESET_TOGGLE_WIDTH,
      height: COMBO_ROW_HEIGHT - 2
    };
    {
      const toggle = this._presetToggle;
      ctx.fillStyle = this.presetOpen ? BUTTON_BG_ACTIVE : BUTTON_BG;
      ctx.strokeStyle = this.presetOpen ? GOLD : 'rgba(90, 110, 170, 0.7)';
      ctx.lineWidth = this.presetOpen ? 2 : 1;
      this._roundRect(ctx, toggle.x, toggle.y, toggle.width, toggle.height, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = this.presetOpen ? GOLD : 'rgba(255, 255, 255, 0.88)';
      ctx.font = '11px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(toggle.label, toggle.x + toggle.width / 2, toggle.y + toggle.height / 2 + 1);
    }

    // Row 2：姿态命令面板（仅编组选择激活时；显示在编组条上方——用户裁定）
    const stanceY = this.y + presetRows;
    this._stanceButtons = [];
    const activeStance = showStance ? this.system.getSelectedStance() : null;
    if (showStance) {
      const stanceW = (this.width - (VISIBLE_STANCES.length - 1) * BUTTON_GAP) / VISIBLE_STANCES.length;
      VISIBLE_STANCES.forEach((stance, index) => {
        const item = {
          stanceKey: stance.key,
          label: stance.label,
          x: this.x + index * (stanceW + BUTTON_GAP),
          y: stanceY,
          width: stanceW,
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

    // 合并行右侧：状态/提示文字（施工进度为任务驱动的建造作业显示）
    const progressY = comboY;
    const statusX = this.x + PRESET_TOGGLE_WIDTH + (this.width - PRESET_TOGGLE_WIDTH) / 2;
    const constructionJob = this.system.constructionJob;
    const order = this.system.getActiveOrder();
    if (constructionJob && !constructionJob.done) {
      const ratio = constructionJob.total > 0 ? constructionJob.countdown / constructionJob.total : 0;
      const label = `${constructionJob.def.label} 施工中 ${constructionJob.countdown.toFixed(1)}s`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.fillRect(statusX - (this.width - PRESET_TOGGLE_WIDTH) / 2, progressY + 2, this.width - PRESET_TOGGLE_WIDTH, PROGRESS_HEIGHT);
      ctx.fillStyle = 'rgba(76, 175, 80, 0.9)';
      ctx.fillRect(statusX - (this.width - PRESET_TOGGLE_WIDTH) / 2, progressY + 2, (this.width - PRESET_TOGGLE_WIDTH) * (1 - ratio), PROGRESS_HEIGHT);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.font = '10px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, statusX, progressY + COMBO_ROW_HEIGHT / 2);
    } else if (this.system.isCustomSelection()) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.font = '10px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.system.getSelectionLabel(), statusX, progressY + COMBO_ROW_HEIGHT / 2);
    } else if (order && !order.done) {
      // 用户裁定取消命令倒计时：执行中只显示轻量文字提示，达成=全部到位
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.font = '10px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('执行中…', statusX, progressY + COMBO_ROW_HEIGHT / 2);
    } else if (order?.done) {
      ctx.fillStyle = 'rgba(76, 175, 80, 0.9)';
      ctx.font = '10px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('命令已达成', statusX, progressY + COMBO_ROW_HEIGHT / 2);
    } else if (showStance) {
      // M5：选中军未下令时提示语义化操作（发完指令自动回武将）
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.font = '10px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('右键点敌=进攻 · 点地=驻守 · 点武将=集结', statusX, progressY + COMBO_ROW_HEIGHT / 2);
    }

    // Row 4+：战前预设面板（M5-3，点击 Row1「预设」开关展开；开战自动生效）。
    // 面板画在 Row1 上方（render 已把 this.y 上移 presetRows，AABB 覆盖全部按钮）。
    this._presetButtons = [];
    if (this.presetOpen) {
      const presets = this.system.getSquadPresets();
      const inCombat = this.system.presetsActive === true;
      let rowY = this.y + 6;
      ctx.fillStyle = 'rgba(201, 162, 39, 0.85)';
      ctx.font = '10px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(inCombat ? '战前预设（战斗中——修改自下次开战生效）' : '战前预设（开战自动生效）', this.x, rowY + 10);
      rowY += 16;
      for (const squad of PRESET_SQUADS) {
        const current = presets[squad.key] || 'escort';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
        ctx.font = '11px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(squad.label, this.x + 2, rowY + PRESET_ROW_HEIGHT / 2);
        SQUAD_PRESET_OPTIONS.forEach((option, index) => {
          const item = {
            squadKey: squad.key,
            stanceKey: option.key,
            x: this.x + PRESET_LABEL_WIDTH + 4 + index * (PRESET_OPTION_WIDTH + BUTTON_GAP),
            y: rowY,
            width: PRESET_OPTION_WIDTH,
            height: PRESET_ROW_HEIGHT - 6
          };
          this._presetButtons.push(item);
          const active = option.key === current;
          ctx.fillStyle = active ? STANCE_BG_ACTIVE : STANCE_BG;
          ctx.strokeStyle = active ? GOLD : 'rgba(90, 110, 170, 0.6)';
          ctx.lineWidth = active ? 2 : 1;
          this._roundRect(ctx, item.x, item.y, item.width, item.height, 4);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = active ? GOLD : 'rgba(255, 255, 255, 0.8)';
          ctx.font = '10px "Microsoft YaHei", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(option.label, item.x + item.width / 2, item.y + item.height / 2 + 1);
        });
        rowY += PRESET_ROW_HEIGHT;
      }
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
