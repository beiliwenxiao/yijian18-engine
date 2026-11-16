/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-02-10
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

import { UIStrategy } from './UIStrategy.js';

/**
 * MobileUIStrategy - 移动（触屏）UI 装配策略
 *
 * - 底部控制栏隐藏血球/蓝球和数字快捷键（手指操作，数字键无意义）
 * - 显示左上角玩家状态 HUD（头像 + 昵称 + 血条 + 蓝条）替代底部血球
 */
export class MobileUIStrategy extends UIStrategy {
  get platform() {
    return 'mobile';
  }

  getBottomControlBarOptions() {
    return { showOrbs: false, showHotkeyNumbers: false };
  }

  isBottomControlBarVisible() {
    // 移动端不再使用引擎底部控制栏，改用 DOM 的右侧动作按钮 + 底部快捷栏
    return false;
  }

  isPlayerStatusHUDVisible() {
    return true;
  }

  layoutPlayerStatusHUD(hud, width, height) {
    // 玩家 HUD 是独立面板：位置/大小由 UI 布局 hud-panel 条目管理，这里不再强制钉位
  }

  /**
   * 移动端背包：3 行 5 列，带滚动条
   */
  getInventoryOptions() {
    const slotSize = 50;
    const slotPadding = 5;
    const slotsPerRow = 5;
    const maxVisibleRows = 3;
    // 宽度：左边距20 + 列宽 - 末尾padding + 滚动条(8+4) + 右边距16
    const width = 20 + slotsPerRow * (slotSize + slotPadding) - slotPadding + 12 + 16;
    // 高度：顶部80 + 行高 - 末尾padding + 底部留白(金币行)40
    const height = 80 + maxVisibleRows * (slotSize + slotPadding) - slotPadding + 40;
    // 筛选按钮：缩短并缩进面板内（5个按钮均匀排布）
    const filterButtonWidth = 46;
    const filterButtonGap = 6;
    const filterButtonStartX = 20;
    return {
      slotSize, slotPadding, slotsPerRow, maxVisibleRows, width, height,
      filterButtonWidth, filterButtonGap, filterButtonStartX,
      showTooltip: false
    };
  }

  /**
   * 移动端背包：水平居中，底部与底部快捷栏对齐
   */
  layoutInventoryPanel(panel, width, height) {
    if (!panel) return;
    panel.x = Math.round((width - panel.width) / 2);
    // 底部对齐：背包下移 10px（bottomGap 78 → 68）
    const bottomGap = 58;
    panel.y = Math.max(10, height - bottomGap - panel.height);
  }

  /**
   * 移动端统一背包：水平居中，避免遮住底部操作区。
   */
  layoutBackpackPanel(panel, width, height) {
    if (!panel) return;
    panel.x = Math.max(10, Math.round((width - panel.width) / 2));
    const bottomGap = 58;
    panel.y = Math.max(10, height - bottomGap - panel.height);
    if (typeof panel.layout === 'function') panel.layout();
  }

  /**
   * 移动端装备/角色面板：底部与底部快捷栏对齐（左侧）
   */
  layoutPlayerInfoPanel(panel, width, height) {
    if (!panel) return;
    panel.x = Math.round((width - panel.width) / 2);
    const bottomGap = 68;
    panel.y = Math.max(10, height - bottomGap - panel.height);
  }

  /**
   * 移动端角色面板选项：横排、更宽更矮
   */
  getPlayerInfoOptions() {
    return {
      width: 420,
      height: 280,
      horizontalLayout: true
    };
  }
}

export default MobileUIStrategy;
