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
import { InputHints } from '../core/input/InputHints.js';
import { PadButton } from '../core/input/Xbox360Profile.js';

const LEFT_STICK_NAV_THRESHOLD = 0.5;
const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
const inside = (point, box) => point.x >= box.x && point.x <= box.x + box.width
  && point.y >= box.y && point.y <= box.y + box.height;

/** 只投影工作站配方快照并发出选择命令，材料与库存结算由调用方拥有。 */
export class RecipeSelectionView extends UIElement {
  constructor(options = {}) {
    super({
      x: 0, y: 0,
      width: options.width || 700,
      height: options.height || 448,
      visible: false,
      zIndex: options.zIndex || 133
    });
    this.onCommand = typeof options.onCommand === 'function' ? options.onCommand : () => {};
    this.snapshot = null;
    this.selectedRecipeId = null;
    this.busy = false;
    this._leftStickNavArmed = false;
    this._leftStickDirection = 0;
  }

  open(snapshot = {}) {
    this.visible = true;
    this.busy = false;
    this._resetLeftStickNavigation();
    this.setSnapshot(snapshot, { preserveSelection: false });
  }

  setSnapshot(snapshot = {}, { preserveSelection = true } = {}) {
    const selectedRecipeId = preserveSelection ? this.selectedRecipeId : null;
    this.snapshot = clone(snapshot);
    const recipes = this._recipes();
    this.selectedRecipeId = recipes.some(recipe => recipe.id === selectedRecipeId)
      ? selectedRecipeId
      : recipes[0]?.id || null;
  }

  close() {
    this.visible = false;
    this.snapshot = null;
    this.selectedRecipeId = null;
    this.busy = false;
    this._resetLeftStickNavigation();
  }

  setBusy(value) { this.busy = value === true; }

  _resetLeftStickNavigation() {
    this._leftStickNavArmed = false;
    this._leftStickDirection = 0;
  }

  _getLeftStickNavigationOffset(gamepad) {
    const y = Number(gamepad?.leftStick?.y) || 0;
    const direction = y <= -LEFT_STICK_NAV_THRESHOLD ? -1
      : (y >= LEFT_STICK_NAV_THRESHOLD ? 1 : 0);
    if (!this._leftStickNavArmed) {
      if (direction === 0) this._leftStickNavArmed = true;
      this._leftStickDirection = direction;
      return 0;
    }
    const offset = direction !== 0 && direction !== this._leftStickDirection ? direction : 0;
    this._leftStickDirection = direction;
    return offset;
  }

  _recipes() { return Array.isArray(this.snapshot?.recipes) ? this.snapshot.recipes : []; }

  _selectedRecipe() {
    return this._recipes().find(recipe => recipe.id === this.selectedRecipeId) || null;
  }

  _moveSelection(offset) {
    const recipes = this._recipes();
    if (!recipes.length) return;
    const index = Math.max(0, recipes.findIndex(recipe => recipe.id === this.selectedRecipeId));
    this.selectedRecipeId = recipes[(index + offset + recipes.length) % recipes.length].id;
  }

  _layout(viewWidth, viewHeight) {
    const width = Math.min(this.width, viewWidth - 24);
    const height = Math.min(this.height, viewHeight - 24);
    const x = (viewWidth - width) / 2;
    const y = (viewHeight - height) / 2;
    const divider = x + Math.floor(width * 0.48);
    return {
      x, y, width, height, divider,
      close: { x: x + width - 48, y: y + 12, width: 32, height: 28 },
      rows: this._recipes().slice(0, 6).map((recipe, index) => ({
        recipeId: recipe.id, x: x + 24, y: y + 92 + index * 52, width: divider - x - 44, height: 44
      })),
      craft: { x: divider + 46, y: y + height - 76, width: width - (divider - x) - 70, height: 42 }
    };
  }

  handleInput({ inputManager, gamepad, viewWidth = 1280, viewHeight = 720 } = {}) {
    if (!this.visible) return false;
    if (this.busy || !inputManager) return true;
    const up = inputManager.isKeyPressed?.('arrowup')
      || gamepad?.isButtonPressed?.(PadButton.DPAD_UP) === true;
    const down = inputManager.isKeyPressed?.('arrowdown')
      || gamepad?.isButtonPressed?.(PadButton.DPAD_DOWN) === true;
    const navigationOffset = up ? -1 : (down ? 1 : this._getLeftStickNavigationOffset(gamepad));
    if (navigationOffset) this._moveSelection(navigationOffset);
    const layout = this._layout(viewWidth, viewHeight);
    this._handlePointer(inputManager, layout);
    const confirmed = inputManager.isKeyPressed?.('e') || inputManager.isKeyPressed?.('enter')
      || gamepad?.isButtonPressed?.(PadButton.A) === true
      || gamepad?.isButtonPressed?.(PadButton.X) === true;
    if (confirmed) this._confirm();
    const cancelled = inputManager.isKeyPressed?.('escape')
      || gamepad?.isButtonPressed?.(PadButton.B) === true;
    if (cancelled) this.onCommand({ type: 'close' });
    return true;
  }

