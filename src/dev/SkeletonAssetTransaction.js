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

import fs from 'fs';
import path from 'path';
import { createContentValidator } from '../core/validation/ContentSchemas.js';
import { validateSkeletonAsset } from '../core/validation/SkeletonAssetValidator.js';

const STABLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;

function failure(message, errors = []) {
  return Object.assign(new Error(message), { statusCode: 422, errors });
}

function validationError(pathValue, reason) {
  return { path: pathValue, category: 'invalidReference', reason };
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson(absolutePath, source) {
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw failure(`${source} 无法解析: ${error.message}`, [validationError(source, error.message)]);
  }
}

/**
 * 骨骼资产「保存即登记」事务：骨骼 JSON 落盘 + Asset Manifest 原子同步。
 *
 * 约定：
 * - 骨骼文档先过 SkeletonAssetValidator（结构/引用/关键帧合法性）；
 * - 附件 assetId 必须已在 Manifest 登记为 image 模式（骨骼引用的素材图片
 *   由场景图片事务/内容库先行登记，本事务不代写图片文件）；
 * - Manifest upsert：mode:'skeleton'，bounds=骨骼设计尺寸，pivot=脚底中心；
 *   已有条目只更新路径/尺寸（revision+1），usage/status 保留；
 *   atlas 模式条目不允许通过本事务改写（归共享图集事务管辖）；
 *   image 模式 → skeleton 模式即「资产级替换」，允许且保留原 usage。
 *
 * @param {Object} params
 * @param {string} params.repoRoot - dev server 工作根
 * @param {string} params.projectPath - 项目路径（game.project.json）
 * @param {string} params.projectRoot - 项目根（不含 game.project.json）
 * @param {Array<{document: Object, template?: boolean}>} params.skeletons - 骨骼文档列表；
 *   template=true 表示骨架模板（tpl.*）：写回 assets/skeletons/templates/、跳过附件 Manifest
 *   引用检查、不做 Manifest upsert（模板是纯便利起点，非运行时资产——模板独立性原则）
 * @returns {{ manifest: Object, skeletons: Array<Object>, changes: Array<{operation:string, path:string, content:string}> }}
 */
export function prepareSkeletonAssetTransaction({
  repoRoot,
  projectPath,
  projectRoot,
  skeletons
} = {}) {
  if (!Array.isArray(skeletons) || skeletons.length === 0) {
    throw failure('skeletons 不能为空', [validationError('skeletons', '至少需要一项骨骼资产')]);
  }
  const manifestPath = `${projectRoot}/assets/manifests/assets.json`;
  const manifest = readJson(path.resolve(repoRoot, manifestPath), manifestPath);
  const manifestEntries = manifest.assets || [];
  const skeletonRoot = `${projectRoot}/assets/skeletons`;
  const changes = [];
  const committed = [];
  let manifestDirty = false;

  for (const [index, update] of skeletons.entries()) {
    const source = `skeletons[${index}]`;
    const isTemplate = update?.template === true;
    const validation = validateSkeletonAsset(update?.document);
    if (!validation.ok) {
      throw failure(`骨骼资产校验失败: ${update?.document?.skeletonId || '(匿名)'}`, validation.errors);
    }
    const doc = validation.value;
    const skeletonId = String(doc.skeletonId || '').trim();
    if (!STABLE_ID_PATTERN.test(skeletonId)) {
      throw failure(`骨骼资产稳定 ID 无效: ${skeletonId}`, [
        validationError(`${source}.skeletonId`, 'skeletonId 只能包含字母、数字、点、下划线和短横线，且必须以字母开头')
      ]);
    }

    // 附件引用必须已在 Manifest 登记为 image 模式（模板跳过：槽位为 empty 占位，
    // 自定义模板的示例附件不强制先登记）
    if (!isTemplate) {
      for (const [slotIndex, slot] of (doc.slots || []).entries()) {
        const attachment = slot?.attachment;
        if (!attachment || attachment.type === 'empty') continue;
        const ref = String(attachment.assetId || '').trim();
        const refEntry = manifestEntries.find(entry => entry?.assetId === ref || entry?.imageId === ref);
        if (!refEntry || refEntry.runtime2D?.mode !== 'image') {
          throw failure(`槽位 ${slotIndex} 附件引用的图片未登记或不是 image 模式: ${ref}`, [
            validationError(`${source}.slots[${slotIndex}].attachment.assetId`,
              '请先通过场景图片导入登记素材图片，再保存骨骼资产')
          ]);
        }
      }
    }

    // 骨骼 JSON 落盘路径：优先沿用 Manifest 已有条目的路径（容忍历史文件名与 ID 不一致），
    // 新资产按 ID 派生；磁盘已有文件用 replace，新文件用 create（AtomicDiskAdapter 约束）
    const existingEntry = manifestEntries.find(entry => (
      entry?.assetId === skeletonId || entry?.imageId === skeletonId
    ));
    const existingPath = existingEntry?.runtime2D?.mode === 'skeleton'
      ? String(existingEntry.runtime2D.path || '').trim()
      : '';
    const skeletonRelPath = isTemplate
      ? `assets/skeletons/templates/${skeletonId}.json`
      : (existingPath || `assets/skeletons/${skeletonId}.json`);
    if (!skeletonRelPath.startsWith('assets/skeletons/') || skeletonRelPath.includes('..')) {
      throw failure(`骨骼文件路径越出 assets/skeletons/：${skeletonRelPath}`, [
        validationError(`${source}.skeletonId`, '路径越权')
      ]);
    }
    const skeletonAbsolute = path.resolve(repoRoot, projectRoot, skeletonRelPath);
    const relative = path.relative(path.resolve(repoRoot, projectRoot), skeletonAbsolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw failure('骨骼文件路径越出当前游戏目录', [validationError(`${source}.skeletonId`, '路径越权')]);
    }
    changes.push({
      operation: fs.existsSync(skeletonAbsolute) ? 'replace' : 'create',
      path: `${projectRoot}/${skeletonRelPath}`,
      content: json(doc)
    });

    // Manifest upsert（模板不做：模板非运行时资产，不出现在 Manifest / 游戏资产表）
    if (!isTemplate) {
      manifestDirty = true;
      const metaWidth = Number(doc.meta?.width) > 0 ? Number(doc.meta.width) : 64;
      const metaHeight = Number(doc.meta?.height) > 0 ? Number(doc.meta.height) : 128;
      const existingIndex = manifestEntries.findIndex(entry => entry?.assetId === skeletonId || entry?.imageId === skeletonId);
      if (existingIndex >= 0) {
        const entry = manifestEntries[existingIndex];
        if (entry.runtime2D?.mode === 'atlas') {
          throw failure(`目标条目是共享图集资源，不允许通过骨骼资产事务改写: ${skeletonId}`, [
            validationError(`${source}.skeletonId`, 'atlas 资源请通过共享图集事务维护')
          ]);
        }
        manifestEntries[existingIndex] = {
          ...entry,
          sourceFile: skeletonRelPath,
          runtime2D: { path: skeletonRelPath, mode: 'skeleton' },
          bounds: { ...entry.bounds, width: metaWidth, height: metaHeight },
          pivot: { ...entry.pivot, x: 0.5, y: 1 },
          revision: Math.max(1, Number(entry.revision) || 1) + 1
        };
      } else {
        manifestEntries.push({
          assetId: skeletonId,
          imageId: skeletonId,
          category: 'character-skeleton',
          usage: ['editor-skeleton'],
          sourceFile: skeletonRelPath,
          runtime2D: { path: skeletonRelPath, mode: 'skeleton' },
          runtime3D: { mode: 'billboard', sourceAssetId: skeletonId },
          pivot: { x: 0.5, y: 1 },
          bounds: { width: metaWidth, height: metaHeight },
          animations: [],
          targetPhase: 'P1',
          status: 'placeholder',
          revision: 1
        });
      }
    }
    committed.push(doc);
  }

  // 仅在发生运行时资产 upsert 时校验并写回 Manifest（纯模板保存不动 Manifest）
  if (manifestDirty) {
    const manifestValidation = createContentValidator().validate(manifest, 'assetManifest');
    if (!manifestValidation.ok) {
      throw failure('同步后的 Asset Manifest 校验失败', manifestValidation.errors);
    }
    changes.push({ operation: 'replace', path: manifestPath, content: json(manifest) });
  }
  return { manifest, skeletons: committed, changes };
}

