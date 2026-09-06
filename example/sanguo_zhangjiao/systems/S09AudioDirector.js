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

const DEFAULT_CUES = Object.freeze({
  music: 's09.music.low',
  ambience: Object.freeze([
    Object.freeze({ id: 's09.ambient.camp', volume: 0.28 }),
    Object.freeze({ id: 's09.ambient.crowd', volume: 0.2 })
  ]),
  feedback: Object.freeze({
    conflict: 's09.sfx.refugeeConflict',
    donation: 's09.sfx.donationCommitted',
    classSelected: 's09.sfx.classSelected',
    hardline: 's09.sfx.branchHardline',
    appease: 's09.sfx.branchAppease',
    silence: 's09.sfx.branchSilence'
  })
});

/**
 * S09 音频编排器。
 *
 * 不注册、加载或拥有音频资源，只消费场景唯一 AudioManager 中已经存在的 cue。
 * 因此真实文件尚未接入时全部操作安全降级为 no-op。
 */
export class S09AudioDirector {
  constructor({ audioManager = null, cues = DEFAULT_CUES } = {}) {
    this.audioManager = audioManager;
    this.cues = cues;
    this.active = false;
    this._activeLoops = new Set();
  }

  syncScene(sceneId) {
    if (sceneId === 'S09') return this.enter();
    this.leave();
    return false;
  }

  enter() {
    this.active = true;
    const audio = this.audioManager;
    if (!audio) return false;

    let started = false;
    if (audio.hasMusic?.(this.cues.music) && audio.getCurrentMusic?.() !== this.cues.music) {
      audio.playMusic?.(this.cues.music, true);
      started = true;
    }
    for (const cue of this.cues.ambience || []) {
      if (this._activeLoops.has(cue.id) || !audio.hasSound?.(cue.id)) continue;
      audio.playSound?.(cue.id, { loop: true, volume: cue.volume });
      this._activeLoops.add(cue.id);
      started = true;
    }
    return started;
  }

  playFeedback(event) {
    if (!this.active) return false;
    const cueId = this.cues.feedback?.[event];
    if (!cueId || !this.audioManager?.hasSound?.(cueId)) return false;
    this.audioManager.playSound(cueId);
    return true;
  }

  leave() {
    const audio = this.audioManager;
    for (const cueId of this._activeLoops) audio?.stopSound?.(cueId);
    this._activeLoops.clear();
    if (audio?.getCurrentMusic?.() === this.cues.music) audio.stopMusic?.(false);
    this.active = false;
  }

  dispose() {
    this.leave();
    this.audioManager = null;
  }
}

export { DEFAULT_CUES as S09_AUDIO_CUES };
export default S09AudioDirector;