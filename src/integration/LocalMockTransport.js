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

import { RNG } from '../core/RNG.js';
import { createContentValidator } from '../core/validation/ContentSchemas.js';
import { CANONICAL_SCHEMA_VERSION } from '../data/schema/CanonicalSchemas.js';
import { BattleMethod } from './BattleClient.js';
import { IdempotencyStore } from './IdempotencyStore.js';
import {
  JsonRpcErrorCode,
  JsonRpcProtocolError,
  createJsonRpcError,
  createJsonRpcSuccess,
  validateJsonRpcRequest
} from './JsonRpcProtocol.js';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function requiredObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new JsonRpcProtocolError(null, JsonRpcErrorCode.INVALID_PARAMS, `${name} 必须为对象`, { path: name });
  }
  return value;
}

function requireFields(value, fields) {
  for (const field of fields) {
    if (value[field] === undefined || value[field] === null || value[field] === '') {
      throw new JsonRpcProtocolError(null, JsonRpcErrorCode.INVALID_PARAMS, `缺少必填参数 ${field}`, { path: field });
    }
  }
}

/** 确定性本地战斗服务；不直接修改任何游戏领域状态。 */
export class LocalMockTransport {
  constructor(config = {}) {
    this.validator = config.validator || createContentValidator({ supportedVersion: CANONICAL_SCHEMA_VERSION });
    this.idempotency = config.idempotency || new IdempotencyStore();
    this.rngFactory = config.rngFactory || (seed => new RNG(seed));
    this._battles = new Map();
    this._interventions = new Map();
  }

  async request(request) {
    const malformed = validateJsonRpcRequest(request);
    if (malformed) return malformed;

    const known = this.idempotency.lookupRequest(request.id, request);
    if (known.status === 'hit') return cloneJson(known.response);
    if (known.status === 'conflict') {
      return createJsonRpcError(
        request.id,
        JsonRpcErrorCode.REQUEST_ID_CONFLICT,
        '相同 requestId 不得对应不同请求载荷'
      );
    }

    let response;
    try {
      response = createJsonRpcSuccess(request.id, this._dispatch(request));
    } catch (error) {
      response = this._toErrorResponse(request.id, error);
    }

    this.idempotency.rememberRequest(request.id, request, response);
    return cloneJson(response);
  }


  _dispatch(request) {
    switch (request.method) {
      case BattleMethod.CREATE:
        return this._createBattle(request.id, request.params);
      case BattleMethod.INTERVENE:
        return this._intervene(request.id, request.params);
      case BattleMethod.REPORT_RESULT:
        return this._reportBattleResult(request.id, request.params);
      default:
        throw new JsonRpcProtocolError(
          request.id,
          JsonRpcErrorCode.METHOD_NOT_FOUND,
          `未知战斗方法 ${request.method}`
        );
    }
  }

  _createBattle(requestId, params) {
    requiredObject(params, 'params');
    requireFields(params, [
      'battleId', 'terrainId', 'attackerArmy', 'defenderArmy',
      'attackerMorale', 'defenderMorale', 'attackerCommanderId',
      'defenderCommanderId', 'weather', 'seed', 'affectedCityId',
      'resourceSourceCityId', 'resourceDestinationCityId'
    ]);

    if (!Number.isInteger(params.seed)) {
      throw new JsonRpcProtocolError(requestId, JsonRpcErrorCode.INVALID_PARAMS, 'seed 必须为整数', { path: 'seed' });
    }
    for (const key of ['attackerMorale', 'defenderMorale']) {
      if (!Number.isInteger(params[key]) || params[key] < 0) {
        throw new JsonRpcProtocolError(requestId, JsonRpcErrorCode.INVALID_PARAMS, `${key} 必须为非负整数`, { path: key });
      }
    }

    const attacker = this._validateArmy(params.attackerArmy, 'attackerArmy', requestId);
    const defender = this._validateArmy(params.defenderArmy, 'defenderArmy', requestId);
    const existing = this._battles.get(params.battleId);
    const battle = {
      battleId: params.battleId,
      terrainId: params.terrainId,
      attackerArmy: attacker,
      defenderArmy: defender,
      attackerMorale: params.attackerMorale,
      defenderMorale: params.defenderMorale,
      attackerCommanderId: params.attackerCommanderId,
      defenderCommanderId: params.defenderCommanderId,
      weather: params.weather,
      seed: params.seed,
      affectedCityId: params.affectedCityId,
      resourceSourceCityId: params.resourceSourceCityId,
      resourceDestinationCityId: params.resourceDestinationCityId,
      logicalTime: Number.isInteger(params.logicalTime) && params.logicalTime >= 0 ? params.logicalTime : 0,
      resourceNodeIds: Array.isArray(params.resourceNodeIds) ? [...params.resourceNodeIds] : []
    };

    if (existing && JSON.stringify(existing) !== JSON.stringify(battle)) {
      throw new JsonRpcProtocolError(requestId, JsonRpcErrorCode.INVALID_PARAMS, 'battleId 已对应另一场战斗', {
        path: 'battleId'
      });
    }
    this._battles.set(params.battleId, battle);

    return {
      responseId: `response-${requestId}`,
      battleId: battle.battleId,
      status: 'created',
      seed: battle.seed
    };
  }

