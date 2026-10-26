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

/**
 * SkeletonSpineExporter.js - 骨骼资产导出为 Spine JSON（3.8 格式）+ 图集描述
 *
 * 目标：让本引擎的骨骼动画能被主流引擎直接消费（spine-canvas / Spine Unity /
 * cocos-spine 等生态），避免被自有格式锁死。
 *
 * 映射要点（引擎差异 → 处理）：
 * - **骨骼继承模式**：Spine 的 transform（normal/onlyTranslation/onlyRotation/
 *   noRotationOrScale）与本引擎的 inherit（normal/noScale/noRotation/
 *   translationOnly）不是一一对应：`noScale→onlyRotation`、`translationOnly→
 *   onlyTranslation` 语义等价；`noRotation` 无等价（只能退化为 normal，有损）。
 * - **动画时间轴是相对 setup 的增量**：本引擎关键帧存绝对局部值，导出时
 *   translate/rotate 转成差值、scale 转成比例（Spine 语义）。
 * - **缺省帧（null 字段）**：本引擎缺省帧采样时取"下一有效值"（阶跃），
 *   Spine 时间轴缺该时刻会保持上一关键帧值 → 导出时在缺省帧位置补阶跃关键帧。
 * - **方向形态**：Spine 无「按方向换图」概念 → 每个形态导出为一个 **skin**
 *   （skin 名 = 形态键），目标端按方向 setSkin 即可切换形态。
 * - **挂图跟随缩放**：本引擎默认 slot.follow='noScale'（图片不随骨骼缩放变形），
 *   Spine 的附件天然跟随骨骼缩放 → 此项在 Spine 侧无法表达，记为有损。
 *
 * 本模块是纯函数（不读写文件）：图集像素合成与文件落盘由 scripts/ 的离线脚本完成。
 */

import { SKELETON_DIRECTION_KEYS } from '../animation/SkeletonDirection.js';

/** 骨骼继承模式 → Spine transform。null 表示无法表达（退化为 normal 且记有损）。 */
const TRANSFORM_MAP = {
  normal: 'normal',
  noScale: 'onlyRotation',
  noRotation: null,
  translationOnly: 'onlyTranslation'
};

/** 命名缓动 → Spine 贝塞尔控制点 [cx1, cy1, cx2, cy2]。linear 不写 curve。 */
const CURVE_MAP = {
  linear: null,
  easeInOut: [0.42, 0, 0.58, 1]
};

const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const str = value => (typeof value === 'string' ? value.trim() : '');

/**
 * 取该属性在时间轴上的有效值序列：[{ t, v }]，v 为 null 表示缺省帧。
 */
function propertySamples(keys, field) {
  return (keys || [])
    .map(key => ({ t: num(key?.t), v: key?.[field] === null || key?.[field] === undefined ? null : Number(key[field]) }))
    .sort((a, b) => a.t - b.t);
}

/**
 * 把本引擎的属性关键帧序列转成 Spine 时间轴条目（相对 setup 的增量/比例）。
 *
 * 缺省帧（null）在本引擎采样时取「下一有效值」（阶跃），Spine 会保持上一关键帧值，
 * 因此在缺省段起点补一条与下一有效值相同的关键帧，形成同样的阶跃
 * （缺省帧当帧本身仍有 1ms 窗口的差异，属可接受的近似）。
 *
 * @param {Array<Object>} keys - 本引擎关键帧（每帧含该字段或 null）
 * @param {string} field - 属性名（x/y/rot/scaleX/scaleY）
 * @param {(value:number)=>number} toSpine - 绝对值 → Spine 值（差值/比例）
 * @param {(time:number)=>number[]|null} [curveOf] - 该时刻的 Spine 贝塞尔控制点
 * @returns {Array<Array<number>>} Spine 时间轴条目
 */
export function buildSpineTimeline(keys, field, toSpine, curveOf) {
  const samples = propertySamples(keys, field);
  const timeline = [];
  let pending = null;
  for (const sample of samples) {
    if (sample.v !== null) {
      if (pending !== null) {
        // 缺省段 [pending, sample.t]：本引擎在缺省帧之后立即取该有效值（阶跃）
        // → 在缺省段起点补一条同值关键帧，得到同样的阶跃曲线
        timeline.push({ t: pending, v: toSpine(sample.v), curve: curveOf?.(pending) });
        pending = null;
      }
      timeline.push({ t: sample.t, v: toSpine(sample.v), curve: curveOf?.(sample.t) });
    } else if (pending === null) {
      pending = sample.t;
    }
  }
  // 末尾缺省段：本引擎保持最后有效值，Spine 保持上一关键帧值 → 一致，无需补帧
  return timeline.map(entry => {
    const row = [entry.t, entry.v];
    if (entry.curve) row.push(entry.curve);
    return row;
  });
}

