const crypto = require('node:crypto');
const { AgentContractError } = require('./agent-orchestrator');
const { assertCurrentTarget, createTargetAttestation } = require('./computer-target-attestation');
const { completeTarget } = require('./computer-task-loop');
const { isSensitiveWindow } = require('./computer-use-adapter');

const AGENT_CHAT_RESULT_SCHEMA_VERSION = 'solat.agent-chat-result.v1';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {});
}

function toolCallKey({ requestId, call }) {
  return crypto.createHash('sha256').update(JSON.stringify(stable({ requestId, name: call?.name, arguments: call?.arguments })), 'utf8').digest('hex');
}

class AgentChatBridge {
  constructor({ agentService, toolDefinitions = [], targetResolver = null } = {}) {
    if (!agentService || typeof agentService.createPlan !== 'function') throw new AgentContractError('invalid_agent_bridge', 'Agent service is required.');
    if (!Array.isArray(toolDefinitions)) throw new AgentContractError('invalid_agent_bridge', 'Agent tool definitions must be an array.');
    this.agentService = agentService;
    this.toolDefinitions = toolDefinitions;
    this.toolNames = new Set(toolDefinitions.map(definition => definition?.function?.name).filter(Boolean));
    this.taskAuthorizations = new Map();
    this.targetResolver = typeof targetResolver === 'function' ? targetResolver : null;
  }

  definitions() { return this.toolDefinitions.map(definition => JSON.parse(JSON.stringify(definition))); }

  owns(name) { return this.toolNames.has(String(name || '')); }

  issueTaskAuthorization({ sessionId, taskId, instructionRevision, scope = {}, ttlMs = 10 * 60_000, maxWrites = 24 }) {
    const session = String(sessionId || '').trim();
    const task = String(taskId || '').trim();
    const revision = Number(instructionRevision);
    if (!session || !task || !Number.isSafeInteger(revision) || revision < 1) throw new AgentContractError('invalid_request', 'A task-scoped authorization requires a session, task, and instruction revision.');
    const id = `task-grant-${crypto.randomUUID()}`;
    const record = {
      id, session_id: session, task_id: task, instruction_revision: revision,
      active: true, expires_at: Date.now() + Math.min(Math.max(Number(ttlMs) || 0, 10_000), 10 * 60_000),
      writes_remaining: Math.min(Math.max(Number(maxWrites) || 0, 1), 32), inflight: new Set(),
      allowed_tools: new Set(Array.isArray(scope.allowed_tools) ? scope.allowed_tools.map(String) : []),
      allowed_apps: new Set(Array.isArray(scope.allowed_apps) ? scope.allowed_apps.map(value => String(value).toLowerCase()) : []),
      allowed_sites: new Set(Array.isArray(scope.allowed_sites) ? scope.allowed_sites.map(value => String(value).toLowerCase()) : []),
      allowed_hwnds: new Set(Array.isArray(scope.allowed_hwnds) ? scope.allowed_hwnds.map(Number).filter(Number.isSafeInteger) : []),
      target_attestations: new Map(),
      allowed_processes: new Set(),
    };
    for (const target of Array.isArray(scope.allowed_targets) ? scope.allowed_targets : []) {
      const attestation = createTargetAttestation({ revision, target });
      record.allowed_hwnds.add(attestation.target.hwnd);
      record.target_attestations.set(attestation.target.hwnd, attestation);
      if (String(attestation.target.process_name || '').trim()) record.allowed_processes.add(String(attestation.target.process_name).toLowerCase());
    }
    this.taskAuthorizations.set(id, record);
    return Object.freeze({ id, task_id: task, instruction_revision: revision });
  }

  extendTaskAuthorization({ authorization, sessionId, hwnds = [], targets = [] } = {}) {
    const grant = this.#authorizationStillActive(authorization, sessionId);
    for (const hwnd of hwnds) if (Number.isSafeInteger(Number(hwnd)) && Number(hwnd) > 0) grant.allowed_hwnds.add(Number(hwnd));
    for (const target of targets) {
      const attestation = createTargetAttestation({ revision: grant.instruction_revision, target });
      grant.allowed_hwnds.add(attestation.target.hwnd);
      grant.target_attestations.set(attestation.target.hwnd, attestation);
      if (String(attestation.target.process_name || '').trim()) grant.allowed_processes.add(String(attestation.target.process_name).toLowerCase());
    }
    return true;
  }

  refreshTaskAuthorizationTargets({ authorization, sessionId, targets = [] } = {}) {
    const grant = this.#authorizationStillActive(authorization, sessionId);
    // Discovery is evidence, not open-ended authority: a listed window joins
    // the existing one-approval grant only when its process already belongs
    // to a verified approved-action target, and sensitive windows never join.
    // This keeps one owner approval per command while HWND churn inside the
    // approved app stays bounded; cross-process discovery still requires a
    // fresh approval.
    for (const window of Array.isArray(targets) ? targets : []) {
      const target = completeTarget(window);
      if (!target || grant.target_attestations.has(target.hwnd)) continue;
      if (!grant.allowed_processes.has(target.process_name.toLowerCase())) continue;
      if (isSensitiveWindow({ process_name: target.process_name, title: target.window_title })) continue;
      const attestation = createTargetAttestation({ revision: grant.instruction_revision, target });
      grant.allowed_hwnds.add(target.hwnd);
      grant.target_attestations.set(target.hwnd, attestation);
    }
    return true;
  }

