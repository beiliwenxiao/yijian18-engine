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
import { evaluateSkeletonPose } from '../../animation/SkeletonPose.js';

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
    this.currentClip = null;            // 当前剪辑名
    this.clipTime = 0;                  // 剪辑内时间（毫秒）
    this.playing = true;
    this.speed = 1;                     // 播放速率倍数
    // 槽位序列帧独立推进状态：Map(slotId -> { frame, frameTime })
    this.slotFrameState = new Map();
    this._worldPose = null;
    this._poseDirty = true;
  }

  /** 注入解析后的骨骼资产（AssetManager 懒加载完成后调用）。 */
  setSkeletonAsset(asset) {
    if (!asset || asset === this.skeletonAsset) return;
    this.skeletonAsset = asset;
    this.slotFrameState.clear();
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
    if (!asset || !this.playing) return;
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
      const attachment = slot.attachment;
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
        state.frame += 1;
        if (state.frame >= attachment.frames.length) state.frame = 0; // 附件序列恒循环
      }
    }
  }

  /**
   * 取当前世界姿态（缓存：仅脏时重算）。
   * @returns {Map(boneId -> {x,y,rot,sx,sy,rad})|null}
   */
  getWorldPose() {
    const asset = this.skeletonAsset;
    if (!asset) return null;
    if (!this._worldPose || this._poseDirty) {
      const clip = asset.clips.get(this.currentClip) || null;
      this._worldPose = evaluateSkeletonPose(asset, clip, this.clipTime).world;
      this._poseDirty = false;
    }
    return this._worldPose;
  }

  /** 取槽位序列帧游标（渲染用）。 */
  getSlotFrame(slotId) {
    return this.slotFrameState.get(slotId)?.frame || 0;
  }
}

export default SkeletonComponent;
