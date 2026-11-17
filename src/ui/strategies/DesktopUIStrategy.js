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
 * DesktopUIStrategy - 桌面（键鼠）UI 装配策略
 *
 * - 底部控制栏显示血球/蓝球 + 数字快捷键
 * - 左上角同样显示玩家状态 HUD（头像 + 昵称 + 血条 + 蓝条），与移动端一致；
 *   底部血球/蓝球保持不变
 */
export class DesktopUIStrategy extends UIStrategy {
  get platform() {
    return 'desktop';
  }

  getBottomControlBarOptions() {
    // 血量/蓝量已由左上角玩家 HUD 面板承载，底栏不再显示血球/蓝球（保留数字快捷键）
    return { showOrbs: false, showHotkeyNumbers: true };
  }

  isPlayerStatusHUDVisible() {
    return true;
  }
}

export default DesktopUIStrategy;
