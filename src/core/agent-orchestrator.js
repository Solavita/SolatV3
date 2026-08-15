const crypto = require('node:crypto');

const AGENT_PLAN_SCHEMA_VERSION = 'solat.agent-plan.v1';
const AGENT_AUDIT_SCHEMA_VERSION = 'solat.agent-audit.v1';
const DEFAULT_LIMITS = Object.freeze({
  maxSteps: 12,
  maxIterations: 12,
  timeoutMs: 30_000,
  retryLimit: 0,
});

class AgentContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AgentContractError';
    this.code = code;
    this.details = details;
  }
}

function required(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new AgentContractError('invalid_plan', `${field} is required.`, { field });
  return value.trim();
}

function boundedInteger(value, field, fallback, maximum) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) throw new AgentContractError('invalid_plan', `${field} is out of bounds.`, { field, maximum });
  return number;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {});
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function tokenHash(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function makeId(prefix, factory = crypto.randomUUID) {
  const value = factory();
  if (typeof value !== 'string' || !value.trim()) throw new AgentContractError('invalid_plan', `Unable to create ${prefix} id.`);
  return `${prefix}_${value}`;
}

function normalizeStep(step, index) {
  if (!step || typeof step !== 'object') throw new AgentContractError('invalid_plan', `steps[${index}] must be an object.`);
  const sideEffect = step.side_effect_level || 'read';
  if (!['read', 'write'].includes(sideEffect)) throw new AgentContractError('invalid_plan', `steps[${index}].side_effect_level is invalid.`);
  return {
    step_id: required(step.step_id || `step-${index + 1}`, `steps[${index}].step_id`),
    tool: required(step.tool, `steps[${index}].tool`),
    arguments: clone(step.arguments || {}),
    side_effect_level: sideEffect,
    status: 'QUEUED',
    attempts: 0,
    max_retries: boundedInteger(step.max_retries, `steps[${index}].max_retries`, 0, 3),
  };
}

function normalizeLimits(limits = {}) {
  return {
    maxSteps: boundedInteger(limits.maxSteps, 'limits.maxSteps', DEFAULT_LIMITS.maxSteps, 100),
    maxIterations: boundedInteger(limits.maxIterations, 'limits.maxIterations', DEFAULT_LIMITS.maxIterations, 100),
    timeoutMs: boundedInteger(limits.timeoutMs, 'limits.timeoutMs', DEFAULT_LIMITS.timeoutMs, 300_000),
    retryLimit: boundedInteger(limits.retryLimit, 'limits.retryLimit', DEFAULT_LIMITS.retryLimit, 3),
  };
}

function createAgentPlan({ ownerId, sessionId = ownerId, steps, approvalRequired = true, idempotencyKey, limits, now = new Date(), idFactory } = {}) {
  const normalizedLimits = normalizeLimits(limits);
  if (!Array.isArray(steps)) throw new AgentContractError('invalid_plan', 'steps must be an array.');
  const normalizedSteps = steps.slice(0, normalizedLimits.maxSteps).map(normalizeStep);
  if (!normalizedSteps.length) throw new AgentContractError('invalid_plan', 'At least one step is required.');
  if (steps.length > normalizedLimits.maxSteps) throw new AgentContractError('limit_exceeded', 'Plan contains too many steps.');
  const timestamp = new Date(now).toISOString();
  const approvalToken = crypto.randomBytes(24).toString('hex');
  return {
    schema_version: AGENT_PLAN_SCHEMA_VERSION,
    plan_id: makeId('plan', idFactory),
    owner_id: required(ownerId, 'owner_id'),
    session_id: required(sessionId, 'session_id'),
    idempotency_key: required(idempotencyKey, 'idempotency_key'),
    approval_required: Boolean(approvalRequired),
    approval_token: approvalToken,
    approval_token_hash: tokenHash(approvalToken),
    approval_granted_at: null,
    status: 'PLANNED',
    iterations: 0,
    steps: normalizedSteps,
    limits: normalizedLimits,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function auditEntry(plan, event, details = {}, now = new Date()) {
  return {
    schema_version: AGENT_AUDIT_SCHEMA_VERSION,
    audit_id: makeId('audit'),
    plan_id: plan.plan_id,
    owner_id: plan.owner_id,
    session_id: plan.session_id,
    event,
    details: clone(details),
    at: new Date(now).toISOString(),
  };
}

function withTimeout(task, timeoutMs, onTimeout) {
  let timer;
  return Promise.race([
    Promise.resolve().then(task),
    new Promise((_, reject) => {
      timer = setTimeout(() => { onTimeout?.(); reject(new AgentContractError('timeout', 'Agent step timed out.', { timeout_ms: timeoutMs })); }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

class AgentOrchestrator {
  constructor({ executeTool, toolRegistry = {}, now = () => new Date(), idFactory } = {}) {
    if (typeof executeTool !== 'function') throw new AgentContractError('invalid_executor', 'executeTool must be a function.');
    this.executeTool = executeTool;
    this.toolRegistry = new Map(Object.entries(toolRegistry).map(([name, definition]) => {
      if (!definition || typeof definition !== 'object' || !['read', 'write'].includes(definition.side_effect_level || 'read')) throw new AgentContractError('invalid_tool_registry', `Invalid registry entry for ${name}.`);
      return [name, { ...definition, side_effect_level: definition.side_effect_level || 'read' }];
    }));
    this.now = now;
    this.idFactory = idFactory;
    this.plans = new Map();
    this.audit = [];
    this.controllers = new Map();
  }

  createPlan(input) {
    const plan = createAgentPlan({ ...input, now: this.now(), idFactory: this.idFactory });
    const key = `${plan.owner_id}:${plan.session_id}:${plan.idempotency_key}`;
    const planFingerprint = fingerprint({ steps: plan.steps.map(step => ({ step_id: step.step_id, tool: step.tool, arguments: step.arguments, side_effect_level: step.side_effect_level, max_retries: step.max_retries })), limits: plan.limits, approval_required: plan.approval_required });
    if (this.plans.has(key)) {
      const existing = this.plans.get(key);
      if (existing.fingerprint !== planFingerprint) throw new AgentContractError('idempotency_conflict', 'Idempotency key was reused with different plan input.');
      return clone(existing);
    }
    plan.fingerprint = planFingerprint;
    this.plans.set(key, clone(plan));
    this.audit.push(auditEntry(plan, 'plan_created'));
    return clone(plan);
  }

  getPlan({ ownerId, sessionId = ownerId, idempotencyKey }) {
    const key = `${required(ownerId, 'owner_id')}:${required(sessionId, 'session_id')}:${required(idempotencyKey, 'idempotency_key')}`;
    return clone(this.plans.get(key) || null);
  }

  approve({ ownerId, sessionId = ownerId, idempotencyKey, approvalToken }) {
    const plan = this.#find(ownerId, sessionId, idempotencyKey);
    if (plan.status !== 'PLANNED' && plan.status !== 'PAUSED_APPROVAL') throw new AgentContractError('invalid_state', `Cannot approve plan in ${plan.status}.`);
    if (!plan.approval_token_hash || tokenHash(approvalToken) !== plan.approval_token_hash) throw new AgentContractError('approval_invalid', 'A valid approval token is required.');
    plan.status = 'APPROVED';
    plan.approval_granted_at = this.now().toISOString();
    plan.updated_at = this.now().toISOString();
    this.audit.push(auditEntry(plan, 'plan_approved'));
    return clone(plan);
  }

  restore({ plan, audit = [] } = {}) {
    if (!plan || plan.schema_version !== AGENT_PLAN_SCHEMA_VERSION || typeof plan.fingerprint !== 'string' || typeof plan.approval_token_hash !== 'string') throw new AgentContractError('invalid_plan', 'Persisted agent plan is malformed.');
    const expected = fingerprint({ steps: plan.steps?.map(step => ({ step_id: step.step_id, tool: step.tool, arguments: step.arguments, side_effect_level: step.side_effect_level, max_retries: step.max_retries })), limits: plan.limits, approval_required: plan.approval_required });
    if (expected !== plan.fingerprint) throw new AgentContractError('integrity_error', 'Persisted agent plan fingerprint does not match.');
    const key = `${required(plan.owner_id, 'owner_id')}:${required(plan.session_id, 'session_id')}:${required(plan.idempotency_key, 'idempotency_key')}`;
    this.plans.set(key, clone(plan));
    this.audit.push(...(Array.isArray(audit) ? audit.filter(entry => entry?.plan_id === plan.plan_id).map(clone) : []));
    return clone(plan);
  }

  getAudit({ ownerId, sessionId = ownerId, idempotencyKey }) {
    const plan = this.#find(ownerId, sessionId, idempotencyKey);
    return this.#auditFor(plan);
  }

  cancel({ ownerId, sessionId = ownerId, idempotencyKey, reason = 'cancelled_by_owner' }) {
    const plan = this.#find(ownerId, sessionId, idempotencyKey);
    if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(plan.status)) return clone(plan);
    plan.status = 'CANCELLED';
    this.controllers.get(plan.plan_id)?.abort();
    this.controllers.delete(plan.plan_id);
    plan.updated_at = this.now().toISOString();
    this.audit.push(auditEntry(plan, 'plan_cancelled', { reason: String(reason).slice(0, 200) }));
    return clone(plan);
  }

  async run({ ownerId, sessionId = ownerId, idempotencyKey }) {
    const plan = this.#find(ownerId, sessionId, idempotencyKey);
    if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(plan.status)) return { plan: clone(plan), audit: this.#auditFor(plan) };
    // Resolve every queued tool before deciding whether approval is needed. An
    // unknown tool is a visible plan failure, never an uncaught exception from
    // the IPC boundary or an implicit permission grant.
    let pendingWrite = false;
    for (const step of plan.steps) {
      if (!['QUEUED', 'RETRYABLE'].includes(step.status)) continue;
      let definition;
      try { definition = this.#toolDefinition(step.tool); }
      catch (error) { return this.#fail(plan, error.code || 'unauthorized_tool', error.message, step.step_id); }
      pendingWrite ||= definition.side_effect_level === 'write';
    }
    if ((plan.approval_required || pendingWrite) && plan.status !== 'APPROVED') {
      plan.status = 'PAUSED_APPROVAL';
      this.audit.push(auditEntry(plan, 'approval_required'));
      return { plan: clone(plan), audit: this.#auditFor(plan) };
    }
    plan.status = 'RUNNING';
    const controller = new AbortController();
    this.controllers.set(plan.plan_id, controller);
    while (plan.steps.some(step => step.status === 'QUEUED' || step.status === 'RETRYABLE')) {
      if (plan.iterations >= plan.limits.maxIterations) return this.#fail(plan, 'iteration_limit', 'Agent iteration limit reached.');
      if (plan.status === 'CANCELLED') return { plan: clone(plan), audit: this.#auditFor(plan) };
      const step = plan.steps.find(item => item.status === 'QUEUED' || item.status === 'RETRYABLE');
      const definition = this.#toolDefinition(step.tool);
      if (definition.side_effect_level === 'write' && !plan.approval_granted_at) return this.#fail(plan, 'approval_required', 'Write tool requires approval.', step.step_id);
      if (typeof definition.validate_arguments === 'function' && !definition.validate_arguments(clone(step.arguments))) return this.#fail(plan, 'invalid_tool_arguments', 'Tool arguments failed schema validation.', step.step_id);
      step.status = 'RUNNING';
      step.attempts += 1;
      plan.iterations += 1;
      this.audit.push(auditEntry(plan, 'step_started', { step_id: step.step_id, tool: step.tool, attempt: step.attempts }));
      const attemptController = new AbortController();
      const forwardAbort = () => attemptController.abort();
      controller.signal.addEventListener('abort', forwardAbort, { once: true });
      try {
        const result = await withTimeout(() => this.executeTool({ tool: step.tool, arguments: clone(step.arguments), plan: clone(plan), step: clone(step), signal: attemptController.signal }), plan.limits.timeoutMs, () => attemptController.abort());
        if (controller.signal.aborted || plan.status === 'CANCELLED') return { plan: clone(plan), audit: this.#auditFor(plan) };
        if (!result || typeof result !== 'object' || result.status === 'failed') throw new AgentContractError('tool_error', 'Tool returned a failed or malformed result.');
        if (typeof definition.validate_output === 'function' && !definition.validate_output(result)) throw new AgentContractError('malformed_tool_result', 'Tool result failed schema validation.');
        step.status = 'SUCCEEDED';
        step.output = clone(result);
        this.audit.push(auditEntry(plan, 'step_succeeded', { step_id: step.step_id, tool: step.tool }));
      } catch (error) {
        if (controller.signal.aborted || plan.status === 'CANCELLED') return { plan: clone(plan), audit: this.#auditFor(plan) };
        const normalized = { code: error.code || 'tool_error', message: String(error.message || error).slice(0, 300) };
        if (step.attempts <= Math.min(step.max_retries, plan.limits.retryLimit)) {
          step.status = 'RETRYABLE';
          this.audit.push(auditEntry(plan, 'step_retryable_failure', { step_id: step.step_id, error: normalized }));
        } else {
          step.status = 'FAILED';
          return this.#fail(plan, normalized.code, normalized.message, step.step_id);
        }
      } finally {
        controller.signal.removeEventListener('abort', forwardAbort);
      }
      plan.updated_at = this.now().toISOString();
    }
    plan.status = 'SUCCEEDED';
    this.controllers.delete(plan.plan_id);
    this.audit.push(auditEntry(plan, 'plan_succeeded'));
    return { plan: clone(plan), audit: this.#auditFor(plan) };
  }

  #find(ownerId, sessionId, key) {
    const owner = required(ownerId, 'owner_id');
    const session = required(sessionId, 'session_id');
    const idempotency = required(key, 'idempotency_key');
    const plan = this.plans.get(`${owner}:${session}:${idempotency}`);
    if (!plan) throw new AgentContractError('not_found', 'Agent plan was not found.');
    return plan;
  }

  #toolDefinition(name) {
    const definition = this.toolRegistry.get(name);
    if (!definition) throw new AgentContractError('unauthorized_tool', `Tool is not registered: ${name}.`);
    return definition;
  }

  #fail(plan, code, message, stepId = null) {
    this.controllers.get(plan.plan_id)?.abort();
    this.controllers.delete(plan.plan_id);
    plan.status = 'FAILED';
    plan.failure = { code, message, step_id: stepId };
    plan.updated_at = this.now().toISOString();
    this.audit.push(auditEntry(plan, 'plan_failed', plan.failure));
    return { plan: clone(plan), audit: this.#auditFor(plan) };
  }

  #auditFor(plan) {
    return this.audit.filter(entry => entry.plan_id === plan.plan_id).map(clone);
  }
}

module.exports = { AGENT_AUDIT_SCHEMA_VERSION, AGENT_PLAN_SCHEMA_VERSION, AgentContractError, AgentOrchestrator, createAgentPlan };
