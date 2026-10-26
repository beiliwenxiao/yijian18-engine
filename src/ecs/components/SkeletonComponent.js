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
 * SkeletonComponent.js - 骨骼动画组件
 *
 * 与 SpriteComponent(isSkeleton=true) 共存：Sprite 保留外观语义
 * （width/height/alpha/flip/visible），骨骼姿态与槽位序列帧由本组件驱动。
 * update 挂 Entity.update 链（毫秒推进剪辑时间与槽位帧，算法对齐
 * SpriteComponent.update 的 1000/fps + loop wrap，但状态按槽位独立）。
 */

import { Component } from '../Component.js';
import { evaluateSkeletonPose, createRestLocalPose, composeWorldTransforms } from '../../animation/SkeletonPose.js';
import { evaluatePoseWithIk } from '../../animation/SkeletonIk.js';
import { bakeClip, sampleBakedClip } from '../../animation/SkeletonBake.js';

export class SkeletonComponent extends Component {
  /**
   * @param {Object} options
   * @param {string} options.skeletonId - 骨骼资产稳定 ID（manifest mode:'skeleton'）
   * @param {string} [options.defaultClip] - 默认剪辑名（缺省用资产 defaultClip）
   */
  constructor(options = {}) {
    super('skeleton');
    this.skeletonId = options.skeletonId || '';
    this.skeletonAsset = null;          // parseSkeletonAsset 产物（由 AssetManager 懒加载后注入）
    this.deps = options.deps || null;   // { getAssetManager } 状态映射器等依赖
    this.stateHook = null;              // 可选：每帧状态→剪辑映射（PlayerSkeletonStateMapper）
    this.currentClip = null;            // 当前剪辑名
    this.clipTime = 0;                  // 剪辑内时间（毫秒）
    this.playing = true;
    this.speed = 1;                     // 播放速率倍数
    // 槽位序列帧独立推进状态：Map(slotId -> { frame, frameTime })
    this.slotFrameState = new Map();
    // 每实体槽位覆盖层：Map(slotId -> { visible?, flipX?, frames?, fps? })
    // 共享资产（AssetManager 缓存的 parseSkeletonAsset 产物）全局唯一，
    // 运行时状态（头部三态可见性、武器上手/背挂、背挂换边、序列帧表）
    // 必须落在实体本地覆盖层——直接改写共享 attachment 会让同骨架的多个
    // 实体互相覆盖（甲朝下写的 headFront.visible 被乙朝上写回覆盖）。
    this.slotOverrides = new Map();
    // IK 约束（实体本地）：运行时 IK 修正（脚部贴地/瞄准/骑乘）。
    // 结构 { id, type:'aim'|'twoBone', bones:[...], target:{x,y}, mix, offsetAngle, iterations }，
    // target 为骨骼资产坐标系（design space）的世界坐标。
    this.ikConstraints = [];
    // 曲线预烘焙：按固定步长预采样，运行时查表（贝塞尔曲线落地后省掉每段二分求解）。
    // 烘焙表懒构建（首次播放该剪辑时建一次），换资产时清空。
    this.useBakedClips = true;
    this.bakeStepMs = 20;
    this._bakedClips = new Map();
    this._bakedRestPose = null;
    this._localPoseOut = new Map();
    this._worldPose = null;
    this._poseDirty = true;
  }

  /** 注入解析后的骨骼资产（AssetManager 懒加载完成后调用）。 */
  setSkeletonAsset(asset) {
    if (!asset || asset === this.skeletonAsset) return;
    this.skeletonAsset = asset;
    this.slotFrameState.clear();
    // 换资产 = 槽位 id 集合可能变化，旧覆盖层的 slotId 不再对应 → 清空
    this.slotOverrides.clear();
    // 换资产 = 骨骼/剪辑全变 → 烘焙表与静止姿态缓存失效
    this._bakedClips.clear();
    this._bakedRestPose = null;
    // 当前剪辑名失效时回退默认剪辑
    if (!this.currentClip || !asset.clips.has(this.currentClip)) {
      this.currentClip = (this.defaultClipOverride && asset.clips.has(this.defaultClipOverride))
        ? this.defaultClipOverride
        : asset.defaultClip;
      this.clipTime = 0;
    }
    this._poseDirty = true;
  }

  /**
   * 播放剪辑（SpriteComponent.playAnimation 的兼容转发目标）。
   * @param {string} name - 剪辑名；资产中不存在时回退默认剪辑
   * @param {boolean} [force] - 强制从头播放
   * @returns {boolean} 是否成功切到某个剪辑
   */
  playClip(name, force = false) {
    const asset = this.skeletonAsset;
    if (asset) {
      const target = asset.clips.has(name) ? name
        : (this.defaultClipOverride && asset.clips.has(this.defaultClipOverride))
          ? this.defaultClipOverride
          : asset.defaultClip;
      if (!target) return false;
      if (this.currentClip !== target || force) {
        this.currentClip = target;
        this.clipTime = 0;
        this._poseDirty = true;
      }
      this.playing = true;
      return true;
    }
    // 资产未加载：先记名字，setSkeletonAsset 时回填
    this.currentClip = name || this.currentClip;
    this.defaultClipOverride = name || this.defaultClipOverride || null;
    this.playing = true;
    return true;
  }

