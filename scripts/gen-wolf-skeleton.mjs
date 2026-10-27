/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-10-26
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

// 生成狼骨骼资产 wolf.json（v2：对接 assets/images/units/parts/ 的 7 件套正式部件）。
// 纯 node，可重复执行：node scripts/gen-wolf-skeleton.mjs
// 部件（manifest assetId → sourceFile）：body(96×64)/neck/head/jaw/tail/leg-upper/leg-lower。
// 骨架 11 骨：root/body/neck/head/jaw/tail + 前后腿各两段（upper/lower ×左右 2 条 = 4+4）。
// 锚点约定：各部件预摆图（共享画布）包围盒反推关节锚点，attachment 偏移 = pivot − 锚点，
// 内容锚点像素 = 骨点（部件随骨运动，预摆图只用于读关节相对位置）。
// 动作：idle_side / walk_side / run_side / attack_side（jaw 咬合）/ hurt / death。
import { writeFileSync, readFileSync } from 'node:fs';

const OUT = 'example/sanguo_zhangjiao/assets/skeletons/skeleton.wolf.json';
const MANIFEST = 'example/sanguo_zhangjiao/assets/manifests/assets.json';

const img = (assetId, x, y, width = 64, height = 64) => (
  { type: 'image', assetId, x, y, rot: 0, width, height, visible: true }
);

function loopTrack(bone, durationMs, samples) {
  const keys = samples.map((value, index) => ({ t: Math.round((index / samples.length) * durationMs), ...value }));
  return { bone, keys };
}

function clip(name, durationMs, loop, tracks) {
  return { name, durationMs, loop, tracks };
}

/* 骨骼树（root(0,0)=脚底中心，y 向下为正；头朝 -x）：
 *   root(0,0)
 *   └─ body(2,-18)                          体轴中心
 *      ├─ neck(-12,6)                       颈根（颈内容底部）
 *      │  └─ head(0,-6)                     颈窝
 *      │     └─ jaw(-7,1)                   颌关节（咬合绕此旋转）
 *      ├─ tail(-17,1)                       尾根（尾向 -x 平伸）
 *      ├─ legFL(-18,2) ─ legFLlower(0,7)   前左（近侧）两段
 *      ├─ legFR(-15,2) ─ legFRlower(0,7)   前右（远侧）
 *      ├─ legHL(14,2)  ─ legHLlower(0,7)   后左（近侧）
 *      └─ legHR(17,2)  ─ legHRlower(0,7)   后右（远侧）
 */
