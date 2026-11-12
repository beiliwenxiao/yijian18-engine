/**
 * 据点判定：玩家是否已"立足"（军团层入口的唯一判定源）。
 *
 * B1 契约（见 .trae/documents/B1-实施清单.md）：
 * - 口径 = 己方城 ≥1 **或** 己方营地 ≥1（营地不算城，但足以支撑军团层入口）。
 * - 数据源：`game.project.json` 的 `variables.cityStates` 与 `logistics.camps`
 *   （S02 起 `camp.s02.field` 的 `ownerFactionId` 已是 `player`）。
 * - 数据缺失时**放行**（返回 true），避免旧档/测试场景因缺配置而把入口整体关死。
 */

const PLAYER_FACTION_ID = 'player';

/**
 * @param {Object} [input]
 * @param {Object|null} [input.project] - game.project.json
 * @param {Array|null} [input.cityStates] - 运行时城态（覆盖 project.variables.cityStates）
 * @param {Array|null} [input.camps] - 运行时营地（覆盖 project.logistics.camps）
 * @param {string} [input.factionId] - 玩家阵营（默认 player）
 * @returns {boolean}
 */
export function hasPlayerStronghold({ project = null, cityStates = null, camps = null, factionId = PLAYER_FACTION_ID } = {}) {
  const states = Array.isArray(cityStates) ? cityStates : project?.variables?.cityStates;
  const campList = Array.isArray(camps) ? camps : project?.logistics?.camps;
  if (!Array.isArray(states) && !Array.isArray(campList)) return true;
  if (Array.isArray(states) && states.some(entry => entry?.factionId === factionId)) return true;
  if (Array.isArray(campList) && campList.some(entry => entry?.ownerFactionId === factionId)) return true;
  return false;
}

/**
 * 场景适配：从场景拿项目数据（军团层三个入口共用）。
 * 拿不到项目数据时放行，保持既有行为不变。
 * @param {Object|null} scene
 * @returns {boolean}
 */
export function sceneHasPlayerStronghold(scene) {
  const project = scene?.gameLoader?.project || scene?.loader?.project || null;
  if (!project) return true;
  return hasPlayerStronghold({ project });
}

export default hasPlayerStronghold;