  rotateTaskAuthorization({ authorization, sessionId, instructionRevision } = {}) {
    const grant = this.#authorizationStillActive(authorization, sessionId);
    const revision = Number(instructionRevision);
    if (!Number.isSafeInteger(revision) || revision <= grant.instruction_revision) throw new AgentContractError('invalid_request', 'The task authorization revision must move forward.');
    if (grant.writes_remaining < 1 || grant.expires_at <= Date.now()) throw new AgentContractError('task_authorization_exhausted', 'An exhausted or expired task authorization cannot be renewed by steering.');
    grant.instruction_revision = revision;
    const targets = [...grant.target_attestations.values()].map(item => item.target);
    grant.target_attestations.clear();
    for (const target of targets) grant.target_attestations.set(target.hwnd, createTargetAttestation({ revision, target }));
    return Object.freeze({ id: grant.id, task_id: grant.task_id, instruction_revision: revision });
  }

  async revokeTaskAuthorization({ authorization, sessionId }) {
    const id = String(authorization?.id || '');
    const grant = this.taskAuthorizations.get(id);
    if (!grant || grant.session_id !== String(sessionId || '').trim()) return false;
    grant.active = false;
    this.taskAuthorizations.delete(id);
    const cancellations = await Promise.allSettled([...grant.inflight].map(idempotencyKey => this.agentService.cancel({ ownerId: grant.session_id, sessionId: grant.session_id, idempotencyKey })));
    if (cancellations.some(result => result.status === 'rejected')) {
      throw new AgentContractError('cancellation_unverified', 'One or more in-flight computer actions could not be confirmed cancelled.');
    }
    return true;
  }