export default prepareSkeletonAssetTransaction;

/**
 * 动作预设「保存即落盘」事务：preset JSON 写 assets/skeletons/anim-presets/（不动 Manifest）。
 * 轻校验：presetId 稳定 ID + clipName/durationMs/tracks 结构 + 键时间单调非负。
 * 预设是纯便利起点（套用即深拷贝），与目标骨架无数据关联——模板独立性原则。
 */
export function prepareAnimPresetTransaction({
  repoRoot,
  projectPath,
  projectRoot,
  presets
} = {}) {
  if (!Array.isArray(presets) || presets.length === 0) {
    throw failure('presets 不能为空', [validationError('presets', '至少需要一项动作预设')]);
  }
  const changes = [];
  const committed = [];
  for (const [index, update] of presets.entries()) {
    const source = `presets[${index}]`;
    const preset = update?.preset;
    if (!preset || typeof preset !== 'object') {
      throw failure(`${source} 必须是对象`);
    }
    const presetId = String(preset.presetId || '').trim();
    if (!STABLE_ID_PATTERN.test(presetId)) {
      throw failure(`动作预设 ID 无效: ${presetId}`, [validationError(`${source}.presetId`, 'presetId 必须是稳定标识符')]);
    }
    if (!String(preset.clipName || '').trim()) {
      throw failure(`${source}.clipName 不能为空`);
    }
    const durationMs = Number(preset.durationMs);
    if (!(durationMs > 0)) {
      throw failure(`${source}.durationMs 必须大于 0`);
    }
    if (!Array.isArray(preset.tracks)) {
      throw failure(`${source}.tracks 必须是数组`);
    }
    for (const [trackIndex, track] of preset.tracks.entries()) {
      if (!track?.bone || !Array.isArray(track.keys) || track.keys.length === 0) {
        throw failure(`${source}.tracks[${trackIndex}] 必须含 bone 与非空 keys`);
      }
      let previousT = -1;
      for (const key of track.keys) {
        const t = Number(key?.t);
        if (!Number.isFinite(t) || t < 0 || t > durationMs || t < previousT) {
          throw failure(`${source}.tracks[${trackIndex}].keys 存在非法/越界/非单调的 t`);
        }
        previousT = t;
      }
    }
    const target = path.resolve(repoRoot, projectRoot, `assets/skeletons/anim-presets/${presetId}.json`);
    const relative = path.relative(path.resolve(repoRoot, projectRoot), target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw failure('预设文件路径越出当前游戏目录', [validationError(`${source}.presetId`, '路径越权')]);
    }
    changes.push({
      operation: fs.existsSync(target) ? 'replace' : 'create',
      path: `${projectRoot}/assets/skeletons/anim-presets/${presetId}.json`,
      content: json(preset)
    });
    committed.push(preset);
  }
  return { presets: committed, changes };
}