/** 贝塞尔控制点分量保留 6 位小数（避免二进制浮点噪声进 JSON，误差远低于像素级）。 */
const roundCurve = value => Math.round(value * 1000000) / 1000000;
/** 手柄 x 钳制 [0,1]（与 parseSkeletonAsset 归一化同口径，保证段内时间单调）。 */
const clamp01 = value => Math.max(0, Math.min(1, value));

/**
 * 取该时刻关键帧的 Spine 曲线（段插值语义与引擎 SkeletonCurve.segmentProgress 对齐，
 * hold → 贝塞尔手柄 → 命名缓动 → 线性）：
 *   1. A.hold → "stepped"（阶跃段，Spine 保持本键值到下一键）；
 *   2. A.out 或 B.in 存在 → [out.x, out.y, 1-in.x, 1-in.y]——本引擎与 Spine 3.8 的
 *      curve 数组同为「段归一化贝塞尔控制点」，1:1 无损；缺省侧按 (1/3,1/3) 补齐；
 *   3. 命名缓动按引擎语义作用于「结束于本键」的段：段 A→B 取 B.ease || A.ease，
 *      写在 Spine A 键的 curve 上（Spine curve 描述「本键→下一键」段——旧实现取
 *      A.ease 导致缓动晚一段生效，已修正）；
 *   4. 都没有 → 不写 curve（Spine 缺省线性）。
 */
function makeCurveResolver(keys) {
  const ordered = (keys || [])
    .map(key => ({ t: num(key?.t), key }))
    .sort((a, b) => a.t - b.t);
  const byTime = new Map();
  ordered.forEach((entry, index) => {
    byTime.set(entry.t, { key: entry.key, next: ordered[index + 1]?.key || null });
  });
  return time => {
    const entry = byTime.get(time);
    if (!entry) return null;
    const { key, next } = entry;
    if (!next) return null; // 末键在 Spine 无后继段（循环回绕插值已记 report.lossy）
    if (key?.hold === true) return 'stepped';
    const outHandle = key?.out;
    const inHandle = next?.in;
    if (outHandle || inHandle) {
      return [
        roundCurve(clamp01(num(outHandle?.x, 1 / 3))),
        roundCurve(num(outHandle?.y, 1 / 3)),
        roundCurve(1 - clamp01(num(inHandle?.x, 1 / 3))),
        roundCurve(1 - num(inHandle?.y, 1 / 3))
      ];
    }
    return CURVE_MAP[next?.ease || key?.ease] || null;
  };
}

/**
 * 构建 translate 时间轴（[time, x, y, curve?]，Spine 为相对 setup 的偏移）。
 */
function buildTranslateTimeline(keys, setup, curveOf) {
  const xs = buildSpineTimeline(keys, 'x', value => value - setup.x, curveOf);
  const ys = buildSpineTimeline(keys, 'y', value => value - setup.y, curveOf);
  const times = new Set([...xs.map(entry => entry[0]), ...ys.map(entry => entry[0])]);
  const xMap = new Map(xs.map(entry => [entry[0], entry]));
  const yMap = new Map(ys.map(entry => [entry[0], entry]));
  return [...times].sort((a, b) => a - b).map(time => {
    const x = xMap.get(time);
    const y = yMap.get(time);
    const row = [time, x ? x[1] : 0, y ? y[1] : 0];
    const curve = (x && x[2]) || (y && y[2]);
    if (curve) row.push(curve);
    return row;
  });
}

/**
 * 构建 scale 时间轴（[time, x, y, curve?]，Spine 为相对 setup 的比例）。
 */
function buildScaleTimeline(keys, setup, curveOf) {
  const xs = buildSpineTimeline(keys, 'scaleX', value => (setup.scaleX ? value / setup.scaleX : 1), curveOf);
  const ys = buildSpineTimeline(keys, 'scaleY', value => (setup.scaleY ? value / setup.scaleY : 1), curveOf);
  const times = new Set([...xs.map(entry => entry[0]), ...ys.map(entry => entry[0])]);
  const xMap = new Map(xs.map(entry => [entry[0], entry]));
  const yMap = new Map(ys.map(entry => [entry[0], entry]));
  return [...times].sort((a, b) => a - b).map(time => {
    const x = xMap.get(time);
    const y = yMap.get(time);
    const row = [time, x ? x[1] : 1, y ? y[1] : 1];
    const curve = (x && x[2]) || (y && y[2]);
    if (curve) row.push(curve);
    return row;
  });
}

/**
 * 取槽位在指定形态下的附件参数（形态覆盖优先，逐字段回退正面基准）。
 */