  _handlePointer(inputManager, layout) {
    if (!inputManager.isMouseClicked?.() || inputManager.isMouseClickHandled?.()) return;
    const point = inputManager.getMousePosition?.() || { x: -1, y: -1 };
    inputManager.markMouseClickHandled?.();
    if (inside(point, layout.close)) this.onCommand({ type: 'close' });
    else if (inside(point, layout.craft)) this._confirm();
    else {
      const row = layout.rows.find(box => inside(point, box));
      if (row) this.selectedRecipeId = row.recipeId;
    }
  }

  _confirm() {
    const recipe = this._selectedRecipe();
    if (this.busy || !recipe || recipe.enabled !== true) return;
    this.onCommand({
      type: 'selectRecipe',
      workstationId: this.snapshot?.workstationId || null,
      recipeId: recipe.id
    });
  }

  render(ctx, viewWidth = ctx?.canvas?.width || 1280, viewHeight = ctx?.canvas?.height || 720) {
    if (!this.visible || !this.snapshot || !ctx) return;
    const layout = this._layout(viewWidth, viewHeight);
    const recipe = this._selectedRecipe();
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.fillRect(0, 0, viewWidth, viewHeight);
    ctx.fillStyle = 'rgba(25, 27, 29, 0.98)';
    ctx.strokeStyle = '#c49a52';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(layout.x, layout.y, layout.width, layout.height, 10);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f0d080';
    ctx.font = 'bold 22px Arial';
    ctx.fillText(this.snapshot.title || '配方选择', layout.x + layout.width / 2, layout.y + 32);
    ctx.strokeStyle = '#665239';
    ctx.beginPath();
    ctx.moveTo(layout.divider, layout.y + 68);
    ctx.lineTo(layout.divider, layout.y + layout.height - 22);
    ctx.stroke();

    ctx.font = 'bold 14px Arial';
    ctx.fillStyle = '#c9c9c9';
    ctx.textAlign = 'left';
    ctx.fillText('制作物品', layout.x + 24, layout.y + 70);
    layout.rows.forEach((box, index) => this._renderRecipeRow(ctx, box, this._recipes()[index]));

    ctx.fillStyle = '#c9c9c9';
    ctx.font = 'bold 14px Arial';
    ctx.fillText('所需材料', layout.divider + 28, layout.y + 92);
    if (recipe) {
      ctx.fillStyle = '#f0d080';
      ctx.font = 'bold 19px Arial';
      ctx.fillText(recipe.name || '未知配方', layout.divider + 28, layout.y + 124);
      ctx.fillStyle = '#b9b9b9';
      ctx.font = '13px Arial';
      ctx.fillText(recipe.description || '', layout.divider + 28, layout.y + 148);
      (recipe.materials || []).forEach((material, index) => {
        const enough = material.available >= material.quantity;
        ctx.fillStyle = enough ? '#9ad897' : '#e57b70';
        ctx.font = '15px Arial';
        ctx.fillText(`${material.name}  ${material.available}/${material.quantity}`, layout.divider + 34, layout.y + 188 + index * 34);
      });
      if (recipe.enabled !== true) {
        ctx.fillStyle = '#e57b70';
        ctx.font = '13px Arial';
        ctx.fillText(recipe.disabledReason || '材料不足，暂时无法制作。', layout.divider + 28, layout.craft.y - 20);
      }
    }
    this._renderButton(ctx, layout.craft, this.busy ? '正在结算……' : (this.snapshot.actionLabel || '制作'),
      this.busy || recipe?.enabled !== true);
    this._renderButton(ctx, layout.close, '×', false);
    ctx.fillStyle = this.snapshot.statusType === 'error' ? '#ef766d' : '#9fd69a';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(this.snapshot.statusMessage || `${InputHints.phrase('modalNavigate')}选择，${InputHints.phrase('confirm')}确认，${InputHints.phrase('modalCancel')}关闭`,
      layout.x + layout.width / 2, layout.y + layout.height - 16);
    ctx.restore();
  }

  _renderRecipeRow(ctx, box, recipe = {}) {
    const selected = recipe.id === this.selectedRecipeId;
    const enabled = recipe.enabled === true;
    ctx.fillStyle = selected ? 'rgba(196,154,82,0.24)' : 'rgba(255,255,255,0.04)';
    ctx.strokeStyle = selected ? '#dcb565' : '#555555';
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.fillStyle = enabled ? (selected ? '#f1d48c' : '#dedede') : '#8b8b8b';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(recipe.name || '未知配方', box.x + 10, box.y + 16);
    ctx.font = '12px Arial';
    ctx.fillText(recipe.summary || recipe.disabledReason || '', box.x + 10, box.y + 32);
  }

  _renderButton(ctx, box, text, disabled) {
    ctx.fillStyle = disabled ? '#4b4b4b' : '#72572f';
    ctx.strokeStyle = disabled ? '#686868' : '#d3a85b';
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.fillStyle = disabled ? '#a0a0a0' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 14px Arial';
    ctx.fillText(text, box.x + box.width / 2, box.y + box.height / 2);
  }
}

export default RecipeSelectionView;