  pause() { this.playing = false; }
  resume() { this.playing = true; }

  /** 剪辑时间推进 + 槽位序列帧推进。deltaTime 为秒（Entity.update 约定）。 */
  update(deltaTime) {
    const asset = this.skeletonAsset;
    if (!asset) return;
    this.stateHook?.(this, deltaTime);
    if (!this.playing) return;
    const deltaMs = Math.max(0, Number(deltaTime) || 0) * 1000 * this.speed;
    if (deltaMs === 0 && !this._poseDirty) return;

    const clip = asset.clips.get(this.currentClip) || null;
    if (clip) {
      this.clipTime += deltaMs;
      if (clip.loop) {
        if (this.clipTime >= clip.durationMs) {
          this.clipTime %= clip.durationMs;
        }
      } else if (this.clipTime > clip.durationMs) {
        this.clipTime = clip.durationMs;
      }
      this._poseDirty = true;
    }

    // 槽位序列帧：每槽独立 fps 与帧游标（非循环序列停在最后一帧）
    for (const slot of asset.slots) {
      // 帧表可能来自实体本地覆盖层（方向行切换），必须读合并后的附件
      const attachment = this.resolveSlotAttachment(slot);
      if (attachment?.type !== 'sequence' || !Array.isArray(attachment.frames) || attachment.frames.length === 0) {
        continue;
      }
      let state = this.slotFrameState.get(slot.id);
      if (!state) {
        state = { frame: 0, frameTime: 0 };
        this.slotFrameState.set(slot.id, state);
      }
      const frameDuration = 1000 / (attachment.fps > 0 ? attachment.fps : 8);
      state.frameTime += deltaMs;
      while (state.frameTime >= frameDuration) {
        state.frameTime -= frameDuration;
        if (state.frame >= attachment.frames.length - 1) {
          // 末帧：默认恒循环；loop=false（如跳跃序列）停在末帧
          state.frame = attachment.loop === false
            ? attachment.frames.length - 1
            : 0;
          if (attachment.loop === false) state.frameTime = 0;
        } else {
          state.frame += 1;
        }
      }
    }
  }

  /**
   * 取当前世界姿态（缓存：仅脏时重算）。
   * 存在 IK 约束时：FK 采样 → IK 求解 → 最终世界变换。
   * @returns {Map(boneId -> {x,y,rot,sx,sy,rad})|null}
   */
  getWorldPose() {
    const asset = this.skeletonAsset;
    if (!asset) return null;
    if (!this._worldPose || this._poseDirty) {
      const clip = asset.clips.get(this.currentClip) || null;
      const local = this._sampleLocalPose(clip);
      let world = composeWorldTransforms(asset, local);
      if (this.ikConstraints.length > 0) {
        world = evaluatePoseWithIk(asset, local, world, this.ikConstraints).world;
      }
      this._worldPose = world;
      this._poseDirty = false;
    }
    return this._worldPose;
  }

  /**
   * 采样局部姿势：优先用烘焙表（查表），无烘焙表时走原始关键帧采样。
   * @param {Object|null} clip - 当前剪辑
   * @returns {Map} 局部姿势（boneId -> {x,y,rot,sx,sy}）
   */
  _sampleLocalPose(clip) {
    if (!clip) return createRestLocalPose(this.skeletonAsset);
    const baked = this.useBakedClips === false ? null : this._bakedClip(clip);
    if (!baked) {
      return evaluateSkeletonPose(this.skeletonAsset, clip, this.clipTime).local;
    }
    this._localPoseOut.clear();
    const sampled = sampleBakedClip(baked, this.clipTime, this._localPoseOut);
    // 烘焙表只含有轨道的骨骼 → 补齐无轨道骨骼的静止姿态（IK 求解与世界组合都要完整局部姿势）
    if (this._bakedRestPose) {
      for (const [boneId, value] of this._bakedRestPose) {
        if (!sampled.has(boneId)) sampled.set(boneId, { ...value });
      }
    }
    return sampled;
  }

  /**
   * 取（并懒构建）剪辑的烘焙表。
   * @param {Object} clip - 剪辑
   * @returns {Object|null} 烘焙产物
   */
  _bakedClip(clip) {
    if (!clip) return null;
    const name = clip.name;
    if (this._bakedClips.has(name)) return this._bakedClips.get(name);
    if (!this._bakedRestPose) this._bakedRestPose = createRestLocalPose(this.skeletonAsset);
    const baked = bakeClip(clip, this._bakedRestPose, { stepMs: this.bakeStepMs });
    this._bakedClips.set(name, baked);
    return baked;
  }

