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
 ************************************************************
 * 三国张角传 - 结局输入纯投影（E1）
 * 与运行时解耦：只做「读取态 → EndingSystem 输入」的形状转换；
 * 锚点字段缺失时抛错（endingInputMissingPaths），不静默产出空输入。
 ************************************************************/

/** 投影源必须有值的锚点字段（缺失即视为读取失败，而非合法的空结局输入）。 */
export const REQUIRED_ENDING_INPUT_PATHS = Object.freeze([
  'storyState',
  'warState',
  'battleModeStats',
  'hiddenInputs',
  'retreatReadiness'
]);

/** 城市锚点二选一：coreCityState 为主键，cityState 为旧别名。 */
export const REQUIRED_CITY_STATE_PATHS = Object.freeze(['coreCityState', 'cityState']);

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function getPath(source, path) {
  return String(path || '').split('.').reduce((value, key) => value == null ? undefined : value[key], source);
}

/**
 * 校验投影源状态是否具备结局输入所需的锚点字段。
 * @param {Object} state - `_readS13S14State()` 形状的运行时读取态
 * @returns {{ok: boolean, code?: string, missingPaths?: string[], message?: string}}
 */
export function validateEndingInput(state) {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    return { ok: false, code: 'endingInputInvalidState', missingPaths: [], message: '结局输入状态不是对象。' };
  }
  const missingPaths = REQUIRED_ENDING_INPUT_PATHS.filter(path => getPath(state, path) == null);
  if (REQUIRED_CITY_STATE_PATHS.every(path => getPath(state, path) == null)) {
    missingPaths.push(REQUIRED_CITY_STATE_PATHS.join('|'));
  }
  if (missingPaths.length > 0) {
    return {
      ok: false,
      code: 'endingInputMissingPaths',
      missingPaths,
      message: `结局输入缺失字段：${missingPaths.join('、')}。`
    };
  }
  return { ok: true, missingPaths: [] };
}

/**
 * 校验并要求投影源可用；缺失时抛出带 code/missingPaths 的错误
 * （EndingSystem 会将其包装为 inputProjectionFailed 并把 message 带出）。
 */
export function requireEndingInput(state) {
  const checked = validateEndingInput(state);
  if (checked.ok) return state;
  const error = new Error(checked.message);
  error.code = checked.code;
  error.missingPaths = checked.missingPaths;
  throw error;
}

/**
 * 纯投影：运行时读取态 → EndingSystem 输入。无副作用、不读写场景。
 * @param {{state?: Object, normalized?: Object}} params
 *   state=宿主读取态；normalized=S13S14Coordinator.normalizeEndingSnapshot() 的归一化兜底
 */
export function projectEndingInput({ state = {}, normalized = {} } = {}) {
  const story = state.storyState || normalized.storyState || {};
  const modes = story.battleModes || {};
  const eligibleIds = state.battleModeStats?.eligibleBattleIds || normalized.battleModeStats?.eligibleBattleIds
    || Object.keys(modes);
  const selectedModes = eligibleIds.map(id => modes[id]).filter(mode => ['observe', 'intervene'].includes(mode));
  const observed = selectedModes.filter(mode => mode === 'observe').length;
  const intervened = selectedModes.filter(mode => mode === 'intervene').length;
  const cumulative = state.hiddenInputs?.cumulativeGathering || normalized.hiddenInputs?.cumulativeGathering || {};
  const totalGathered = Object.values(cumulative).reduce((total, value) => total + Math.max(0, Math.floor(Number(value) || 0)), 0);
  const damage = clamp(state.coreCityState?.damageRatio ?? state.cityState?.damageRatio
    ?? normalized.cityState?.coreDamageRatio, 0, 1);
  const constructionScore = Math.max(0, Math.floor(Number(
    state.hiddenInputs?.resourceConstructionScore ?? normalized.hiddenInputs?.resourceConstructionScore
  ) || 0));
  return {
    storyState: clone(story),
    cityState: { coreCityId: state.coreCityState?.id || normalized.cityState?.coreCityId || null, coreDamageRatio: damage },
    warState: clone(state.warState || normalized.warState || {}),
    heroStates: {
      primary: [
        { id: 'hero.zhang_liang', alive: story.zhangLiangSurvived === true },
        { id: 'hero.zhang_bao', alive: story.zhangBaoSurvived === true }
      ],
      support: [
        { id: 'hero.bocai', alive: story.bocaiSurvived === true },
        { id: 'hero.zhang_mancheng', alive: story.zhangManchengSurvived === true }
      ]
    },
    battleModeStats: { optionalBattles: selectedModes.length, observed, intervened },
    retreatReadiness: !!(state.retreatReadiness?.ready ?? normalized.retreatReadiness?.ready),
    hiddenInputs: {
      totalGathered,
      cityMaintenanceLevel: Math.max(0, Number(
        state.hiddenInputs?.cityMaintenanceLevel ?? normalized.hiddenInputs?.cityMaintenanceLevel
      ) || 0),
      resourceConstructionScore: constructionScore,
      allOptionalBattlesObserved: selectedModes.length > 0 && observed === selectedModes.length,
      cityDamageNeglected: state.hiddenInputs?.allowedCityDestruction === true || damage >= 0.6,
      scorchedEarthChosen: story.scorchedEarthChoice === true
    }
  };
}
