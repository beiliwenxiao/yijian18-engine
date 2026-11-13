/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 ************************************************************/

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  SceneEditorUI,
  TERRAIN_COMBAT_MODIFIER_FIELDS,
  TERRAIN_COMBAT_PRESETS,
  terrainCombatSummary
} from './SceneEditorUI.js';

const buildPanel = obj => {
  const ui = Object.create(SceneEditorUI.prototype);
  return ui._buildBuffZoneProperties(obj);
};

const buffZone = effect => ({
  type: 'buffZone',
  id: 'buffZone-test',
  name: '测试区域',
  shapeType: 'polygon',
  points: [[0, 0], [100, 0], [100, 100], [0, 100]],
  effect
});

describe('场景编辑器 buffZone 地势战斗面板（M5 · 5C）', () => {
  it('时序效果为默认类别，保留原表单且不出现地势字段', () => {
    const html = buildPanel(buffZone({ effectType: 'periodic', stat: 'hp', value: 3 }));
    expect(html).toContain('data-prop="effect.kind"');
    expect(html).toContain('>时序效果（进入/周期/延迟）</option>');
    expect(html).toContain('data-prop="effect.effectType"');
    expect(html).toContain('data-prop="effect.stat"');
    expect(html).not.toContain('data-prop="effect.modifiers.');
    expect(html).not.toContain('data-prop="effect.tags"');
  });

  it('选地势战斗后渲染地势类型/作用方/兵种过滤/四条倍率', () => {
    const html = buildPanel(buffZone({
      kind: 'terrainCombat',
      tags: ['highGround'],
      side: 'attacker',
      unitTypeFilter: ['unit.archer'],
      modifiers: { archerRangeMultiplier: 1.25, defenseMultiplier: 1.1 }
    }));
    expect(html).toContain('>地势战斗（terrainCombat）</option>');
    expect(html).toContain('data-prop="effect.tags"');
    for (const [key, preset] of Object.entries(TERRAIN_COMBAT_PRESETS)) {
      expect(html).toContain(`value="${key}"`);
      expect(html).toContain(preset.label);
    }
    expect(html).toContain('data-prop="effect.side"');
    expect(html).toContain('data-prop="effect.unitTypeFilter"');
    expect(html).toContain('value="unit.archer"');
    for (const field of TERRAIN_COMBAT_MODIFIER_FIELDS) {
      expect(html).toContain(`data-prop="effect.modifiers.${field.key}"`);
    }
    expect(html).toContain('value="1.25"');
    expect(html).toContain('value="1.1"');
    // 地形类别下不再渲染时序字段
    expect(html).not.toContain('data-prop="effect.effectType"');
    expect(html).not.toContain('data-prop="effect.interval"');
  });

  it('预设只用既有 terrainCombat 字段与解析器认的倍率键', () => {
    const allowed = new Set(TERRAIN_COMBAT_MODIFIER_FIELDS.map(field => field.key));
    for (const preset of Object.values(TERRAIN_COMBAT_PRESETS)) {
      expect(Object.keys(preset).sort()).toEqual(['border', 'fill', 'label', 'modifiers']);
      for (const key of Object.keys(preset.modifiers)) expect(allowed.has(key)).toBe(true);
    }
  });

  it('画布标签显示地势名与非 1 倍率', () => {
    expect(terrainCombatSummary({
      kind: 'terrainCombat',
      tags: ['highGround'],
      modifiers: { archerRangeMultiplier: 1.25, defenseMultiplier: 1.1 }
    })).toBe('高台 · 防×1.1 射程×1.25');
    expect(terrainCombatSummary({ kind: 'terrainCombat', tags: ['camp'] })).toBe('营地');
    expect(terrainCombatSummary({ kind: 'terrainCombat' })).toBe('地势');
  });
});
