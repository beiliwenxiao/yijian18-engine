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

import { describe, expect, it } from 'vitest';
import { SkeletonEditor } from './SkeletonEditor.js';

describe('SkeletonEditor 模块加载', () => {
  it('主文件语法与依赖链完好（类导出可用）', () => {
    expect(typeof SkeletonEditor).toBe('function');
  });

  it('静态工具方法可用（骨骼 id 显示名带中文映射）', () => {
    expect(typeof SkeletonEditor._displayName).toBe('function');
    expect(SkeletonEditor._displayName('armFR')).toContain('armFR');
  });
});
