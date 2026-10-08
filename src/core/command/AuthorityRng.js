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

const normalizeSeed = value => {
  if (Number.isInteger(value)) return value >>> 0;
  const text = String(value ?? 0);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
};

const mixSeed = (seed, text) => normalizeSeed(`${seed}:${text}`);
const clone = value => JSON.parse(JSON.stringify(value));

function sample(seed, counter) {
  let value = (seed + Math.imul(counter + 1, 0x6D2B79F5)) >>> 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

class AuthorityRngTransaction {
  constructor(owner, stream, substream, startCounter) {
    this.owner = owner;
    this.stream = stream;
    this.substream = substream;
    this.startCounter = startCounter;
    this.counter = startCounter;
    this.closed = false;
    this.seed = mixSeed(owner.seed, `${stream}:${substream}`);
  }

  next() {
    if (this.closed) throw new Error('authority RNG transaction is closed');
    return sample(this.seed, this.counter++);
  }

  int(min, max) {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) throw new RangeError('invalid integer range');
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min = 0, max = 1) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) throw new RangeError('invalid float range');
    return min + this.next() * (max - min);
  }

  chance(probability) {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new RangeError('invalid probability');
    return this.next() < probability;
  }

  commit() {
    if (this.closed) return false;
    this.closed = true;
    return this.owner._commit(this);
  }

  rollback() {
    if (this.closed) return false;
    this.closed = true;
    return true;
  }
}

/** seed + stream/substream + counter 的事务型确定性随机源。 */
export class AuthorityRng {
  constructor(config = {}) {
    this.seed = normalizeSeed(config.seed);
    this.counters = new Map();
    if (config.state) this.restore(config.state);
  }

  _key(stream, substream) { return `${stream}\u0000${substream}`; }

  begin(stream = 'authority', substream = 'default') {
    const normalizedStream = String(stream);
    const normalizedSubstream = String(substream);
    const counter = this.counters.get(this._key(normalizedStream, normalizedSubstream)) || 0;
    return new AuthorityRngTransaction(this, normalizedStream, normalizedSubstream, counter);
  }

  _commit(transaction) {
    const key = this._key(transaction.stream, transaction.substream);
    if ((this.counters.get(key) || 0) !== transaction.startCounter) {
      throw new Error('authority RNG counter conflict');
    }
    this.counters.set(key, transaction.counter);
    return true;
  }

  snapshot() {
    const streams = {};
    for (const [key, counter] of [...this.counters].sort(([a], [b]) => a.localeCompare(b))) {
      const [stream, substream] = key.split('\u0000');
      streams[stream] ||= { substreams: {} };
      streams[stream].substreams[substream] = { counter };
    }
    return { seed: this.seed, streams };
  }

  validateSnapshot(snapshot) {
    let ok = snapshot?.seed === this.seed && snapshot.streams && typeof snapshot.streams === 'object' && !Array.isArray(snapshot.streams);
    if (ok) {
      for (const stream of Object.values(snapshot.streams)) {
        if (!stream?.substreams || typeof stream.substreams !== 'object') { ok = false; break; }
        if (Object.values(stream.substreams).some(value => !Number.isInteger(value?.counter) || value.counter < 0)) { ok = false; break; }
      }
    }
    return { ok, errors: ok ? [] : [{ code: 'invalidRngState', path: '', message: 'authority RNG snapshot identity/counter 非法' }] };
  }

  restore(snapshot) {
    const validation = this.validateSnapshot(snapshot);
    if (!validation.ok) throw new TypeError(validation.errors[0].message);
    const counters = new Map();
    for (const [stream, streamState] of Object.entries(clone(snapshot.streams))) {
      for (const [substream, state] of Object.entries(streamState.substreams)) {
        counters.set(this._key(stream, substream), state.counter);
      }
    }
    this.counters = counters;
    return this;
  }
}
