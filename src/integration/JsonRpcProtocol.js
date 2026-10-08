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

const JSON_RPC_VERSION = '2.0';

export const JsonRpcErrorCode = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  REQUEST_ID_CONFLICT: -32009,
  INVALID_RESPONSE: -32010
});

export class JsonRpcProtocolError extends Error {
  constructor(requestId, code, message, data = null) {
    super(message);
    this.name = 'JsonRpcProtocolError';
    this.requestId = requestId ?? null;
    this.code = code;
    this.data = data;
    this.displayMessage = message;
  }
}

export function createJsonRpcRequest(id, method, params = {}) {
  if ((typeof id !== 'string' && typeof id !== 'number') || id === '') {
    throw new JsonRpcProtocolError(id, JsonRpcErrorCode.INVALID_REQUEST, 'JSON-RPC 请求必须包含稳定请求标识');
  }
  if (typeof method !== 'string' || method.length === 0) {
    throw new JsonRpcProtocolError(id, JsonRpcErrorCode.INVALID_REQUEST, 'JSON-RPC 请求必须包含方法名');
  }
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new JsonRpcProtocolError(id, JsonRpcErrorCode.INVALID_PARAMS, 'JSON-RPC params 必须为对象');
  }
  return { jsonrpc: JSON_RPC_VERSION, id, method, params };
}

export function createJsonRpcSuccess(id, result) {
  return { jsonrpc: JSON_RPC_VERSION, id, result };
}

export function createJsonRpcError(id, code, message, data = null) {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id: id ?? null,
    error: { code, message, ...(data == null ? {} : { data }) }
  };
}


export function validateJsonRpcRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return createJsonRpcError(null, JsonRpcErrorCode.INVALID_REQUEST, '无效的 JSON-RPC 请求');
  }
  if (request.jsonrpc !== JSON_RPC_VERSION) {
    return createJsonRpcError(request.id, JsonRpcErrorCode.INVALID_REQUEST, '仅支持 JSON-RPC 2.0');
  }
  if ((typeof request.id !== 'string' && typeof request.id !== 'number') || request.id === '') {
    return createJsonRpcError(request.id, JsonRpcErrorCode.INVALID_REQUEST, '请求缺少稳定 requestId');
  }
  if (typeof request.method !== 'string' || request.method.length === 0) {
    return createJsonRpcError(request.id, JsonRpcErrorCode.INVALID_REQUEST, '请求缺少 method');
  }
  if (!request.params || typeof request.params !== 'object' || Array.isArray(request.params)) {
    return createJsonRpcError(request.id, JsonRpcErrorCode.INVALID_PARAMS, 'params 必须为对象');
  }
  return null;
}

export function unwrapJsonRpcResponse(response, expectedId) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new JsonRpcProtocolError(expectedId, JsonRpcErrorCode.INVALID_RESPONSE, '战斗服务返回了无效响应');
  }
  if (response.jsonrpc !== JSON_RPC_VERSION || response.id !== expectedId) {
    throw new JsonRpcProtocolError(expectedId, JsonRpcErrorCode.INVALID_RESPONSE, '战斗服务响应标识不匹配', {
      actualId: response.id,
      actualVersion: response.jsonrpc
    });
  }
  if (response.error) {
    throw new JsonRpcProtocolError(
      response.id,
      response.error.code,
      response.error.message || '战斗服务请求失败',
      response.error.data ?? null
    );
  }
  if (!Object.prototype.hasOwnProperty.call(response, 'result')) {
    throw new JsonRpcProtocolError(expectedId, JsonRpcErrorCode.INVALID_RESPONSE, '战斗服务响应缺少 result');
  }
  return response.result;
}

export { JSON_RPC_VERSION };