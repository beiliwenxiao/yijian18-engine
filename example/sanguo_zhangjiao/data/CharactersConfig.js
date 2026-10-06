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
 * CharactersConfig - 可选主角配置
 *
 * 定义登录时可供玩家选择的主角列表。
 * 每个条目用于：
 *   1. 角色选择界面的预览（previewImage / name）
 *   2. 创建玩家实体时的精灵配置（spriteSheet / spriteConfig）
 *
 * 精灵渲染说明：
 *   - 动画精灵（4x8）：spriteConfig.useAnimatedSprite = true，spriteSheet 指向已注册的动画图
 *   - 静态单图：spriteConfig.isStatic = true，spriteSheet 指向已注册的整图（如 test_001.jpg）
 *
 * 路径相对于 index.html 所在目录（example/sanguo_zhangjiao/）。
 */
export const CharactersConfig = [
  {
    id: 'refugee',
    name: '柔弱女子',
    class: 'refugee',
    // 角色选择界面预览图
    previewImage: 'assets/images/zhujiao.png',
    // 骨骼驱动（混合模式）：skeleton.player 走 Manifest mode='skeleton'，
    // 身体槽位帧表由 PlayerSkeletonStateMapper 按 girl.png（player.animated）4×8 布局计算
    spriteSheet: 'skeleton.player',
    spriteConfig: null, // 为空表示使用 EntityFactory 默认动画精灵配置
  },
];

export default CharactersConfig;
