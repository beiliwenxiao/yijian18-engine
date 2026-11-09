/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://github.com/coderaaa/yijian18-engine
 ************************************************************/

import { describe, expect, it } from 'vitest';
import {
  RESOURCE_IDS,
  RESOURCE_NODE_TYPES,
  isResourceId,
  isResourceNodeType
} from './ResourceIds.js';
import { RESOURCE_NODE_SCHEMA } from './schema/CanonicalSchemas.js';

describe('ResourceIds', () => {
  it('coin 是合法资源键但不是采集产出', () => {
    expect(isResourceId('coin')).toBe(true);
    expect(isResourceNodeType('coin')).toBe(false);
    expect(RESOURCE_NODE_TYPES).not.toContain('coin');
  });

  it('五个采集资源键保持原样', () => {
    expect([...RESOURCE_NODE_TYPES].sort()).toEqual(['food', 'herb', 'iron', 'stone', 'wood']);
    expect([...RESOURCE_IDS]).toEqual(expect.arrayContaining(['coin', ...RESOURCE_NODE_TYPES]));
  });

  it('采集节点 schema 的 enum 与 RESOURCE_NODE_TYPES 同源（不会各写一份漂移）', () => {
    expect([...RESOURCE_NODE_SCHEMA.fields.resourceType.enum].sort()).toEqual([...RESOURCE_NODE_TYPES].sort());
  });

  it('非法键被拒绝', () => {
    expect(isResourceId('gold')).toBe(false);
    expect(isResourceNodeType(undefined)).toBe(false);
  });
});
