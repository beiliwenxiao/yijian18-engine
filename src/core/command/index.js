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

export {
  CommandContractKind,
  COMMAND_CONTRACT_SCHEMAS,
  CommandContractError,
  validateCommandContract,
  assertCommandContract,
  cloneCommandValue
} from './CommandContracts.js';
export { AuthorityPort, RemoteAuthorityAdapter, assertAuthorityPort } from './AuthorityPort.js';
export { LocalAuthorityAdapter, fingerprintCommand } from './LocalAuthorityAdapter.js';
export { CommandGateway } from './CommandGateway.js';
export { OperationLedger, OperationLedgerState, fingerprintOperation } from './OperationLedger.js';
export { LogicalClock, MonotonicClock, WallClock, AuthorityClocks } from './AuthorityClocks.js';
export { AuthorityRng } from './AuthorityRng.js';
export { StateRevisionStore } from './StateRevisionStore.js';
export { ProjectionStore } from './ProjectionStore.js';
export { PostCommitNotificationBus } from './PostCommitNotificationBus.js';
export { AuthoritySnapshotService, AUTHORITY_SNAPSHOT_SCHEMA_VERSION } from './AuthoritySnapshotService.js';