function buildWolfDoc() {
  const legBone = (id, parent, x) => ({ id, parent, x, y: 2, rot: 0, scaleX: 1, scaleY: 1, length: 16 });
  const lowerBone = (id, parent) => ({ id, parent, x: 0, y: 7, rot: 0, scaleX: 1, scaleY: 1, length: 12 });
  const bones = [
    { id: 'root', parent: null, x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 18 },
    { id: 'body', parent: 'root', x: 2, y: -18, rot: 0, scaleX: 1, scaleY: 1, length: 30 },
    { id: 'neck', parent: 'body', x: -12, y: 6, rot: 0, scaleX: 1, scaleY: 1, length: 14 },
    { id: 'head', parent: 'neck', x: 0, y: -6, rot: 0, scaleX: 1, scaleY: 1, length: 18 },
    { id: 'jaw', parent: 'head', x: -7, y: 1, rot: 0, scaleX: 1, scaleY: 1, length: 12 },
    { id: 'tail', parent: 'body', x: -17, y: 1, rot: 0, scaleX: 1, scaleY: 1, length: 20 },
    legBone('legFL', 'body', -18), lowerBone('legFLlower', 'legFL'),
    legBone('legFR', 'body', -15), lowerBone('legFRlower', 'legFR'),
    legBone('legHL', 'body', 14), lowerBone('legHLlower', 'legHL'),
    legBone('legHR', 'body', 17), lowerBone('legHRlower', 'legHR')
  ];
  const slots = [
    { id: 'shadow', bone: 'root', z: 0, attachment: { type: 'empty' } },
    { id: 'tail', bone: 'tail', z: 1, attachment: img('wolf.parts.tail', -1, 2) },
    { id: 'legFR', bone: 'legFR', z: 2, attachment: img('wolf.parts.leg-upper', 0, 1) },
    { id: 'legFRlower', bone: 'legFRlower', z: 2, attachment: img('wolf.parts.leg-lower', 0, 1) },
    { id: 'legHR', bone: 'legHR', z: 2, attachment: img('wolf.parts.leg-upper', 0, 1) },
    { id: 'legHRlower', bone: 'legHRlower', z: 2, attachment: img('wolf.parts.leg-lower', 0, 1) },
    { id: 'bodySlot', bone: 'body', z: 3, attachment: img('wolf.parts.body', -1.5, 2.5, 96, 64) },
    { id: 'legFL', bone: 'legFL', z: 4, attachment: img('wolf.parts.leg-upper', 0, 1) },
    { id: 'legFLlower', bone: 'legFLlower', z: 4, attachment: img('wolf.parts.leg-lower', 0, 1) },
    { id: 'legHL', bone: 'legHL', z: 4, attachment: img('wolf.parts.leg-upper', 0, 1) },
    { id: 'legHLlower', bone: 'legHLlower', z: 4, attachment: img('wolf.parts.leg-lower', 0, 1) },
    { id: 'neck', bone: 'neck', z: 5, attachment: img('wolf.parts.neck', -6, -3) },
    { id: 'headSlot', bone: 'head', z: 6, attachment: img('wolf.parts.head', -6, 3) },
    { id: 'jaw', bone: 'jaw', z: 7, attachment: img('wolf.parts.jaw', 1, 2) }
  ];
  const trot = (upper, lowerShift) => ([
    { rot: -upper }, { rot: lowerShift, ease: 'easeInOut' },
    { rot: upper, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
  ]);
  const clips = [
    // 待机：体轴呼吸 + 尾摆 + 头微晃 + 下颌偶张
    clip('idle_side', 2400, true, [
      loopTrack('body', 2400, [
        { y: -18 }, { y: -19.5, ease: 'easeInOut' }, { y: -18, ease: 'easeInOut' }
      ]),
      loopTrack('tail', 2400, [
        { rot: -7 }, { rot: 7, ease: 'easeInOut' }, { rot: -7, ease: 'easeInOut' }
      ]),
      loopTrack('head', 2400, [
        { rot: 0 }, { rot: -3.5, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      loopTrack('neck', 2400, [
        { rot: 0 }, { rot: 2, ease: 'easeInOut' }, { rot: 0, ease: 'easeInOut' }
      ]),
      { bone: 'jaw', keys: [
        { t: 0, rot: 0 }, { t: 900, rot: 9, ease: 'easeInOut' },
        { t: 1300, rot: 9 }, { t: 1700, rot: 0, ease: 'easeInOut' }, { t: 2400, rot: 0 }
      ] }
    ]),
    // 行走：trot 对角步态（FL+HR 同相、FR+HL 反相），下段滞后摆
    clip('walk_side', 560, true, [
      loopTrack('root', 560, [
        { y: 0 }, { y: -2.5, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }, { y: -2.5, ease: 'easeInOut' }
      ]),
      loopTrack('legFL', 560, trot(20, 0)),
      loopTrack('legFLlower', 560, trot(14, -6)),
      loopTrack('legHR', 560, trot(20, 0)),
      loopTrack('legHRlower', 560, trot(14, -6)),
      loopTrack('legFR', 560, trot(-20, 0)),
      loopTrack('legFRlower', 560, trot(-14, 6)),
      loopTrack('legHL', 560, trot(-20, 0)),
      loopTrack('legHLlower', 560, trot(-14, 6)),
      loopTrack('body', 560, [
        { rot: -2 }, { rot: 2, ease: 'easeInOut' }, { rot: -2, ease: 'easeInOut' }
      ]),
      loopTrack('tail', 560, [
        { rot: -6 }, { rot: 6, ease: 'easeInOut' }, { rot: -6, ease: 'easeInOut' }
      ]),
      loopTrack('head', 560, [
        { rot: 2.5 }, { rot: -2.5, ease: 'easeInOut' }, { rot: 2.5, ease: 'easeInOut' }
      ])
    ]),
    // 奔跑：步幅加大 + 腾空 + 体轴俯仰 + 颈前探
    clip('run_side', 420, true, [
      loopTrack('root', 420, [
        { y: 0 }, { y: -6, ease: 'easeInOut' }, { y: 0, ease: 'easeInOut' }, { y: -6, ease: 'easeInOut' }
      ]),
      loopTrack('legFL', 420, trot(34, 4)),
      loopTrack('legFLlower', 420, trot(24, -10)),
      loopTrack('legHR', 420, trot(34, 4)),
      loopTrack('legHRlower', 420, trot(24, -10)),
      loopTrack('legFR', 420, trot(-34, -4)),
      loopTrack('legFRlower', 420, trot(-24, 10)),
      loopTrack('legHL', 420, trot(-34, -4)),
      loopTrack('legHLlower', 420, trot(-24, 10)),
      loopTrack('body', 420, [
        { rot: -4 }, { rot: 4, ease: 'easeInOut' }, { rot: -4, ease: 'easeInOut' }
      ]),
      loopTrack('neck', 420, [
        { rot: 4 }, { rot: -4, ease: 'easeInOut' }, { rot: 4, ease: 'easeInOut' }
      ]),
      loopTrack('tail', 420, [
        { rot: 10 }, { rot: -8, ease: 'easeInOut' }, { rot: 10, ease: 'easeInOut' }
      ])
    ]),
    // 扑咬：颈前伸 + 头下压 + jaw 大张开合 + 前腿扑抬（非循环）
    clip('attack_side', 480, false, [
      { bone: 'jaw', keys: [
        { t: 0, rot: 0 }, { t: 160, rot: 26, ease: 'easeInOut' },
        { t: 300, rot: 2, ease: 'easeInOut' }, { t: 480, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'head', keys: [
        { t: 0, rot: 0 }, { t: 160, rot: 8 }, { t: 300, rot: 15, ease: 'easeInOut' }, { t: 480, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'neck', keys: [
        { t: 0, rot: 0 }, { t: 160, rot: -7 }, { t: 300, rot: -11, ease: 'easeInOut' }, { t: 480, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'body', keys: [
        { t: 0, rot: 0, x: 2 }, { t: 160, rot: 3, x: 6 }, { t: 300, rot: -5, x: -4, ease: 'easeInOut' }, { t: 480, rot: 0, x: 2, ease: 'easeInOut' }
      ] },
      { bone: 'legFL', keys: [
        { t: 0, rot: 0 }, { t: 160, rot: 12 }, { t: 300, rot: -28, ease: 'easeInOut' }, { t: 480, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'legFR', keys: [
        { t: 0, rot: 0 }, { t: 160, rot: 12 }, { t: 300, rot: -22, ease: 'easeInOut' }, { t: 480, rot: 0, ease: 'easeInOut' }
      ] },
      { bone: 'tail', keys: [
        { t: 0, rot: 0 }, { t: 300, rot: -14, ease: 'easeInOut' }, { t: 480, rot: 0, ease: 'easeInOut' }
      ] }
    ]),
    // 挨打：缩体后仰 + 头后甩 + jaw 痛张（非循环）
    clip('hurt', 260, false, [
      { bone: 'body', keys: [
        { t: 0, rot: 0, x: 2 }, { t: 90, rot: -9, x: -2, ease: 'easeInOut' }, { t: 260, rot: -2, x: 2, ease: 'easeInOut' }
      ] },
      { bone: 'head', keys: [
        { t: 0, rot: 0 }, { t: 90, rot: -11, ease: 'easeInOut' }, { t: 260, rot: -2, ease: 'easeInOut' }
      ] },
      { bone: 'jaw', keys: [
        { t: 0, rot: 0 }, { t: 90, rot: 14, ease: 'easeInOut' }, { t: 260, rot: 2, ease: 'easeInOut' }
      ] },
      { bone: 'tail', keys: [
        { t: 0, rot: 0 }, { t: 90, rot: 10, ease: 'easeInOut' }, { t: 260, rot: 2, ease: 'easeInOut' }
      ] }
    ]),
    // 倒地：体轴翻平 + 四腿伸直 + 头垂 + jaw 松张（非循环）
    clip('death', 560, false, [
      { bone: 'body', keys: [
        { t: 0, rot: 0, y: -18 }, { t: 420, rot: 85, y: -6, ease: 'easeInOut' }, { t: 560, rot: 85, y: -6 }
      ] },
      { bone: 'head', keys: [
        { t: 0, rot: 0 }, { t: 420, rot: 14, ease: 'easeInOut' }, { t: 560, rot: 14 }
      ] },
      { bone: 'jaw', keys: [
        { t: 0, rot: 0 }, { t: 420, rot: 18, ease: 'easeInOut' }, { t: 560, rot: 18 }
      ] },
      { bone: 'legFL', keys: [ { t: 0, rot: 0 }, { t: 420, rot: 36, ease: 'easeInOut' }, { t: 560, rot: 36 } ] },
      { bone: 'legFLlower', keys: [ { t: 0, rot: 0 }, { t: 420, rot: 14, ease: 'easeInOut' }, { t: 560, rot: 14 } ] },
      { bone: 'legFR', keys: [ { t: 0, rot: 0 }, { t: 420, rot: 26, ease: 'easeInOut' }, { t: 560, rot: 26 } ] },
      { bone: 'legFRlower', keys: [ { t: 0, rot: 0 }, { t: 420, rot: 10, ease: 'easeInOut' }, { t: 560, rot: 10 } ] },
      { bone: 'legHL', keys: [ { t: 0, rot: 0 }, { t: 420, rot: 32, ease: 'easeInOut' }, { t: 560, rot: 32 } ] },
      { bone: 'legHLlower', keys: [ { t: 0, rot: 0 }, { t: 420, rot: 12, ease: 'easeInOut' }, { t: 560, rot: 12 } ] },
      { bone: 'legHR', keys: [ { t: 0, rot: 0 }, { t: 420, rot: 22, ease: 'easeInOut' }, { t: 560, rot: 22 } ] },
      { bone: 'legHRlower', keys: [ { t: 0, rot: 0 }, { t: 420, rot: 8, ease: 'easeInOut' }, { t: 560, rot: 8 } ] },
      { bone: 'tail', keys: [ { t: 0, rot: 0 }, { t: 420, rot: 22, ease: 'easeInOut' }, { t: 560, rot: 22 } ] }
    ])
  ];
  return {
    schemaVersion: 1,
    skeletonId: 'skeleton.wolf',
    meta: { width: 96, height: 64 },
    defaultClip: 'idle_side',
    bones,
    slots,
    clips
  };
}

const doc = buildWolfDoc();
writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`written: ${OUT} (bones=14 slots=14 clips=6, parts from units/parts 7-件套)`);

// 骨骼资产 manifest 登记（幂等 upsert；编辑器资产下拉列表 = Manifest 中 runtime2D.mode==='skeleton' 的条目）
{
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  if (!Array.isArray(manifest.assets)) throw new Error('manifest.assets 缺失');
  const entry = {
    assetId: 'skeleton.wolf',
    imageId: 'skeleton.wolf',
    category: 'character-skeleton',
    usage: ['wolf-skeleton'],
    sourceFile: 'assets/skeletons/skeleton.wolf.json',
    runtime2D: { path: 'assets/skeletons/skeleton.wolf.json', mode: 'skeleton' },
    runtime3D: { mode: 'billboard', sourceAssetId: 'skeleton.wolf' },
    pivot: { x: 0.5, y: 1 },
    bounds: { width: doc.meta.width, height: doc.meta.height },
    animations: [],
    targetPhase: 'P1',
    status: 'ai-generated',
    revision: 1
  };
  const byId = new Map(manifest.assets.map(asset => [asset.assetId, asset]));
  byId.set(entry.assetId, entry);
  manifest.assets = [...byId.values()];
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('manifest upserted: skeleton.wolf');
}
