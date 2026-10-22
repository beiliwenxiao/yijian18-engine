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

import { describe, it, expect } from 'vitest';
import { WorldActionPresentation } from './WorldActionPresentation.js';

/** 构造锚点实体（只带 transform.position）。 */
function anchorEntity(x, y) {
  return { getComponent: (id) => (id === 'transform' ? { position: { x, y } } : null) };
}

describe('WorldActionPresentation.getSortY（worldDepth Y-sort 基线）', () => {
  it('无活动呈现时返回 null（不入深度队列）', () => {
    const presenter = new WorldActionPresentation({});
    expect(presenter.getSortY()).toBeNull();
  });

  it('活动呈现时返回锚点实体（工作台）脚底 y', () => {
    const presenter = new WorldActionPresentation({});
    presenter.handleEvent('started', {
      anchorEntity: anchorEntity(120, 340),
      inputImageId: 's01.item.rawWolfMeat',
      inputSize: { width: 24, height: 24 },
      outputSize: { width: 24, height: 24 }
    }, 'cooking');
    expect(presenter.getSortY()).toBe(340);
  });

  it('完成呈现期间仍返回锚点 y（烤好的肉升起动画同样参与前后遮挡）', () => {
    const presenter = new WorldActionPresentation({ completionDuration: 1 });
    presenter.handleEvent('started', {
      anchorEntity: anchorEntity(50, 500),
      inputImageId: 'a',
      outputImageId: 'b',
      inputSize: {}, outputSize: {}
    }, 'cooking');
    presenter.handleEvent('completed', {}, 'cooking');
    expect(presenter.active).toBeNull();
    expect(presenter.getSortY()).toBe(500);
  });

  it('中断后回到 null', () => {
    const presenter = new WorldActionPresentation({});
    presenter.handleEvent('started', {
      anchorEntity: anchorEntity(0, 100), inputImageId: 'a', inputSize: {}, outputSize: {}
    }, 'cooking');
    presenter.handleEvent('interrupted', {}, 'cooking');
    expect(presenter.getSortY()).toBeNull();
  });

  it('锚点实体缺 transform 时返回 null（防御）', () => {
    const presenter = new WorldActionPresentation({});
    presenter.handleEvent('started', {
      anchorEntity: { getComponent: () => null },
      inputImageId: 'a', inputSize: {}, outputSize: {}
    }, 'cooking');
    expect(presenter.getSortY()).toBeNull();
  });
});
