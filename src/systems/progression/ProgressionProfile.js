/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * ProgressionProfile.js
 * 成长系统的项目级配置：由 game.project.json 的 progression 字段驱动。
 *
 * 决定：
 *   - 启用哪些成长结构（技能树 / 职业天赋 / 兵种天赋 / 天赋盘）
 *   - 哪一个是主要成长（决定默认 UI 页签、升级提示、教程顺序）
 *   - 点数池是独立还是共享
 *   - 各结构的开放时机
 *
 * 禁用某结构只影响 UI 与分配入口，不删除其存档状态。
 */

import { GraphMode, PointPool } from './GraphDefinition.js';

/** 成长结构标识（对外配置用名） */
export const ProgressionKind = {
  SKILL_TREE: 'skillTree',
  TALENT_TREE: 'talentTree',
  UNIT_TALENT: 'unitTalent',
  PASSIVE_BOARD: 'passiveBoard'
};

/** 成长结构 → 图模式 */
export const KIND_TO_MODE = {
  [ProgressionKind.SKILL_TREE]: GraphMode.CLASS_SKILL,
  [ProgressionKind.TALENT_TREE]: GraphMode.CLASS_TALENT,
  [ProgressionKind.UNIT_TALENT]: GraphMode.UNIT_TALENT,
  [ProgressionKind.PASSIVE_BOARD]: GraphMode.PASSIVE_BOARD
};

/** 成长结构 → 默认点数池 */
export const KIND_TO_POOL = {
  [ProgressionKind.SKILL_TREE]: PointPool.SKILL,
  [ProgressionKind.TALENT_TREE]: PointPool.TALENT,
  [ProgressionKind.UNIT_TALENT]: PointPool.UNIT,
  [ProgressionKind.PASSIVE_BOARD]: PointPool.PASSIVE
};

/** 内置 Profile 预设 */
export const PROGRESSION_PRESETS = {
  classicRpg: {
    primary: ProgressionKind.TALENT_TREE,
    enabled: [ProgressionKind.SKILL_TREE, ProgressionKind.TALENT_TREE],
    secondary: []
  },
  arpg: {
    primary: ProgressionKind.TALENT_TREE,
    enabled: [
      ProgressionKind.SKILL_TREE,
      ProgressionKind.TALENT_TREE,
      ProgressionKind.UNIT_TALENT,
      ProgressionKind.PASSIVE_BOARD
    ],
    secondary: [ProgressionKind.PASSIVE_BOARD]
  },
  poeLike: {
    primary: ProgressionKind.PASSIVE_BOARD,
    enabled: [ProgressionKind.SKILL_TREE, ProgressionKind.PASSIVE_BOARD],
    secondary: []
  },
  roguelite: {
    primary: ProgressionKind.SKILL_TREE,
    enabled: [ProgressionKind.SKILL_TREE, ProgressionKind.PASSIVE_BOARD],
    secondary: [ProgressionKind.PASSIVE_BOARD]
  }
};

/** 默认 Profile：ARPG */
export const DEFAULT_PROFILE_NAME = 'arpg';

