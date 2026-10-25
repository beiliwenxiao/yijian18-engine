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
    id: 'female-hero',
    name: '女骑士',
    class: 'refugee',
    // 角色选择界面预览图（由 Stand/south 裁切放大）
    previewImage: 'assets/images/player/female-hero/preview.png',
    // 骨骼驱动（整帧模式）：skeleton.female-hero 走 Manifest mode='skeleton'，
    // 素材为 320×320 像素女骑士（约 85×220、7 头身），idle/walk 有 8 向手绘帧，
    // jump/attack/death/climb 4 向；PlayerLpcFrameMapper 按状态 + 朝向切帧表。
    // 整帧大图由 scripts/skeleton-pipeline/build-female-hero-assets.mjs 生成。
    spriteSheet: 'skeleton.female-hero',
    spriteConfig: null,
  },
  {
    id: 'refugee',
    name: '柔弱女子',
    class: 'refugee',
    // 角色选择界面预览图
    previewImage: 'assets/images/zhujiao.png',
    // 骨骼驱动（部件模式）：skeleton.player 走 Manifest mode='skeleton'，16 骨人形 rig，
    // 全套动作按朝向拆剪辑（walk/idle/jump × down/side/up + 斜向），由
    // PlayerSkeletonStateMapper 按 sprite.direction 选剪辑；
    // 头部三态槽位切显隐、躯干/腰/脚按形态换图（directionOffsets）、侧向左向由 sprite.flipX 镜像。
    // 动作数据由 scripts/skeleton-pipeline/rebuild-player-legs.mjs 保证腿脚落点（膝角/贴地）。
    spriteSheet: 'skeleton.player',
    spriteConfig: null, // 为空表示使用 EntityFactory 默认动画精灵配置
  },
  {
    id: 'female-hero-skeletal',
    name: '女骑士（骨骼）',
    class: 'refugee',
    previewImage: 'assets/images/player/female-hero/preview.png',
    // 骨骼驱动（部件模式）：skeleton.player-female 为路线 A —— 由像素站立帧按关节切片重建的
    // 16 骨 7 头身女性骨架（正/侧/背三套部件存于同一张图集，directionOffsets 按形态换切片）。
    // 静止姿态与素材像素级一致，动作沿用玩家骨架的剪辑（腿按贴地模型重算）。
    spriteSheet: 'skeleton.player-female',
    spriteConfig: null,
  },
];

export default CharactersConfig;
