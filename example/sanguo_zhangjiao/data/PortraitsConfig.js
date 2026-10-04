/**
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 */

/**
 * PortraitsConfig - 对话头像配置
 *
 * 定义所有对话中使用的头像 key 与图片路径的映射。
 * DialogueBox 会根据对话节点的 portrait 字段查找此配置加载图片。
 *
 * 路径相对于 index.html 所在目录（example/sanguo_zhangjiao/）。
 */
export const PortraitsConfig = {
  zhangjiao:  'assets/images/zhangjiao.png',
  player:     'assets/images/zhujiao.png',
  huangjin_messenger: 'assets/images/huangjin-messenger.png',   // 黄巾信使
  huangjin_scout:     'assets/images/huangjin-scout.png',       // 黄巾斥候
  huangjin_soldier:   'assets/images/huangjin-soldier.png',     // 黄巾残兵
  refugee_woman:      'assets/images/refugee-woman.png',        // 妇人
  one_armed_refugee:  'assets/images/one-armed-refugee.png',    // 断臂饥民
};

export default PortraitsConfig;