function resolveFormAttachment(slot, formKey) {
  const attachment = slot?.attachment || {};
  const override = formKey === 'down' ? null : (attachment.directionOffsets?.[formKey] || null);
  const assetId = str(override?.assetId) || str(attachment.assetId) || str(attachment.spriteSheet);
  const width = num(override?.width) > 0 ? num(override.width) : num(attachment.width);
  const height = num(override?.height) > 0 ? num(override.height) : num(attachment.height);
  return {
    assetId,
    x: num(override?.x, num(attachment.x)),
    y: num(override?.y, num(attachment.y)),
    rotation: num(override?.rot, num(attachment.rot)),
    width,
    height,
    flipX: override?.flipX === true,
    overridden: !!(override?.assetId)
  };
}

/**
 * 导出骨骼资产为 Spine JSON（3.8 格式）。
 *
 * @param {Object} doc - 骨骼资产文档（本引擎 schema v1）
 * @param {Object} [options]
 * @param {string} [options.spineVersion] - 写入的 Spine 版本串（默认 3.8.99）
 * @param {string} [options.imagesPath] - skeleton.images 字段（图集目录）
 * @param {string} [options.atlasName] - 图集文件名（写进报告供脚本使用）
 * @returns {{ json: Object, regions: Array<Object>, report: Object }}
 */
