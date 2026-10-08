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
 * 未来 WebSocket JSON-RPC transport 的接口边界。
 * 当前单机交付不建立连接；测试或未来宿主必须显式提供 request(request) 实现。
 */
export class WebSocketJsonRpcTransport {
  async request(_request) {
    throw new Error('WebSocketJsonRpcTransport is an interface; no production transport is configured');
  }
}

export function assertJsonRpcTransport(transport) {
  if (!transport || typeof transport.request !== 'function') {
    throw new TypeError('JSON-RPC transport requires request(request)');
  }
  return transport;
}

export default WebSocketJsonRpcTransport;
