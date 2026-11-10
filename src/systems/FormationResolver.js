/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://github.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * FormationResolver.js —— 军阵解析（模块 5 / 5B）
 *
 * 纯函数：把「军阵定义 + 兵种构成」解析成「部署槽位 + 姿态 + 战斗修正」，
 * 不持有状态、不读全局，供 BattlefieldRuntimeSystem 与编辑器共用。
 *
 * 三类信息（spec §3.2，定稿 P3：无阵法克制）：
 *   ① 数值修正  modifiers（语义键）→ combat {attack, defense, range, speed} 供 CombatModifierPipeline
 *   ② 场景标签  sceneTags（balanced | breakthrough | encircle | endurance | defense | ranged）
 *   ③ 地形偏好  terrainPreference { fit / miss }（默认只做提示，不产生惩罚）
 *
 * 历史内容策略（ambush / pursuit / three_lanes / siege / hold / retreat）走 STRATEGY_ALIASES
 * 映射到 6 种规范策略的位置模板；修正仍取内容自身 modifiers，不被模板覆盖。
 */

export const FORMATION_STRATEGIES = Object.freeze([
  'line', 'wedge', 'crane', 'fishscale', 'circle', 'echelon'
]);

/** 非规范策略 → 规范策略（位置模板用；修正仍读内容 modifiers）。 */
export const STRATEGY_ALIASES = Object.freeze({
  ambush: 'crane',
  pursuit: 'echelon',
  three_lanes: 'line',
  siege: 'fishscale',
  hold: 'circle',
  retreat: 'line'
});

export const DEPLOY_ROLES = Object.freeze(['front', 'mid', 'rear']);
export const DEPLOY_SLOTS = DEPLOY_ROLES;

/** 军阵策略元数据：名称 / 场景标签 / 地形偏好 / 修正要点 / 位置模板（行→角色与档位权重）。 */
export const STRATEGY_TEMPLATES = Object.freeze({
  line: {
    name: '列阵',
    sceneTags: ['balanced'],
    terrainPreference: { fit: ['plain', 'pass'], miss: [] },
    modifiers: { frontDefenseMultiplier: 1.1, chargeImpactMultiplier: 0.85 },
    combat: { attack: 1, defense: 1.1, range: 1, speed: 1 },
    layout: [
      { role: 'front', weight: 2 },
      { role: 'mid', weight: 2 },
      { role: 'rear', weight: 1 }
    ]
  },
  wedge: {
    name: '锋矢',
    sceneTags: ['breakthrough'],
    terrainPreference: { fit: ['plain', 'road'], miss: ['pass'] },
    modifiers: { chargeImpactMultiplier: 1.2, flankDefenseMultiplier: 0.85 },
    combat: { attack: 1.2, defense: 0.95, range: 1, speed: 1 },
    layout: [
      { role: 'front', weight: 1 },
      { role: 'mid', weight: 2 },
      { role: 'rear', weight: 3 }
    ]
  },
  crane: {
    name: '鹤翼',
    sceneTags: ['encircle'],
    terrainPreference: { fit: ['plain', 'open'], miss: ['pass', 'forest'] },
    modifiers: { wingAttackMultiplier: 1.15, centerDefenseMultiplier: 0.9 },
    combat: { attack: 1.15, defense: 0.95, range: 1, speed: 1 },
    layout: [
      { role: 'front', weight: 2 },
      { role: 'mid', weight: 1 },
      { role: 'rear', weight: 2 }
    ]
  },
  fishscale: {
    name: '鱼鳞',
    sceneTags: ['endurance'],
    terrainPreference: { fit: ['camp', 'forest'], miss: [] },
    modifiers: { enduranceMultiplier: 1.15 },
    combat: { attack: 1.05, defense: 1.05, range: 1, speed: 1 },
    layout: [
      { role: 'front', weight: 1 },
      { role: 'mid', weight: 2 },
      { role: 'rear', weight: 2 }
    ]
  },
  circle: {
    name: '圆阵',
    sceneTags: ['defense'],
    terrainPreference: { fit: ['pass', 'camp'], miss: ['open'] },
    modifiers: { frontDefenseMultiplier: 1.25, moveSpeedMultiplier: 0.7 },
    combat: { attack: 1, defense: 1.25, range: 1, speed: 0.7 },
    layout: [
      { role: 'front', weight: 3 },
      { role: 'mid', weight: 1 },
      { role: 'rear', weight: 1 }
    ]
  },
  echelon: {
    name: '雁行',
    sceneTags: ['ranged'],
    terrainPreference: { fit: ['highGround', 'riverbank'], miss: [] },
    modifiers: { firstContactMultiplier: 1.15, pursuitMultiplier: 1.2, flankAttackMultiplier: 1.1 },
    combat: { attack: 1.15, defense: 1, range: 1, speed: 1 },
    layout: [
      { role: 'front', weight: 1 },
      { role: 'mid', weight: 1 },
      { role: 'rear', weight: 3 }
    ]
  }
});

