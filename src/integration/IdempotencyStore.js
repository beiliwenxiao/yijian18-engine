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

function stableCopy(value) {
  if (Array.isArray(value)) return value.map(stableCopy);
  if (!value || typeof value !== 'object') return value;

  const copy = {};
  for (const key of Object.keys(value).sort()) copy[key] = stableCopy(value[key]);
  return copy;
}

export function stableDigest(value) {
  return JSON.stringify(stableCopy(value));
}

/**
 * 仅保存 JSON-RPC request/response attempt 去重信息。
 * operationId 业务幂等由 core/command/OperationLedger 独立拥有。
 */
export class IdempotencyStore {
  constructor() {
    this.requests = new Map();
    this.processedResponseIds = new Set();
    this.processedResultIds = new Set();
  }

  lookupRequest(requestId, payload) {
    const saved = this.requests.get(requestId);
    if (!saved) return { status: 'miss' };

    const digest = stableDigest(payload);
    if (saved.digest !== digest) {
      return { status: 'conflict', response: saved.response };
    }
    return { status: 'hit', response: saved.response };
  }

  rememberRequest(requestId, payload, response) {
    const existing = this.lookupRequest(requestId, payload);
    if (existing.status === 'conflict') return false;
    if (existing.status === 'hit') return true;

    this.requests.set(requestId, {
      digest: stableDigest(payload),
      response
    });
    return true;
  }


  hasProcessedResponse(responseId) {
    return this.processedResponseIds.has(responseId);
  }

  markResponseProcessed(responseId) {
    if (!responseId || this.processedResponseIds.has(responseId)) return false;
    this.processedResponseIds.add(responseId);
    return true;
  }

  hasProcessedResult(resultId) {
    return this.processedResultIds.has(resultId);
  }

  markResultProcessed(resultId) {
    if (!resultId || this.processedResultIds.has(resultId)) return false;
    this.processedResultIds.add(resultId);
    return true;
  }

  serialize() {
    return {
      requests: Array.from(this.requests.entries()),
      processedResponseIds: Array.from(this.processedResponseIds),
      processedResultIds: Array.from(this.processedResultIds)
    };
  }

  deserialize(data = {}) {
    this.requests = new Map(Array.isArray(data.requests) ? data.requests : []);
    this.processedResponseIds = new Set(data.processedResponseIds || []);
    this.processedResultIds = new Set(data.processedResultIds || []);
  }

  clear() {
    this.requests.clear();
    this.processedResponseIds.clear();
    this.processedResultIds.clear();
  }
}

export default IdempotencyStore;