  /**
   * 写入 IK 约束（实体本地；不进共享资产）。
   * @param {Array<Object>} constraints - [{ id, type, bones, target, mix, offsetAngle, iterations }]
   */
  setIkConstraints(constraints) {
    this.ikConstraints = Array.isArray(constraints) ? constraints.filter(Boolean) : [];
    this._poseDirty = true;
  }

  /** 取当前 IK 约束（只读引用）。 */
  getIkConstraints() {
    return this.ikConstraints;
  }

  /**
   * 更新某条 IK 约束的目标点（骨骼资产坐标系）。
   * 目标每帧变化时必须调用，否则世界姿态缓存不会刷新。
   * @param {string} id - 约束 id
   * @param {number} x - 目标 x
   * @param {number} y - 目标 y
   * @returns {boolean} 是否命中该约束
   */
  setIkTarget(id, x, y) {
    const constraint = this.ikConstraints.find(candidate => candidate.id === id);
    if (!constraint || !constraint.target) return false;
    constraint.target.x = x;
    constraint.target.y = y;
    this._poseDirty = true;
    return true;
  }

  /** 标记姿态缓存失效（IK 目标或外部状态变化后调用）。 */
  markPoseDirty() {
    this._poseDirty = true;
  }

  /** 取槽位序列帧游标（渲染用）。 */
  getSlotFrame(slotId) {
    return this.slotFrameState.get(slotId)?.frame || 0;
  }

  /**
   * 写实体本地槽位覆盖（不触碰共享资产）。
   * @param {string} slotId
   * @param {Object} patch - { visible?, flipX?, frames?, fps?, loop?, keepFrameRatio? }；字段为 undefined 表示不改
   *   loop=false：序列播完停在末帧（默认恒循环）；keepFrameRatio=true：帧表变化时按新旧表
   *   长度比例保留帧游标（跳跃空中换向不重播起跳动作）
   */
  setSlotOverride(slotId, patch) {
    if (!slotId || !patch) return;
    const current = this.slotOverrides.get(slotId) || {};
    const prevFrames = current.frames;                       // 旧帧表（合并前引用）
    const prevState = this.slotFrameState.get(slotId);
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (current[key] === value) continue;
      current[key] = value;
      changed = true;
    }
    if (!changed) return;
    this.slotOverrides.set(slotId, current);
    // 帧表变了 → 帧游标重置（否则按旧表长度取模会越界）；
    // keepFrameRatio 时按新旧表长度比例换算游标（跳跃空中换向保持播放进度，不重播起跳）
    if (patch.frames !== undefined && prevFrames !== patch.frames) {
      if (patch.keepFrameRatio === true && prevState
        && Array.isArray(prevFrames) && Array.isArray(patch.frames)) {
        const ratio = Math.min(1, prevState.frame / Math.max(1, prevFrames.length));
        this.slotFrameState.set(slotId, {
          frame: Math.min(patch.frames.length - 1, Math.round(ratio * (patch.frames.length - 1))),
          frameTime: prevState.frameTime
        });
        return;
      }
      this.slotFrameState.delete(slotId);
    }
  }

  /**
   * 取实体本地槽位覆盖（渲染用；无覆盖返回 null）。
   * @param {string} slotId
   * @returns {Object|null}
   */
  getSlotOverride(slotId) {
    return this.slotOverrides.get(slotId) || null;
  }

  /**
   * 取槽位的最终附件（共享 attachment + 实体本地覆盖合并）。
   * 渲染与状态映射统一走这里，保证「共享资产只读 + 实体态叠加」单一口径。
   * @param {Object} slot - parseSkeletonAsset 产物的 slot
   * @returns {Object|null}
   */
  resolveSlotAttachment(slot) {
    if (!slot?.attachment) return null;
    const override = this.slotOverrides.get(slot.id);
    if (!override) return slot.attachment;
    return { ...slot.attachment, ...override };
  }

  /**
   * 动态改写槽位序列帧表（状态映射器按方向行/贴图布局更新 body 槽位用）。
   * 写入实体本地覆盖层——共享资产的 frames 表全局唯一，直接改写会让
   * 同骨架实体的方向帧表互相覆盖。
   * @param {string} slotId
   * @param {Array<{sx:number,sy:number,sw:number,sh:number}>} frames
   * @param {number} [fps]
   */
  setSlotFrames(slotId, frames, fps = null) {
    const slot = this.skeletonAsset?.slots?.find(candidate => candidate.id === slotId);
    if (!slot?.attachment || slot.attachment.type !== 'sequence') return;
    const patch = { frames };
    if (fps > 0) patch.fps = fps;
    this.setSlotOverride(slotId, patch);
    this.slotFrameState.delete(slotId);
    this._poseDirty = true;
  }
}

export default SkeletonComponent;
