/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

import { describe, it, expect } from 'vitest';
import { SceneWorldItemEventPresenter } from './SceneWorldItemEventPresenter.js';

/** 收集 notify 消息的 presenter 桩。 */
function makePresenter({ resolveItemName = null } = {}) {
  const messages = [];
  const presenter = new SceneWorldItemEventPresenter({
    resolveItemName,
    notify: ({ message }) => messages.push(message)
  });
  return { presenter, messages };
}

describe('SceneWorldItemEventPresenter 掉落提示名称解析', () => {
  it('payload 带 name 时直接使用', () => {
    const { presenter, messages } = makePresenter({});
    presenter.present({ type: 'item.dropped', payload: { name: '狼皮', definitionId: 'resource.wolf_hide' } });
    expect(messages[0]).toBe('狼皮已掉落。');
  });

  it('payload 无 name：经 resolveItemName 查内容库显示名', () => {
    const { presenter, messages } = makePresenter({
      resolveItemName: id => (id === 'resource.wolf_hide' ? '狼皮' : null)
    });
    presenter.present({ type: 'item.deathDropCreated', payload: { definitionId: 'resource.wolf_hide' } });
    expect(messages[0]).toBe('狼皮掉落在地上。');
  });

  it('resolver 未命中：回退 definitionId（旧行为）', () => {
    const { presenter, messages } = makePresenter({ resolveItemName: () => null });
    presenter.present({ type: 'item.dropped', payload: { definitionId: 'resource.unknown' } });
    expect(messages[0]).toBe('resource.unknown已掉落。');
  });

  it('未注入 resolver：回退 definitionId（零回归）', () => {
    const { presenter, messages } = makePresenter({});
    presenter.present({ type: 'item.dropped', payload: { definitionId: 'resource.raw_wolf_meat' } });
    expect(messages[0]).toBe('resource.raw_wolf_meat已掉落。');
  });

  it('restore/announce=false 事件不播报', () => {
    const { presenter, messages } = makePresenter({ resolveItemName: () => '狼皮' });
    presenter.present({ type: 'item.dropped', payload: { definitionId: 'resource.wolf_hide', reason: 'restore' } });
    expect(messages.length).toBe(0);
  });
});
