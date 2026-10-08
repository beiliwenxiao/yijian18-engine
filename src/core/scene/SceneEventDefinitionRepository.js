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

/**
 * @deprecated 2026-08: SceneEventDefinitionRepository 已重命名为 FlowGroupDefinitionRepository。
 * 本文件作为兼容别名转发导入，保留一个大版本（或到所有项目执行过一键迁移后）删除。
 *
 * 迁移方式：
 *   - 新代码: import { FlowGroupDefinitionRepository } from './FlowGroupDefinitionRepository.js'
 *   - 旧代码: import { SceneEventDefinitionRepository } from './SceneEventDefinitionRepository.js'
 *     两者返回的是同一个类，运行时行为完全一致。
 */
export {
  FlowGroupDefinitionRepository as SceneEventDefinitionRepository,
  FlowGroupDefinitionRepository as default,
  FlowGroupDefinitionRepository
} from './FlowGroupDefinitionRepository.js';