  #authorization(authorization, sessionId) {
    const grant = this.taskAuthorizations.get(String(authorization?.id || ''));
    if (!grant || !grant.active || grant.session_id !== String(sessionId || '').trim()
      || grant.task_id !== String(authorization?.task_id || '')
      || grant.instruction_revision !== Number(authorization?.instruction_revision)
      || grant.expires_at <= Date.now()) {
      throw new AgentContractError('task_authorization_invalid', 'The bounded computer-task authorization is missing, expired, or stale.');
    }
    if (grant.writes_remaining < 1) throw new AgentContractError('task_authorization_exhausted', 'The bounded computer-task authorization reached its action cap.');
    return grant;
  }

  #authorizationStillActive(authorization, sessionId) {
    const grant = this.taskAuthorizations.get(String(authorization?.id || ''));
    if (!grant || !grant.active || grant.session_id !== String(sessionId || '').trim()
      || grant.task_id !== String(authorization?.task_id || '')
      || grant.instruction_revision !== Number(authorization?.instruction_revision)
      || grant.expires_at <= Date.now()) {
      throw new AgentContractError('task_authorization_invalid', 'The bounded computer-task authorization was revoked while an action was being prepared.');
    }
    return grant;
  }

  #scopeAllows(grant, call) {
    const args = call?.arguments || {};
    if (!grant.allowed_tools.has(String(call?.name || ''))) return false;
    if (call.name === 'computer_launch_app') return grant.allowed_apps.has(String(args.app_id || '').toLowerCase());
    if (call.name === 'computer_open_website') return grant.allowed_sites.has(String(args.site || '').toLowerCase());
    if (call.name === 'computer_play_youtube_music') return grant.allowed_sites.has('youtube');
    if (Object.hasOwn(args, 'hwnd') && (!grant.allowed_hwnds.has(Number(args.hwnd)) || !grant.target_attestations.has(Number(args.hwnd)))) return false;
    const risky = /(?:password|passcode|credential|otp|2fa|delete|remove|purchase|buy|pay|checkout|send|submit|post|publish|upload|share|subscribe|bank|wallet|credit.?card|รหัส|โอน|จ่าย|ซื้อ|ลบ|ส่ง|เผยแพร่|อัปโหลด)/iu;
    return !risky.test(JSON.stringify({ selector: args.selector, value: args.value, verify: args.verify_selector }));
  }

  async #assertAuthorizedTarget(grant, call) {
    if (!Object.hasOwn(call?.arguments || {}, 'hwnd')) return;
    const hwnd = Number(call.arguments.hwnd);
    const attestation = grant.target_attestations.get(hwnd);
    if (!attestation || !this.targetResolver) throw new AgentContractError('target_attestation_missing', 'The current window identity is not bound to this task approval.');
    const current = await this.targetResolver({ hwnd });
    assertCurrentTarget({ attestation, revision: grant.instruction_revision, currentTarget: current, sensitive: isSensitiveWindow(current) });
  }

  // A newer computer task can supersede an unapproved action only through
  // this owner/session-scoped service boundary.
  async cancelAction({ sessionId, idempotencyKey }) {
    if (!String(sessionId || '').trim() || !String(idempotencyKey || '').trim()) {
      throw new AgentContractError('invalid_request', 'A session and pending action are required.');
    }
    return this.agentService.cancel({ ownerId: sessionId, sessionId, idempotencyKey });
  }

  async execute({ sessionId, requestId, call, taskAuthorization = null }) {
    if (!this.owns(call?.name)) throw new AgentContractError('unauthorized_tool', 'Agent tool is not registered.');
    const idempotencyKey = `chat-${toolCallKey({ requestId, call })}`;
    // Browser media startup includes navigation, UIA discovery, one invoke,
    // and a multi-sample playback stability check. Give only that bounded
    // workflow enough time; ordinary agent actions retain the tighter cap.
    const timeoutMs = call.name === 'computer_play_youtube_music' ? 90_000 : 30_000;
    const created = await this.agentService.createPlan({
      ownerId: sessionId,
      sessionId,
      idempotencyKey,
      approvalRequired: false,
      steps: [{ step_id: 'chat-tool-1', tool: call.name, arguments: call.arguments || {}, side_effect_level: 'read' }],
      limits: { maxSteps: 1, maxIterations: 2, timeoutMs, retryLimit: 0 },
    });
    let run = await this.agentService.run({ ownerId: sessionId, sessionId, idempotencyKey });
    if (run.plan.status === 'PAUSED_APPROVAL') {
      let grant = null;
      if (taskAuthorization) {
        try { grant = this.#authorization(taskAuthorization, sessionId); }
        catch { grant = null; }
      }
      if (grant && this.#scopeAllows(grant, call) && created.approval_token) {
        grant.writes_remaining -= 1;
        grant.inflight.add(idempotencyKey);
        try {
          this.#authorizationStillActive(taskAuthorization, sessionId);
          await this.#assertAuthorizedTarget(grant, call);
          this.#authorizationStillActive(taskAuthorization, sessionId);
          await this.agentService.approve({ ownerId: sessionId, sessionId, idempotencyKey, approvalToken: created.approval_token });
          this.#authorizationStillActive(taskAuthorization, sessionId);
          run = await this.agentService.run({ ownerId: sessionId, sessionId, idempotencyKey });
          this.#authorizationStillActive(taskAuthorization, sessionId);
        } catch (error) {
          await this.agentService.cancel({ ownerId: sessionId, sessionId, idempotencyKey }).catch(() => {});
          throw error;
        } finally {
          grant.inflight.delete(idempotencyKey);
        }
        if (run.plan.status === 'SUCCEEDED') {
          const output = run.plan.steps?.[0]?.output;
          return { model_result: output || { schema_version: AGENT_CHAT_RESULT_SCHEMA_VERSION, status: 'failed', error: { code: 'missing_output', message: 'The agent tool returned no output.' } }, action: null, approval_reused: true };
        }
        return {
          model_result: { schema_version: AGENT_CHAT_RESULT_SCHEMA_VERSION, status: 'failed', tool: call.name, error: run.plan.failure || { code: 'agent_failed', message: 'The task-authorized action did not complete.' } },
          action: null,
        };
      }
      if (grant && this.#scopeAllows(grant, call) && !created.approval_token) {
        return {
          model_result: { schema_version: AGENT_CHAT_RESULT_SCHEMA_VERSION, status: 'failed', tool: call.name, error: { code: 'approval_token_unavailable', message: 'The durable action could not be auto-approved safely.' } },
          action: null,
        };
      }
      return {
        model_result: {
          schema_version: AGENT_CHAT_RESULT_SCHEMA_VERSION,
          status: 'confirmation_required',
          plan_id: run.plan.plan_id,
          tool: call.name,
          message: 'This action changes files or the computer and requires owner approval in SOLAT before it can run.',
        },
        action: {
          schema_version: AGENT_CHAT_RESULT_SCHEMA_VERSION,
          status: 'confirmation_required',
          idempotency_key: idempotencyKey,
          plan_id: run.plan.plan_id,
          tool: call.name,
          arguments: JSON.parse(JSON.stringify(call.arguments || {})),
          approval_token: created.approval_token,
        },
      };
    }
    if (run.plan.status !== 'SUCCEEDED') {
      return {
        model_result: {
          schema_version: AGENT_CHAT_RESULT_SCHEMA_VERSION,
          status: 'failed',
          tool: call.name,
          error: run.plan.failure || { code: 'agent_failed', message: 'The agent tool did not complete.' },
        },
        action: null,
      };
    }
    const output = run.plan.steps?.[0]?.output;
    return { model_result: output || { schema_version: AGENT_CHAT_RESULT_SCHEMA_VERSION, status: 'failed', error: { code: 'missing_output', message: 'The agent tool returned no output.' } }, action: null };
  }
}

module.exports = { AGENT_CHAT_RESULT_SCHEMA_VERSION, AgentChatBridge, toolCallKey };