export const DEFAULT_STANCE_BY_ROLE = Object.freeze({
  front: 'assault',
  mid: 'hold',
  rear: 'escort'
});

export const DEFAULT_STACK_OFFSETS = Object.freeze({ rowGap: 56, colGap: 44 });

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const positiveInt = value => (Number.isInteger(value) && value > 0 ? value : null);
const num = (value, fallback = 1) => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

/** 规范策略：别名先归一，未知策略回落 line 并给出告警码。 */
export function normalizeStrategy(strategy) {
  const raw = typeof strategy === 'string' ? strategy.trim() : '';
  // 缺省策略 = line（旧内容未声明，不告警）；只有写了但认不出才告警
  if (!raw || raw === 'line') return { strategy: 'line', code: null };
  if (FORMATION_STRATEGIES.includes(raw)) return { strategy: raw, code: null };
  if (Object.prototype.hasOwnProperty.call(STRATEGY_ALIASES, raw)) {
    return { strategy: STRATEGY_ALIASES[raw], code: null, alias: raw };
  }
  return { strategy: 'line', code: 'unknownStrategy', requested: raw };
}

function normalizeExplicitRows(rows) {
  return rows
    .filter(isObject)
    .map((row, index) => ({
      line: Number.isInteger(row.line) ? row.line : index,
      role: DEPLOY_ROLES.includes(row.role) ? row.role : DEPLOY_ROLES[Math.min(index, DEPLOY_ROLES.length - 1)],
      slots: Array.isArray(row.slots) ? row.slots.map(slot => String(slot)) : []
    }));
}

/** 旧内容（rows:number + unitIds）：按兵种顺序铺成 rowCount 行，行角色按 front→mid→rear。 */
function legacyFillRows(unitIds, rowCount) {
  const perRow = Math.max(1, Math.ceil(unitIds.length / rowCount));
  const built = [];
  for (let line = 0; line < rowCount; line++) {
    const slice = unitIds.slice(line * perRow, (line + 1) * perRow);
    if (slice.length === 0) continue;
    built.push({
      line,
      role: DEPLOY_ROLES[Math.min(line, DEPLOY_ROLES.length - 1)],
      slots: slice.map(id => String(id))
    });
  }
  return built;
}

/** 按模板 + 兵数生成行列（内容没写 rows 时的位置模板）。 */
function buildRowsFromTemplate(strategy, unitCount, unitIds) {
  const template = STRATEGY_TEMPLATES[strategy] || STRATEGY_TEMPLATES.line;
  const total = Math.max(1, unitCount);
  const weightSum = template.layout.reduce((sum, row) => sum + row.weight, 0);
  const rows = [];
  let used = 0;
  template.layout.forEach((row, index) => {
    const last = index === template.layout.length - 1;
    const take = last ? total - used : Math.max(1, Math.round((total * row.weight) / weightSum));
    const capped = Math.max(0, Math.min(take, total - used));
    used += capped;
    if (capped === 0) return;
    rows.push({
      line: index,
      role: row.role,
      slots: Array.from({ length: capped }, (_, i) => {
        const id = unitIds[(rows.length + i) % unitIds.length];
        return String(id);
      })
    });
  });
  return rows;
}

/**
 * 解析一份军阵定义。
 *
 * @param {object} definition library.json.formations[] 条目
 * @param {{unitCount?:number, unitIds?:string[]}} [options] 运行期兵种构成（roster）优先于定义
 * @returns {{id, name, strategy, requestedStrategy, rows, columns, stackOffsets, stanceByRole,
 *            modifiers, combat, sceneTags, terrainPreference, source, warnings}}
 */