export function exportSkeletonToSpine(doc, options = {}) {
  const warnings = [];
  const lossy = [];
  const bones = Array.isArray(doc?.bones) ? doc.bones : [];
  const slots = Array.isArray(doc?.slots) ? doc.slots : [];
  const clips = Array.isArray(doc?.clips) ? doc.clips : [];
  const meta = doc?.meta || {};

  // ---- 骨骼 ----
  const spineBones = bones.map(bone => {
    const inherit = str(bone?.inherit) || 'normal';
    const transform = TRANSFORM_MAP[inherit];
    if (inherit === 'noRotation') {
      lossy.push({
        feature: 'bone.inherit=noRotation',
        bone: bone.id,
        reason: 'Spine 无「继承父级位移与缩放但不继承旋转」的 transform 模式，已退化为 normal'
      });
    }
    const entry = {
      name: str(bone.id),
      x: num(bone.x),
      y: num(bone.y),
      rotation: num(bone.rot),
      scaleX: num(bone.scaleX, 1) || 1,
      scaleY: num(bone.scaleY, 1) || 1,
      length: num(bone.length)
    };
    if (bone.parent) entry.parent = str(bone.parent);
    entry.transform = transform || 'normal';
    return entry;
  });
  const boneById = new Map(bones.map(bone => [str(bone.id), bone]));

  // ---- 槽位 ----
  const spineSlots = slots.map(slot => {
    const entry = { name: str(slot.id), bone: str(slot.bone) };
    const attachment = slot?.attachment || {};
    if (attachment.type && attachment.type !== 'empty') entry.attachment = str(slot.id);
    return entry;
  });

  // ---- 皮肤：每个方向形态一个 skin ----
  const skins = {};
  const regions = new Map();
  for (const slot of slots) {
    const attachment = slot?.attachment || {};
    if (!attachment.type || attachment.type === 'empty') continue;
    // 有损检查按槽位记一次（不随形态重复）
    if (attachment.type === 'sequence') {
      lossy.push({
        feature: 'attachment.type=sequence',
        slot: slot.id,
        reason: 'Spine 无序列帧附件等价物，已按首帧静态图导出'
      });
    }
    if ((slot.follow ?? 'noScale') === 'noScale') {
      lossy.push({
        feature: 'slot.follow=noScale',
        slot: slot.id,
        reason: 'Spine 附件天然跟随骨骼缩放，本引擎「挂图不随骨骼缩放变形」语义在 Spine 侧无法表达'
      });
    }
  }
  for (const formKey of SKELETON_DIRECTION_KEYS) {
    const skin = {};
    for (const slot of slots) {
      const attachment = slot?.attachment || {};
      if (!attachment.type || attachment.type === 'empty') continue;
      const form = resolveFormAttachment(slot, formKey);
      if (!form.assetId) continue;
      const entry = { x: form.x, y: form.y, rotation: form.rotation, region: form.assetId };
      if (form.width > 0) entry.width = form.width;
      if (form.height > 0) entry.height = form.height;
      if (form.flipX) entry.flipX = true;
      skin[str(slot.id)] = { [str(slot.id)]: entry };
      const source = attachment.type === 'slice'
        ? { sx: num(attachment.sx), sy: num(attachment.sy), sw: num(attachment.sw), sh: num(attachment.sh) }
        : null;
      if (!regions.has(form.assetId)) {
        regions.set(form.assetId, { name: form.assetId, assetId: form.assetId, sx: source?.sx || 0, sy: source?.sy || 0, sw: source?.sw || 0, sh: source?.sh || 0 });
      }
    }
    skins[formKey] = skin;
  }
  if (skins.down && Object.keys(skins.down).length > 0) {
    // Spine 约定：default skin 必须存在（运行时默认皮肤）
    skins.default = skins.down;
  }

  // ---- 动画 ----
  const animations = {};
  for (const clip of clips) {
    const name = str(clip?.name);
    if (!name) continue;
    const animation = { bones: {} };
    for (const track of (Array.isArray(clip.tracks) ? clip.tracks : [])) {
      const boneId = str(track?.bone);
      const bone = boneById.get(boneId);
      if (!bone) continue;
      const keys = Array.isArray(track.keys) ? track.keys : [];
      if (!keys.length) continue;
      const setup = {
        x: num(bone.x), y: num(bone.y), rot: num(bone.rot),
        scaleX: num(bone.scaleX, 1) || 1, scaleY: num(bone.scaleY, 1) || 1
      };
      const boneTimeline = {};
      const curveOf = makeCurveResolver(keys);
      const translate = buildTranslateTimeline(keys, setup, curveOf);
      const rotate = buildSpineTimeline(keys, 'rot', value => value - setup.rot, curveOf);
      const scale = buildScaleTimeline(keys, setup, curveOf);
      if (translate.length) boneTimeline.translate = translate;
      if (rotate.length) boneTimeline.rotate = rotate;
      if (scale.length) boneTimeline.scale = scale;
      if (Object.keys(boneTimeline).length === 0) continue;
      animation.bones[boneId] = boneTimeline;
    }
    animations[name] = animation;
  }

  // 循环剪辑：回绕插值差异（汇总一条，避免逐剪辑刷屏）
  const loopClips = clips.filter(clip => clip?.loop !== false).map(clip => str(clip?.name)).filter(Boolean);
  if (loopClips.length) {
    lossy.push({
      feature: 'clip.loop 回绕插值',
      clips: loopClips,
      reason: '本引擎循环剪辑尾段会向首帧插值回绕，Spine 循环播放直接跳回首帧，尾段表现略有差异'
    });
  }

  // transform 约束（挂件跟随挂件）：Spine 的 transform constraint 作用在骨骼上，
  // 没有「附件跟随附件」等价物 → 只能靠骨骼 transform constraint 或预烘焙近似
  const transformConstraints = (Array.isArray(doc.constraints) ? doc.constraints : [])
    .filter(constraint => constraint && constraint.type === 'transform');
  if (transformConstraints.length) {
    lossy.push({
      feature: 'transform 约束（挂件跟随挂件）',
      constraints: transformConstraints.map(constraint => `${str(constraint.slot)}->${str(constraint.target)}`),
      reason: 'Spine 的 transform constraint 作用在骨骼上，无「附件跟随附件」等价物；需改用骨骼 transform constraint 或逐帧预烘焙'
    });
  }

  const json = {
    skeleton: {
      hash: '',
      spine: options.spineVersion || '3.8.99',
      x: 0,
      y: 0,
      width: num(meta.width),
      height: num(meta.height),
      images: options.imagesPath || './images/',
      audio: ''
    },
    bones: spineBones,
    slots: spineSlots,
    skins,
    animations
  };

  return {
    json,
    regions: [...regions.values()],
    report: {
      warnings,
      lossy,
      atlasName: options.atlasName || 'atlas.png',
      boneCount: spineBones.length,
      slotCount: spineSlots.length,
      animationCount: Object.keys(animations).length,
      skinCount: Object.keys(skins).length
    }
  };
}

/**
 * 生成 Spine atlas 文本（描述符部分；像素由离线脚本用 sharp 合成）。
 *
 * @param {Array<Object>} regions - 导出器给出的 region 列表（含排布后的 xy/size）
 * @param {Object} [options]
 * @param {string} [options.pageName] - 图集页文件名
 * @param {number} [options.width] - 图集宽
 * @param {number} [options.height] - 图集高
 * @returns {string} atlas 文本
 */
export function buildSpineAtlasText(regions, options = {}) {
  const pageName = options.pageName || 'atlas.png';
  const lines = [
    pageName,
    `size: ${Math.max(1, num(options.width, 1))}, ${Math.max(1, num(options.height, 1))}`,
    'format: RGBA8888',
    'filter: Linear,Linear',
    'repeat: none'
  ];
  for (const region of regions || []) {
    lines.push(
      region.name,
      '  rotate: false',
      `  xy: ${num(region.xyX)}, ${num(region.xyY)}`,
      `  size: ${num(region.width)}, ${num(region.height)}`,
      `  orig: ${num(region.origWidth, region.width)}, ${num(region.origHeight, region.height)}`,
      '  offset: 0, 0',
      '  index: -1'
    );
  }
  return `${lines.join('\n')}\n`;
}
