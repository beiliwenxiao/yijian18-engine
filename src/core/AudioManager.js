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

import { Logger } from './Logger.js';

/**
 * 音频管理器
 * 负责管理游戏音效和背景音乐
 */
export class AudioManager {
    constructor() {
        // 音频缓存
        this.sounds = new Map();
        this.music = new Map();
        
        // 当前播放的背景音乐
        this.currentMusic = null;
        this.currentMusicKey = null;
        
        // 音量设置
        this.masterVolume = 1.0;
        this.soundVolume = 0.7;
        this.musicVolume = 0.5;
        
        // 静音状态
        this.muted = false;
        
        // 音频上下文（用于Web Audio API）
        this.audioContext = null;
        
        Logger.log('AudioManager: Initialized');
    }

    /**
     * 初始化音频上下文
     */
    initAudioContext() {
        if (!this.audioContext) {
            try {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                this.audioContext = new AudioContext();
                Logger.log('AudioManager: Audio context initialized');
            } catch (error) {
                console.warn('AudioManager: Web Audio API not supported', error);
            }
        }
    }

    /**
     * 添加音效
     * @param {string} key - 音效键名
     * @param {string} url - 音效URL
     * @param {object} options - 选项 {volume, loop}
     */
    addSound(key, url, options = {}) {
        const audio = new Audio(url);
        audio.volume = (options.volume || this.soundVolume) * this.masterVolume;
        audio.loop = options.loop || false;
        audio.preload = 'auto';
        
        this.sounds.set(key, {
            audio,
            baseVolume: options.volume || this.soundVolume,
            instances: [] // 用于支持同时播放多个实例
        });
        
        Logger.log(`AudioManager: Sound '${key}' added`);
    }

    /**
     * 添加背景音乐
     * @param {string} key - 音乐键名
     * @param {string} url - 音乐URL
     * @param {object} options - 选项 {volume}
     */
    addMusic(key, url, options = {}) {
        const audio = new Audio(url);
        audio.volume = (options.volume ?? this.musicVolume) * this.masterVolume;
        audio.loop = options.loop !== false;
        audio.preload = 'auto';
        
        this.music.set(key, {
            audio,
            baseVolume: options.volume ?? this.musicVolume
        });
        
        Logger.log(`AudioManager: Music '${key}' added`);
    }

