/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-10-01
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 ************************************************************/

import { InputHints } from '../core/input/InputHints.js';

/**
 * DialogueChoiceBox - 对话选项弹窗（框架级）
 *
 * 与 DialogueBox（对话文本框）拆分的独立 UI：只在当前节点带 choices 时显示，
 * 位置与大小由 UI 编辑器的「选项弹窗」组件（dialogue-choices）配置。
 * 纯表现 + 命中：选择动作仍由 DialogueSystem.selectChoice 发起，
 * 编排（dialogueChoice Trigger）与文本框无耦合。
 */
export class DialogueChoiceBox {
  constructor(options = {}) {
    this.dialogueSystem = options.dialogueSystem || null;
    this.x = options.x || 0;
    this.y = options.y || 0;
    this.width = options.width || 420;
    this.height = options.height || 120;
    this.visible = options.visible !== false;
    this.zIndex = options.zIndex || 210;
    this.canInteract = true;

    this.padding = options.padding || 14;
    this.choiceHeight = options.choiceHeight || 44;
    this.choiceSpacing = options.choiceSpacing || 10;

    // UI 编辑器保存的选项弹窗矩形（dialogue-choices）；未配置时用构造几何
    this.layoutRect = options.layoutRect || null;

    this.backgroundColor = options.backgroundColor || 'rgba(12, 10, 6, 0.92)';
    this.borderColor = options.borderColor || '#8B7355';
    this.choiceColor = options.choiceColor || '#4A90E2';
    this.choiceHoverColor = options.choiceHoverColor || '#5BA3F5';
    this.choiceTextColor = options.choiceTextColor || '#FFFFFF';
    this.choiceFont = options.choiceFont || '16px Arial, sans-serif';

    this.choiceHoverSoundKey = options.choiceHoverSoundKey || 'dialogue_hover';
    this.choiceSelectSoundKey = options.choiceSelectSoundKey || 'dialogue_select';
    this.audioManager = options.audioManager || null;
    this.onSelect = options.onSelect || null;

    this.hoveredChoiceIndex = -1;
    // 手柄/键盘焦点：弹窗出现时聚焦第一项，方向键或左摇杆上下切换，A/E 确认
    this.focusedIndex = 0;
    this._focusedNodeId = null;
    this._navDirectionActive = false;
  }

  /** 应用 UI 编辑器保存的选项弹窗矩形。 */
  setLayoutRect(rect) {
    this.layoutRect = rect && typeof rect === 'object' ? rect : null;
    return this;
  }

  hasAudio(soundKey) {
    return this.audioManager?.hasSound?.(soundKey) === true;
  }

  playSound(soundKey, options = {}) {
    if (this.hasAudio(soundKey)) this.audioManager.playSound(soundKey, options);
  }

  /** 当前节点的选项（无对话或无选项时为空）。 */
  currentChoices() {
    if (!this.dialogueSystem?.isDialogueActive()) return [];
    const node = this.dialogueSystem.getCurrentNode();
    return node?.choices?.length > 0 ? node.choices : [];
  }

  /** 选项按钮矩形（自上而下排布在弹窗内）。 */
  choiceRects(choices) {
    return choices.map((_choice, index) => ({
      x: this.x + this.padding,
      y: this.y + this.padding + index * (this.choiceHeight + this.choiceSpacing),
      width: this.width - this.padding * 2,
      height: this.choiceHeight
    }));
  }

  update(_deltaTime) {
    // UI 编辑器矩形优先；高度按选项数量向下增长，防止选项溢出被裁剪
    if (this.layoutRect) {
      this.x = this.layoutRect.x;
      this.y = this.layoutRect.y;
      this.width = this.layoutRect.width;
      this.height = this.layoutRect.height;
    }
    if (!this.dialogueSystem) return;
    // 跟随对话状态：有 choices 的节点显示，其余隐藏；打字中不显示。
    const choices = this.currentChoices();
    this.visible = choices.length > 0 && !this.dialogueSystem.isTyping();
    // 焦点跟随节点：换节点重置为第一项；焦点索引 clamp 到选项范围
    const nodeId = this.dialogueSystem.getCurrentNode()?.id || null;
    if (nodeId !== this._focusedNodeId) {
      this._focusedNodeId = nodeId;
      this.focusedIndex = 0;
      this._navDirectionActive = false;
    }
    if (this.visible) {
      this.focusedIndex = Math.max(0, Math.min(this.focusedIndex, choices.length - 1));
      const contentHeight = this.padding * 2
        + choices.length * this.choiceHeight
        + Math.max(0, choices.length - 1) * this.choiceSpacing;
      this.height = Math.max(this.height, contentHeight);
    }
    if (!this.visible) this.hoveredChoiceIndex = -1;
  }