export function resolveFormation(definition, options = {}) {
  const def = isObject(definition) ? definition : {};
  const normalized = normalizeStrategy(def.strategy);
  const unitIds = (Array.isArray(options.unitIds) && options.unitIds.length > 0
    ? options.unitIds
    : (Array.isArray(def.unitIds) ? def.unitIds : [])).map(id => String(id));
  const unitCount = Math.max(1, Number.isInteger(options.unitCount)
    ? options.unitCount
    : (unitIds.length || 1));

  const hasExplicitRows = Array.isArray(def.rows) && def.rows.length > 0;
  // 兵种表就是编制的槽位表；只有完全没有编制时才按实际人数铺模板
  const layoutCount = unitIds.length > 0 ? unitIds.length : unitCount;
  let rows;
  if (hasExplicitRows) rows = normalizeExplicitRows(def.rows);
  else if (positiveInt(def.rows) && unitIds.length > 0) rows = legacyFillRows(unitIds, positiveInt(def.rows));
  else rows = buildRowsFromTemplate(normalized.strategy, layoutCount, unitIds.length > 0 ? unitIds : ['unknown']);
  if (rows.length === 0) rows = buildRowsFromTemplate(normalized.strategy, layoutCount, unitIds.length > 0 ? unitIds : ['unknown']);

  // 旧内容（rows 是数字）的 columns 只是历史提示，实际宽度取行内最大槽位数，避免全员告警
  const columns = (hasExplicitRows ? positiveInt(def.columns) : null)
    || rows.reduce((max, row) => Math.max(max, row.slots.length), 1);
  const template = STRATEGY_TEMPLATES[normalized.strategy];
  const modifiers = isObject(def.modifiers) ? { ...def.modifiers } : {};
  const combat = {
    attack: num(modifiers.attack, template.combat.attack),
    defense: num(modifiers.defense, template.combat.defense),
    range: num(modifiers.archerRangeMultiplier ?? modifiers.rangeMultiplier, template.combat.range),
    speed: num(modifiers.moveSpeedMultiplier, template.combat.speed)
  };
  const stanceByRole = {
    ...DEFAULT_STANCE_BY_ROLE,
    ...(isObject(def.stanceByRole) ? def.stanceByRole : {})
  };
  const sceneTags = Array.isArray(def.sceneTags) && def.sceneTags.length > 0
    ? def.sceneTags.filter(tag => typeof tag === 'string')
    : [...template.sceneTags];
  const terrainPreference = isObject(def.terrainPreference)
    ? { fit: Array.isArray(def.terrainPreference.fit) ? def.terrainPreference.fit : [], miss: Array.isArray(def.terrainPreference.miss) ? def.terrainPreference.miss : [] }
    : { ...template.terrainPreference };

  const warnings = [];
  if (normalized.code) warnings.push({ code: normalized.code, strategy: normalized.requested });
  const unitTypeMismatch = rows.some(row => row.slots.length !== columns);
  if (unitTypeMismatch) warnings.push({ code: 'rowWidthMismatch', columns });

  return {
    id: def.id != null ? String(def.id) : '',
    name: def.name != null ? String(def.name) : '',
    strategy: normalized.strategy,
    requestedStrategy: normalized.requested ?? normalized.alias ?? normalized.strategy,
    rows,
    columns,
    stackOffsets: { ...DEFAULT_STACK_OFFSETS, ...(isObject(def.stackOffsets) ? def.stackOffsets : {}) },
    stanceByRole,
    modifiers,
    combat,
    sceneTags,
    terrainPreference,
    leaderHeroId: def.leaderHeroId != null ? String(def.leaderHeroId) : null,
    source: def.source === 'auto' ? 'auto' : 'manual',
    warnings
  };
}

/**
 * 生成部署槽位（2.5D：y 压缩，行间距 rowGap，列间距 colGap，以阵心为原点）。
 *
 * @param {object} resolved resolveFormation 的返回值
 * @param {{originX?:number, originY?:number}} [options]
 * @returns {Array<{slotId, index, line, col, role, unitTypeId, x, y}>}
 */