    /**
     * 播放音效
     * @param {string} key - 音效键名
     * @param {object} options - 选项 {volume, loop}
     */
    playSound(key, options = {}) {
        if (this.muted) return;
        
        const soundData = this.sounds.get(key);
        if (!soundData) {
            console.warn(`AudioManager: Sound '${key}' not found`);
            return;
        }

        try {
            // 创建新的音频实例以支持重叠播放
            const audio = soundData.audio.cloneNode();
            const volume = options.volume !== undefined ? options.volume : soundData.baseVolume;
            audio.volume = volume * this.masterVolume;
            
            if (options.loop !== undefined) {
                audio.loop = options.loop;
            }
            
            // 播放音效
            const playPromise = audio.play();
            
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.warn(`AudioManager: Failed to play sound '${key}'`, error);
                });
            }
            
            // 清理已完成的实例
            audio.addEventListener('ended', () => {
                const index = soundData.instances.indexOf(audio);
                if (index > -1) {
                    soundData.instances.splice(index, 1);
                }
            });
            
            soundData.instances.push(audio);
            
        } catch (error) {
            console.warn(`AudioManager: Error playing sound '${key}'`, error);
        }
    }

    /**
     * 停止音效
     * @param {string} key - 音效键名
     */
    stopSound(key) {
        const soundData = this.sounds.get(key);
        if (!soundData) return;
        
        // 停止所有实例
        soundData.instances.forEach(audio => {
            audio.pause();
            audio.currentTime = 0;
        });
        soundData.instances = [];
    }

    /**
     * 播放背景音乐
     * @param {string} key - 音乐键名
     * @param {boolean} fadeIn - 是否淡入
     */
    playMusic(key, fadeIn = false) {
        if (this.muted) return;
        
        const musicData = this.music.get(key);
        if (!musicData) {
            console.warn(`AudioManager: Music '${key}' not found`);
            return;
        }

        // 如果已经在播放相同的音乐，不做任何操作
        if (this.currentMusicKey === key && this.currentMusic && !this.currentMusic.paused) {
            return;
        }

        // 停止当前音乐
        if (this.currentMusic) {
            this.stopMusic(true);
        }

        try {
            this.currentMusic = musicData.audio;
            this.currentMusicKey = key;
            
            if (fadeIn) {
                // 淡入效果
                this.currentMusic.volume = 0;
                this.currentMusic.play();
                this.fadeVolume(this.currentMusic, musicData.baseVolume * this.masterVolume, 1000);
            } else {
                this.currentMusic.volume = musicData.baseVolume * this.masterVolume;
                this.currentMusic.play();
            }
            
            Logger.log(`AudioManager: Playing music '${key}'`);
            
        } catch (error) {
            console.warn(`AudioManager: Error playing music '${key}'`, error);
        }
    }

    /**
     * 停止背景音乐
     * @param {boolean} fadeOut - 是否淡出
     */
    stopMusic(fadeOut = false) {
        if (!this.currentMusic) return;
        
        if (fadeOut) {
            this.fadeVolume(this.currentMusic, 0, 1000, () => {
                this.currentMusic.pause();
                this.currentMusic.currentTime = 0;
                this.currentMusic = null;
                this.currentMusicKey = null;
            });
        } else {
            this.currentMusic.pause();
            this.currentMusic.currentTime = 0;
            this.currentMusic = null;
            this.currentMusicKey = null;
        }
    }

    /**
     * 暂停背景音乐
     */
    pauseMusic() {
        if (this.currentMusic) {
            this.currentMusic.pause();
        }
    }

    /**
     * 恢复背景音乐
     */
    resumeMusic() {
        if (this.currentMusic && this.currentMusic.paused && !this.muted) {
            this.currentMusic.play();
        }
    }

    /**
     * 音量淡入淡出
     * @param {HTMLAudioElement} audio - 音频元素
     * @param {number} targetVolume - 目标音量
     * @param {number} duration - 持续时间（毫秒）
     * @param {function} callback - 完成回调
     */
    fadeVolume(audio, targetVolume, duration, callback) {
        const startVolume = audio.volume;
        const volumeChange = targetVolume - startVolume;
        const startTime = Date.now();
        
        const fade = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            audio.volume = startVolume + volumeChange * progress;
            
            if (progress < 1) {
                requestAnimationFrame(fade);
            } else if (callback) {
                callback();
            }
        };
        
        fade();
    }

    /**
     * 设置主音量
     * @param {number} volume - 音量 (0-1)
     */
    setMasterVolume(volume) {
        this.masterVolume = Math.max(0, Math.min(1, volume));
        this.updateAllVolumes();
        Logger.log(`AudioManager: Master volume set to ${this.masterVolume}`);
    }

    /**
     * 设置音效音量
     * @param {number} volume - 音量 (0-1)
     */
    setSoundVolume(volume) {
        this.soundVolume = Math.max(0, Math.min(1, volume));
        this.updateAllVolumes();
        Logger.log(`AudioManager: Sound volume set to ${this.soundVolume}`);
    }

    /**
     * 设置音乐音量
     * @param {number} volume - 音量 (0-1)
     */
    setMusicVolume(volume) {
        this.musicVolume = Math.max(0, Math.min(1, volume));
        this.updateAllVolumes();
        Logger.log(`AudioManager: Music volume set to ${this.musicVolume}`);
    }

    /**
     * 更新所有音频的音量
     */
    updateAllVolumes() {
        // 更新音效音量
        this.sounds.forEach((soundData, key) => {
            soundData.audio.volume = soundData.baseVolume * this.soundVolume * this.masterVolume;
            soundData.instances.forEach(audio => {
                audio.volume = soundData.baseVolume * this.soundVolume * this.masterVolume;
            });
        });
        
        // 更新音乐音量
        this.music.forEach((musicData, key) => {
            musicData.audio.volume = musicData.baseVolume * this.musicVolume * this.masterVolume;
        });
    }

    /**
     * 静音/取消静音
     * @param {boolean} muted - 是否静音
     */
    setMuted(muted) {
        this.muted = muted;
        
        if (muted) {
            // 暂停所有音频
            this.pauseMusic();
            this.sounds.forEach((soundData) => {
                soundData.instances.forEach(audio => audio.pause());
            });
        } else {
            // 恢复音乐
            this.resumeMusic();
        }
        
        Logger.log(`AudioManager: Muted = ${this.muted}`);
    }

    /**
     * 切换静音状态
     */
    toggleMute() {
        this.setMuted(!this.muted);
    }

    /**
     * 获取音效是否存在
     * @param {string} key - 音效键名
     * @returns {boolean}
     */
    hasSound(key) {
        return this.sounds.has(key);
    }

    /**
     * 获取音乐是否存在
     * @param {string} key - 音乐键名
     * @returns {boolean}
     */
    hasMusic(key) {
        return this.music.has(key);
    }

    /**
     * 清除所有音频
     */
    clear() {
        // 停止所有音效
        this.sounds.forEach((soundData, key) => {
            this.stopSound(key);
        });
        this.sounds.clear();
        
        // 停止音乐
        this.stopMusic();
        this.music.clear();
        
        Logger.log('AudioManager: All audio cleared');
    }

    /**
     * 获取当前播放的音乐键名
     * @returns {string|null}
     */
    getCurrentMusic() {
        return this.currentMusicKey;
    }

    /**
     * 获取音频统计信息
     * @returns {object}
     */
    getStats() {
        let activeSounds = 0;
        this.sounds.forEach(soundData => {
            activeSounds += soundData.instances.length;
        });
        
        return {
            totalSounds: this.sounds.size,
            totalMusic: this.music.size,
            activeSounds,
            currentMusic: this.currentMusicKey,
            masterVolume: this.masterVolume,
            soundVolume: this.soundVolume,
            musicVolume: this.musicVolume,
            muted: this.muted
        };
    }
}