  render(ctx) {
    if (!this.visible) return;
    const choices = this.currentChoices();
    if (choices.length === 0) return;

    ctx.save();
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = this.borderColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(this.x, this.y, this.width, this.height);

    const rects = this.choiceRects(choices);
    choices.forEach((choice, index) => {
      const rect = rects[index];
      const isHovered = this.hoveredChoiceIndex === index;
      const isFocused = this.focusedIndex === index;
      ctx.fillStyle = isHovered ? this.choiceHoverColor : this.choiceColor;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = this.borderColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      // 焦点高光：手柄/键盘当前聚焦项的金色亮边（鼠标悬停同步焦点）
      if (isFocused) {
        ctx.strokeStyle = '#FFE066';
        ctx.lineWidth = 3;
        ctx.strokeRect(rect.x + 2, rect.y + 2, rect.width - 4, rect.height - 4);
        ctx.lineWidth = 2;
      }
      ctx.fillStyle = this.choiceTextColor;
      ctx.font = this.choiceFont;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${index + 1}. ${choice.text}`, rect.x + 14, rect.y + rect.height / 2);
    });
    ctx.restore();
  }

  handleMouseMove(mouseX, mouseY) {
    if (!this.visible || !this.canInteract) return;
    const choices = this.currentChoices();
    const rects = this.choiceRects(choices);
    let newHoveredIndex = -1;
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      if (mouseX >= rect.x && mouseX <= rect.x + rect.width
        && mouseY >= rect.y && mouseY <= rect.y + rect.height) {
        newHoveredIndex = i;
        break;
      }
    }
    if (newHoveredIndex !== this.hoveredChoiceIndex && newHoveredIndex !== -1) {
      this.playSound(this.choiceHoverSoundKey, { volume: 0.5 });
    }
    this.hoveredChoiceIndex = newHoveredIndex;
    // 鼠标悬停即焦点：手柄高光与 hover 视觉一致
    if (newHoveredIndex !== -1) this.focusedIndex = newHoveredIndex;
  }

  /**
   * 手柄/键盘确认输入：方向键或左摇杆上下切换焦点（按住沿触发一次），
   * E 键（手柄 A/X 映射的虚拟 e 键）确认当前焦点项。
   * 由 SceneDialogueFlow 在选项节点调用（afterSystems 阶段，晚于鼠标点击路由）。
   * @param {Object} input - InputManager
   * @returns {boolean} 是否消费了确认输入
   */
  handleConfirmInput(input) {
    if (!this.visible || !this.canInteract || !input) return false;
    const choices = this.currentChoices();
    if (choices.length === 0) return false;

    // 焦点导航：up/down 涵盖键盘方向键/WASD 与手柄左摇杆（GamepadManager 注入同一虚拟键）
    const up = input.isKeyDown?.('up') === true;
    const down = input.isKeyDown?.('down') === true;
    const direction = up === down ? 0 : (up ? -1 : 1);
    if (direction !== 0 && this._navDirectionActive !== true) {
      this.focusedIndex = (this.focusedIndex + direction + choices.length) % choices.length;
      this.playSound(this.choiceHoverSoundKey, { volume: 0.5 });
    }
    this._navDirectionActive = direction !== 0;

    // 确认：E / 手柄 A/X（虚拟 e 键帧沿）
    if (input.isKeyPressed?.('e') !== true) return false;
    const index = Math.max(0, Math.min(this.focusedIndex, choices.length - 1));
    this.playSound(this.choiceSelectSoundKey, { volume: 0.5 });
    const selected = choices[index];
    const pending = this.dialogueSystem.selectChoice(index);
    const finalize = result => {
      if (result === false) return true;
      this.onSelect?.(index, selected);
      if (!this.dialogueSystem.isDialogueActive()) this.hide();
      return true;
    };
    if (pending && typeof pending.then === 'function') pending.then(finalize);
    else finalize(pending);
    return true;
  }

  /** @returns {boolean} 是否消费了该点击 */
  handleMouseClick(mouseX, mouseY) {
    if (!this.visible || !this.canInteract) return false;
    const choices = this.currentChoices();
    const rects = this.choiceRects(choices);
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      if (mouseX >= rect.x && mouseX <= rect.x + rect.width
        && mouseY >= rect.y && mouseY <= rect.y + rect.height) {
        this.focusedIndex = i;
        this.playSound(this.choiceSelectSoundKey, { volume: 0.5 });
        const selected = choices[i];
        const pending = this.dialogueSystem.selectChoice(i);
        const finalize = result => {
          if (result === false) return true;
          this.onSelect?.(i, selected);
          if (!this.dialogueSystem.isDialogueActive()) this.hide();
          return true;
        };
        return pending && typeof pending.then === 'function'
          ? (pending.then(finalize), true)
          : finalize(pending);
      }
    }
    return false;
  }

  containsPoint(mouseX, mouseY) {
    return mouseX >= this.x && mouseX <= this.x + this.width
      && mouseY >= this.y && mouseY <= this.y + this.height;
  }

  show() {
    this.visible = true;
    this.canInteract = true;
  }

  hide() {
    this.visible = false;
    this.canInteract = false;
  }

  /** 继续提示短语（与 DialogueBox 同源文案表）。 */
  static continuePrompt() {
    return InputHints.phrase('dialogueContinue');
  }
}

export default DialogueChoiceBox;