export function buildDeploySlots(resolved, options = {}) {
  const originX = Number.isFinite(options.originX) ? options.originX : 0;
  const originY = Number.isFinite(options.originY) ? options.originY : 0;
  const { rows = [], columns = 1, stackOffsets = DEFAULT_STACK_OFFSETS } = resolved || {};
  const slots = [];
  let index = 0;
  rows.forEach((row, lineIndex) => {
    const width = Math.max(1, row.slots.length);
    const rowOffset = ((columns - width) * stackOffsets.colGap) / 2;
    row.slots.forEach((unitTypeId, col) => {
      slots.push({
        slotId: `${resolved?.id || 'formation'}:${lineIndex}:${col}`,
        index,
        line: row.line,
        col,
        role: row.role,
        unitTypeId,
        x: originX + rowOffset + col * stackOffsets.colGap,
        // 行号越大越靠后：2.5D 里"靠后"= y 更小
        y: originY - lineIndex * stackOffsets.rowGap
      });
      index += 1;
    });
  });
  return slots;
}

/** 按兵种把实体分配到槽位：优先同兵种，未匹配的按剩余槽位顺序补。 */
export function assignDeploySlots(slots, entities = []) {
  const remaining = [...(slots || [])];
  const assigned = [];
  const pending = [];
  for (const entity of entities) {
    const unitTypeId = entity?.unitTypeId ?? entity?.unitType ?? null;
    const hitIndex = unitTypeId == null
      ? -1
      : remaining.findIndex(slot => slot.unitTypeId === unitTypeId);
    if (hitIndex >= 0) {
      assigned.push({ entity, slot: remaining.splice(hitIndex, 1)[0] });
      continue;
    }
    pending.push(entity);
  }
  for (const entity of pending) {
    if (remaining.length === 0) {
      assigned.push({ entity, slot: null });
      continue;
    }
    assigned.push({ entity, slot: remaining.shift() });
  }
  return assigned;
}

/** 角色 → 小队姿态（无映射回落 hold）。 */
export function resolveStanceForRole(resolved, role) {
  const map = isObject(resolved?.stanceByRole) ? resolved.stanceByRole : DEFAULT_STANCE_BY_ROLE;
  return map[role] || map.mid || 'hold';
}

/** 地形契合提示：fit / miss / neutral（只做 UI 提示，不产生惩罚）。 */
export function resolveTerrainFit(resolved, terrainTags = []) {
  const pref = isObject(resolved?.terrainPreference) ? resolved.terrainPreference : {};
  const fit = Array.isArray(pref.fit) ? pref.fit : [];
  const miss = Array.isArray(pref.miss) ? pref.miss : [];
  const tags = Array.isArray(terrainTags) ? terrainTags : [];
  if (tags.some(tag => miss.includes(tag))) return 'miss';
  if (tags.some(tag => fit.includes(tag))) return 'fit';
  return 'neutral';
}

/**
 * 校验一份军阵定义（非致命 warnings，风格对齐 SkeletonAssetValidator）。
 *
 * @param {object} definition
 * @param {{unitTypeIds?:string[]}} [context]
 * @returns {{ok:boolean, warnings:Array<{code:string, message:string}>}}
 */
export function validateFormation(definition, context = {}) {
  const warnings = [];
  const def = isObject(definition) ? definition : {};
  const knownUnitTypes = Array.isArray(context.unitTypeIds) ? context.unitTypeIds : null;
  const resolved = resolveFormation(def);

  for (const warning of resolved.warnings) {
    if (warning.code === 'unknownStrategy') {
      warnings.push({ code: 'unknownStrategy', message: `未知军阵策略 ${warning.strategy ?? '(空)'}，按 line 模板布局` });
    } else if (warning.code === 'rowWidthMismatch') {
      warnings.push({ code: 'rowWidthMismatch', message: `存在行的槽位数 ≠ columns(${warning.columns})，部署会留空位` });
    }
  }
  if (knownUnitTypes) {
    for (const row of resolved.rows) {
      for (const slot of row.slots) {
        if (!knownUnitTypes.includes(slot)) {
          warnings.push({ code: 'unknownUnitType', message: `第 ${row.line} 行的兵种 ${slot} 不在 unitTypes 表中` });
        }
      }
    }
  }
  const seenHero = def.leaderHeroId != null && String(def.leaderHeroId).trim() !== '';
  if (!seenHero && Array.isArray(def.unitIds) && def.unitIds.length === 0 && resolved.rows.length === 0) {
    warnings.push({ code: 'emptyFormation', message: '军阵既没有 unitIds 也没有 rows，部署将为空' });
  }
  return { ok: true, warnings };
}

export default resolveFormation;
