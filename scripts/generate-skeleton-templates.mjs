/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * generate-skeleton-templates.mjs
 * 生成 7 个骨架模板（tpl.*）到 assets/skeletons/templates/：
 *   humanoid / wolf / horse / mounted / siege_ram / siege_catapult / siege_tower
 * 模板 = 普通骨架 JSON（同构 player.json），槽位全部 empty 占位，仅带 idle 微动剪辑。
 * 使用即深拷贝（编辑器「新建自模板」），与模板无数据关联（设计文档 〇、模板独立性原则）。
 * 重复运行幂等。用法：node scripts/generate-skeleton-templates.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSkeletonAsset } from '../src/core/validation/SkeletonAssetValidator.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'example/sanguo_zhangjiao/assets/skeletons/templates');

/** 骨骼定义快捷构造。 */
const bone = (id, parent, x, y, length, rot = 0) => ({ id, parent, x, y, rot, scaleX: 1, scaleY: 1, length });
/** 关键帧快捷构造。 */
const key = (t, extra = {}) => ({ t, x: 0, y: 0, rot: 0, scaleX: null, scaleY: null, ease: 'easeInOut', ...extra });
/** 轨道快捷构造。 */
const track = (boneId, keys) => ({ bone: boneId, keys });
/** 摆动轨道（0 → 半程反向 → 回位）。 */
const wiggle = (boneId, deg, durationMs) => track(boneId, [
  key(0, { rot: deg }), key(durationMs / 2, { rot: -deg }), key(durationMs, { rot: deg })
]);
/** empty 占位槽位（使用时拖图挂载）。 */
const slotFor = (boneId, z) => ({ id: `slot_${boneId}`, bone: boneId, z, visible: true, locked: false, attachment: { type: 'empty' } });

/** 组装模板文档：bones/slots/idle 由各拓扑构建器给出。 */
function makeDoc(templateId, meta, builders) {
  const bones = builders.bones();
  const slotBones = bones.filter(b => b.parent !== null && !builders.slotExclude?.includes(b.id));
  return {
    schemaVersion: 1,
    skeletonId: templateId,
    meta,
    defaultClip: 'idle',
    bones,
    slots: slotBones.map((b, index) => slotFor(b.id, index + 1)),
    clips: [{ name: 'idle', durationMs: builders.idleMs, loop: true, tracks: builders.idleTracks() }]
  };
}

/* ---- 拓扑构建器（命名与设计文档一致，跨模板同名骨语义相同） ---- */

