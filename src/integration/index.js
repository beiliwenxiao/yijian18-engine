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
  JSON_RPC_VERSION,
  JsonRpcErrorCode,
  JsonRpcProtocolError,
  createJsonRpcRequest,
  createJsonRpcSuccess,
  createJsonRpcError,
  validateJsonRpcRequest,
  unwrapJsonRpcResponse
} from './JsonRpcProtocol.js';
export { BattleMethod, BattleClient } from './BattleClient.js';
export { IdempotencyStore, IdempotencyStore as RequestResponseDedupStore, stableDigest } from './IdempotencyStore.js';
export { LocalMockTransport } from './LocalMockTransport.js';
export { WebSocketJsonRpcTransport, assertJsonRpcTransport } from './WebSocketJsonRpcTransport.js';