export class ProgressionProfile {
  /**
   * @param {Object} [config] - game.project.json 的 progression 字段
   * @param {string} [config.profile] - 预设名，可被其余字段覆盖
   * @param {string} [config.primary] - 主要成长结构
   * @param {Array<string>} [config.enabled] - 启用的结构
   * @param {Array<string>} [config.secondary] - 辅助结构
   * @param {Object} [config.pointPools] - 每个池为 'independent' 或共享池名
   * @param {Object} [config.unlock] - 各结构开放条件
   * @param {Object} [config.graphIds] - 结构 → 图标识覆盖
   */
  constructor(config = {}) {
    const presetName = config.profile || DEFAULT_PROFILE_NAME;
    const preset = PROGRESSION_PRESETS[presetName] || PROGRESSION_PRESETS[DEFAULT_PROFILE_NAME];

    this.profileName = PROGRESSION_PRESETS[presetName] ? presetName : DEFAULT_PROFILE_NAME;

    // 非法条目逐个过滤；过滤后为空（入参空数组或全非法）同样回退预设，保证 profile 始终可用
    const requestedEnabled = Array.isArray(config.enabled)
      ? config.enabled.filter(k => KIND_TO_MODE[k])
      : [];
    this.enabled = requestedEnabled.length > 0 ? requestedEnabled : [...preset.enabled];

    const requestedPrimary = config.primary || preset.primary;
    // 主结构必须在启用列表内，否则回退到启用列表首项
    this.primary = this.enabled.includes(requestedPrimary)
      ? requestedPrimary
      : (this.enabled[0] || preset.primary);

    this.secondary = (Array.isArray(config.secondary) ? config.secondary : preset.secondary)
      .filter(k => this.enabled.includes(k) && k !== this.primary);

    this.pointPools = { ...(config.pointPools || {}) };
    this.unlock = { ...(config.unlock || {}) };
    this.graphIds = { ...(config.graphIds || {}) };
  }

  /**
   * 某结构是否启用
   * @param {string} kind
   * @returns {boolean}
   */
  isEnabled(kind) {
    return this.enabled.includes(kind);
  }

  /**
   * 某结构是否为主要成长
   * @param {string} kind
   * @returns {boolean}
   */
  isPrimary(kind) {
    return this.primary === kind;
  }

  /**
   * 获取启用结构对应的图模式列表
   * @returns {Array<string>}
   */
  getEnabledModes() {
    return this.enabled.map(k => KIND_TO_MODE[k]);
  }

  /**
   * 获取结构对应的图模式
   * @param {string} kind
   * @returns {string|null}
   */
  getMode(kind) {
    return KIND_TO_MODE[kind] || null;
  }

  /**
   * 生成 PointLedger 的别名表：把配置为共享的逻辑池映射到同一物理池
   * @returns {Object}
   */
  getPointAliases() {
    const aliases = {};
    for (const [pool, setting] of Object.entries(this.pointPools)) {
      if (!setting || setting === 'independent') continue;
      aliases[pool] = setting;
    }
    return aliases;
  }

  /**
   * 获取结构的开放条件标识
   * @param {string} kind
   * @returns {string|null}
   */
  getUnlockCondition(kind) {
    return this.unlock[kind] || null;
  }

  /**
   * UI 页签顺序：主结构在前，其余按启用顺序
   * @returns {Array<string>}
   */
  getTabOrder() {
    const rest = this.enabled.filter(k => k !== this.primary);
    return [this.primary, ...rest];
  }

  /**
   * 校验配置
   * @returns {{ok: boolean, errors: Array<Object>}}
   */
  validate() {
    const errors = [];

    if (this.enabled.length === 0) {
      errors.push({ code: 'missingField', path: 'enabled', message: '至少需要启用一种成长结构' });
    }
    for (const kind of this.enabled) {
      if (!KIND_TO_MODE[kind]) {
        errors.push({ code: 'outOfRange', path: 'enabled', message: `未知成长结构: ${kind}` });
      }
    }
    if (!this.enabled.includes(this.primary)) {
      errors.push({ code: 'invalidReference', path: 'primary', message: '主要成长结构未启用' });
    }
    for (const [pool, setting] of Object.entries(this.pointPools)) {
      if (setting !== 'independent' && typeof setting !== 'string') {
        errors.push({ code: 'outOfRange', path: `pointPools.${pool}`, message: '点数池配置必须为 independent 或共享池名' });
      }
    }

    return { ok: errors.length === 0, errors };
  }

  /** 输出规范配置对象 */
  toJSON() {
    return {
      profile: this.profileName,
      primary: this.primary,
      enabled: [...this.enabled],
      secondary: [...this.secondary],
      pointPools: { ...this.pointPools },
      unlock: { ...this.unlock },
      graphIds: { ...this.graphIds }
    };
  }
}

export default ProgressionProfile;