const TEMPLATES = {
  // 人形（=player.json 骨架派生，清空业务附件）
  'tpl.humanoid': makeDoc('tpl.humanoid', { width: 64, height: 64 }, {
    idleMs: 1600,
    bones: () => [
      bone('hips', null, 0, -26, 14), // 骨架根=骨盆（对齐 Spine/Unity；实体定位原点=脚底由渲染承担）
      bone('torso', 'hips', 0, -2, 20),
      bone('head', 'torso', 0, -20, 16),
      bone('back', 'torso', 0, -4, 18),
      bone('armUL', 'torso', -7, -16, 12), bone('armFL', 'armUL', 0, 12, 13),
      bone('armUR', 'torso', 7, -16, 12), bone('armFR', 'armUR', 0, 12, 13),
      bone('thighL', 'hips', -5, -1, 13), bone('calfL', 'thighL', 0, 13, 14),
      bone('thighR', 'hips', 5, -1, 13), bone('calfR', 'thighR', 0, 13, 14)
    ],
    idleTracks: () => [wiggle('torso', 2, 1600), wiggle('head', 3, 1600), wiggle('armUL', 3, 1600), wiggle('armUR', 3, 1600)]
  }),

  // 狼（四足，水平朝向 +X；四腿两节 + 双节尾 + 颌）
  'tpl.wolf': makeDoc('tpl.wolf', { width: 96, height: 64 }, {
    idleMs: 1200,
    bones: () => [
      bone('spine', null, -2, -16, 16), // 骨架根=躯干（四足）
      bone('chest', 'spine', 10, -4, 14),
      bone('neck', 'chest', 8, -8, 10),
      bone('head', 'neck', 6, -4, 12),
      bone('jaw', 'head', 2, 6, 8),
      bone('tail1', 'spine', -12, -2, 10), bone('tail2', 'tail1', -8, 0, 8),
      bone('legFL_upper', 'chest', 8, 6, 12), bone('legFL_lower', 'legFL_upper', 0, 12, 12),
      bone('legFR_upper', 'chest', 8, 6, 12), bone('legFR_lower', 'legFR_upper', 0, 12, 12),
      bone('legHL_upper', 'spine', -8, 6, 12), bone('legHL_lower', 'legHL_upper', 0, 12, 12),
      bone('legHR_upper', 'spine', -8, 6, 12), bone('legHR_lower', 'legHR_upper', 0, 12, 12)
    ],
    slotExclude: ['legFR_upper', 'legFR_lower', 'legHR_upper', 'legHR_lower'],
    idleTracks: () => [wiggle('spine', 2, 1200), wiggle('head', 3, 1200), wiggle('tail1', 8, 1200), wiggle('tail2', 12, 1200)]
  }),

  // 马（长颈双节 + 鬃毛 + 鞍座骨，供骑乘模板挂 rider）
  'tpl.horse': makeDoc('tpl.horse', { width: 128, height: 88 }, {
    idleMs: 1600,
    bones: () => [
      bone('spine', null, -2, -22, 18), // 骨架根=躯干（四足/骑乘）
      bone('chest', 'spine', 12, -4, 16),
      bone('neck1', 'chest', 10, -10, 12),
      bone('neck2', 'neck1', 6, -10, 12),
      bone('head', 'neck2', 6, -4, 14),
      bone('tail1', 'spine', -14, -4, 12), bone('tail2', 'tail1', -10, 0, 10),
      bone('saddle', 'spine', 0, -6, 8),
      bone('legFL_upper', 'chest', 10, 8, 16), bone('legFL_lower', 'legFL_upper', 0, 16, 16),
      bone('legFR_upper', 'chest', 10, 8, 16), bone('legFR_lower', 'legFR_upper', 0, 16, 16),
      bone('legHL_upper', 'spine', -10, 8, 16), bone('legHL_lower', 'legHL_upper', 0, 16, 16),
      bone('legHR_upper', 'spine', -10, 8, 16), bone('legHR_lower', 'legHR_upper', 0, 16, 16)
    ],
    slotExclude: ['legFR_upper', 'legFR_lower', 'legHR_upper', 'legHR_lower'],
    idleTracks: () => [wiggle('neck1', 3, 1600), wiggle('neck2', 4, 1600), wiggle('head', 2, 1600), wiggle('tail1', 8, 1600), wiggle('tail2', 10, 1600)]
  }),

  // 骑马 = 马 + 鞍上骑手（上半身，无腿）
  'tpl.mounted': makeDoc('tpl.mounted', { width: 128, height: 96 }, {
    idleMs: 1600,
    bones: () => [
      bone('spine', null, -2, -22, 18), // 骨架根=躯干（四足/骑乘）
      bone('chest', 'spine', 12, -4, 16),
      bone('neck1', 'chest', 10, -10, 12),
      bone('neck2', 'neck1', 6, -10, 12),
      bone('head', 'neck2', 6, -4, 14),
      bone('tail1', 'spine', -14, -4, 12), bone('tail2', 'tail1', -10, 0, 10),
      bone('saddle', 'spine', 0, -6, 8),
      bone('legFL_upper', 'chest', 10, 8, 16), bone('legFL_lower', 'legFL_upper', 0, 16, 16),
      bone('legFR_upper', 'chest', 10, 8, 16), bone('legFR_lower', 'legFR_upper', 0, 16, 16),
      bone('legHL_upper', 'spine', -10, 8, 16), bone('legHL_lower', 'legHL_upper', 0, 16, 16),
      bone('legHR_upper', 'spine', -10, 8, 16), bone('legHR_lower', 'legHR_upper', 0, 16, 16),
      bone('rider_torso', 'saddle', 0, -8, 16),
      bone('rider_head', 'rider_torso', 0, -14, 12),
      bone('rider_armUL', 'rider_torso', -5, -10, 10), bone('rider_armFL', 'rider_armUL', 0, 10, 10),
      bone('rider_armUR', 'rider_torso', 5, -10, 10), bone('rider_armFR', 'rider_armUR', 0, 10, 10)
    ],
    slotExclude: ['legFR_upper', 'legFR_lower', 'legHR_upper', 'legHR_lower'],
    idleTracks: () => [
      wiggle('neck1', 3, 1600), wiggle('tail1', 8, 1600),
      wiggle('rider_torso', 2, 1600), wiggle('rider_head', 3, 1600), wiggle('rider_armUL', 3, 1600)
    ]
  }),

  // 冲车（破城墙）：车架+四轮+顶棚+幕布+悬摆撞木+三向推车兵挂点
  'tpl.siege_ram': makeDoc('tpl.siege_ram', { width: 96, height: 72 }, {
    idleMs: 2000,
    bones: () => [
      bone('base', null, 0, -10, 36),
      bone('roof', 'base', 0, -24, 34),
      bone('cover', 'roof', 0, 4, 28),
      bone('ram_arm', 'roof', 0, 10, 34),
      bone('ram_head', 'ram_arm', 0, 30, 10),
      bone('wheelFL', 'base', 14, 8, 10), bone('wheelBL', 'base', -14, 8, 10),
      bone('wheelFR', 'base', 14, 8, 10), bone('wheelBR', 'base', -14, 8, 10),
      bone('pusherL', 'base', 18, -2, 8),
      bone('pusherR', 'base', -18, -2, 8),
      bone('pusherB', 'base', 0, 4, 8)
    ],
    slotExclude: ['wheelFR', 'wheelBR'],
    idleTracks: () => [wiggle('ram_arm', 3, 2000)]
  }),

  // 投石车（远程轰城墙）：车架+双轮+绞盘+抛臂（蓄力/抛射两段）+皮兜+配重
  'tpl.siege_catapult': makeDoc('tpl.siege_catapult', { width: 88, height: 80 }, {
    idleMs: 2400,
    bones: () => [
      bone('base', null, 0, -8, 34),
      bone('wheelF', 'base', 13, 6, 9),
      bone('wheelB', 'base', -13, 6, 9),
      bone('frame_winch', 'base', -12, -12, 8),
      bone('throw_arm', 'base', 2, -12, 28),
      bone('sling', 'throw_arm', 0, 26, 8),
      bone('counterweight', 'throw_arm', -4, 8, 10)
    ],
    idleTracks: () => [wiggle('throw_arm', 2, 2400), wiggle('sling', 1, 2400)]
  }),

  // 井阑（高塔，弓手上层射击）：底盘+四轮+三层塔身+顶层平台+爬梯+前盾
  'tpl.siege_tower': makeDoc('tpl.siege_tower', { width: 80, height: 144 }, {
    idleMs: 3000,
    bones: () => [
      bone('base', null, 0, -6, 36),
      bone('wheelFL', 'base', 14, 4, 8), bone('wheelBL', 'base', -14, 4, 8),
      bone('wheelFR', 'base', 14, 4, 8), bone('wheelBR', 'base', -14, 4, 8),
      bone('towerL1', 'base', 0, -10, 20),
      bone('towerL2', 'towerL1', 0, -18, 20),
      bone('towerL3', 'towerL2', 0, -18, 16),
      bone('top_platform', 'towerL3', 0, -12, 20),
      bone('ladder', 'towerL1', -12, -20, 52),
      bone('shield_front', 'towerL2', 8, -16, 16)
    ],
    slotExclude: ['wheelFR', 'wheelBR'],
    idleTracks: () => [wiggle('towerL3', 1, 3000), wiggle('top_platform', 1, 3000)]
  })
};

fs.mkdirSync(outDir, { recursive: true });
for (const [templateId, doc] of Object.entries(TEMPLATES)) {
  const validation = validateSkeletonAsset(doc);
  if (!validation.ok) {
    console.error(`✗ ${templateId} 校验失败:`);
    for (const error of validation.errors) console.error(`  ${error.path || ''}: ${error.message || error.reason || ''}`);
    process.exit(1);
  }
  const file = path.join(outDir, `${templateId}.json`);
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`✓ ${templateId}（bones=${doc.bones.length}, slots=${doc.slots.length}）→ ${path.relative(root, file)}`);
}
console.log(`完成：${Object.keys(TEMPLATES).length} 个模板`);