  _validateArmy(candidate, path, requestId) {
    const loaded = this.validator.loadCandidate(candidate, 'army', null);
    if (!loaded.committed) {
      throw new JsonRpcProtocolError(requestId, JsonRpcErrorCode.INVALID_PARAMS, `${path} 不符合 Army Schema`, {
        path,
        errors: loaded.errors
      });
    }
    return loaded.value;
  }


  _intervene(requestId, params) {
    requiredObject(params, 'params');
    requireFields(params, ['battleId', 'heroId', 'entryPoint']);
    const battle = this._battles.get(params.battleId);
    if (!battle) {
      throw new JsonRpcProtocolError(requestId, JsonRpcErrorCode.INVALID_PARAMS, '战斗不存在', { path: 'battleId' });
    }

    const entryPoint = requiredObject(params.entryPoint, 'entryPoint');
    requireFields(entryPoint, ['x', 'y']);
    if (![entryPoint.x, entryPoint.y].every(Number.isFinite)) {
      throw new JsonRpcProtocolError(requestId, JsonRpcErrorCode.INVALID_PARAMS, '进入点坐标必须为有限数值', {
        path: 'entryPoint'
      });
    }

    const intervention = {
      battleId: params.battleId,
      heroId: params.heroId,
      entryPoint: cloneJson(entryPoint)
    };
    this._interventions.set(params.battleId, intervention);

    return {
      responseId: `response-${requestId}`,
      ...intervention,
      accepted: true
    };
  }

  _reportBattleResult(requestId, params) {
    requiredObject(params, 'params');
    requireFields(params, ['battleId']);
    const battle = this._battles.get(params.battleId);
    if (!battle) {
      throw new JsonRpcProtocolError(requestId, JsonRpcErrorCode.INVALID_PARAMS, '战斗不存在', { path: 'battleId' });
    }

    const candidate = params.battleResult
      ? params.battleResult
      : this._generateBattleResult(requestId, battle, params);
    const loaded = this.validator.loadCandidate(candidate, 'battleResult', null);
    if (!loaded.committed) {
      throw new JsonRpcProtocolError(requestId, JsonRpcErrorCode.INVALID_PARAMS, '战果不符合 BattleResult Schema', {
        path: 'battleResult',
        errors: loaded.errors
      });
    }

    return loaded.value;
  }

  _generateBattleResult(requestId, battle, params) {
    const rng = this.rngFactory(battle.seed);
    if (!rng || ['next', 'int', 'float', 'chance'].some(method => typeof rng[method] !== 'function')) {
      throw new Error('rngFactory 必须返回 RNG 兼容对象');
    }

    const moraleTotal = battle.attackerMorale + battle.defenderMorale;
    const attackerChance = moraleTotal > 0
      ? battle.attackerMorale / moraleTotal
      : 0.5;
    const attackerWon = rng.next() < attackerChance;
    const winner = attackerWon ? battle.attackerArmy : battle.defenderArmy;
    const loser = attackerWon ? battle.defenderArmy : battle.attackerArmy;
    const resources = ['wood', 'iron', 'food', 'herb'];
    const capturedResources = {};
    for (const resource of resources) capturedResources[resource] = rng.int(0, 20);

    const damagedResourceNodeIds = battle.resourceNodeIds.filter(() => rng.chance(0.35));
    return {
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      resultId: `result-${battle.battleId}-${battle.seed}`,
      responseId: `response-${requestId}`,
      battleId: battle.battleId,
      winnerFactionId: winner.factionId,
      casualties: {
        [winner.id]: rng.int(0, 10),
        [loser.id]: rng.int(5, 25)
      },
      capturedResources,
      resourceTransfer: {
        fromCityId: battle.resourceSourceCityId,
        toCityId: battle.resourceDestinationCityId,
        resources: { ...capturedResources }
      },
      affectedCityId: battle.affectedCityId,
      cityDamage: Math.round(rng.float(0, 0.6) * 1000) / 1000,
      damagedResourceNodeIds,
      completedAt: Number.isInteger(params.logicalTime) && params.logicalTime >= 0
        ? params.logicalTime
        : battle.logicalTime
    };
  }


  _toErrorResponse(requestId, error) {
    if (error instanceof JsonRpcProtocolError) {
      return createJsonRpcError(
        requestId,
        error.code,
        error.message,
        error.data
      );
    }
    return createJsonRpcError(
      requestId,
      JsonRpcErrorCode.INTERNAL_ERROR,
      '本地战斗服务处理失败',
      { cause: String(error && error.message ? error.message : error) }
    );
  }
}

export default LocalMockTransport;