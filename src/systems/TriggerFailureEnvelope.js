const SENSITIVE_KEY = /password|passwd|secret|token|credential|authorization|cookie|private|save(?:data|state|snapshot)?/i;
const MAX_DEPTH = 12;
const MAX_ARRAY = 100;

function redactString(value) {
  return value
    .replace(/(bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:password|passwd|secret|token|credential)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

function serialize(value, state, key = '', depth = 0) {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol' || typeof value === 'function') return `[${typeof value}]`;
  if (depth >= MAX_DEPTH) return '[MaxDepth]';
  if (state.seen.has(value)) return `[Circular:${state.seen.get(value)}]`;

  const path = state.path || '$';
  state.seen.set(value, path);
  if (value instanceof Error) {
    const result = {
      name: value.name || 'Error',
      message: redactString(value.message || String(value)),
      code: typeof value.code === 'string' ? value.code : null,
      stack: typeof value.stack === 'string' ? redactString(value.stack) : null
    };
    if (value.cause !== undefined) {
      result.cause = serialize(value.cause, { ...state, path: `${path}.cause` }, 'cause', depth + 1);
    }
    if (value.result !== undefined) {
      result.result = serialize(value.result, { ...state, path: `${path}.result` }, 'result', depth + 1);
    }
    for (const property of Object.keys(value).sort()) {
      if (['name', 'message', 'code', 'stack', 'cause', 'result'].includes(property)) continue;
      result[property] = serialize(value[property], { ...state, path: `${path}.${property}` }, property, depth + 1);
    }
    return result;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item, index) => (
      serialize(item, { ...state, path: `${path}[${index}]` }, String(index), depth + 1)
    ));
  }
  const result = {};
  for (const property of Object.keys(value).sort()) {
    result[property] = serialize(value[property], { ...state, path: `${path}.${property}` }, property, depth + 1);
  }
  return result;
}

export function safeSerializeTriggerValue(value) {
  return serialize(value, { seen: new WeakMap(), path: '$' });
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach(child => deepFreeze(child, seen));
  return Object.freeze(value);
}

export function createTriggerFailureEnvelope({
  trigger, action, actionIndex, actionDescriptor = null, operationId,
  actionOperationId = null, definitionRevision, fingerprint, phase,
  error, event, context, startedAt, failedAt, seed = null
}) {
  const reason = error?.code || error?.result?.code || 'triggerActionFailed';
  const envelope = {
    type: 'triggerFailure',
    triggerId: trigger?.id || null,
    action: {
      id: action?.action || null,
      index: actionIndex,
      descriptor: safeSerializeTriggerValue(actionDescriptor),
      input: safeSerializeTriggerValue(action)
    },
    operationId,
    actionOperationId,
    definitionRevision,
    phase: phase || error?.triggerPhase || 'actionExecution',
    reason,
    executionContext: safeSerializeTriggerValue({ event, context }),
    error: safeSerializeTriggerValue(error instanceof Error ? error : new Error(String(error || reason))),
    replay: {
      fingerprint,
      seed: safeSerializeTriggerValue(seed),
      clock: { startedAt, failedAt },
      token: `${definitionRevision}:${trigger?.id || 'unknown'}:${operationId}:${actionIndex}`
    }
  };
  return deepFreeze(envelope);
}

export class TriggerExecutionError extends Error {
  constructor(envelope, cause) {
    super(`Trigger ${envelope.triggerId} action ${envelope.action.index} failed: ${envelope.reason}`);
    this.name = 'TriggerExecutionError';
    this.code = envelope.reason;
    this.envelope = envelope;
    this.triggerId = envelope.triggerId;
    this.actionIndex = envelope.action.index;
    this.operationId = envelope.operationId;
    this.cause = cause;
  }
}
