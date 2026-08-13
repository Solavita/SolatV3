const crypto = require('node:crypto');
const {
  ContractError,
  createJob,
  createProject,
  deepFreeze,
  transitionJob,
  transitionProject,
} = require('./contracts');

const RETRYABLE_PROVIDER_CODES = new Set(['timeout', 'network_error', 'provider_error', 'rate_limit', 'provider_unavailable']);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class SessionWorkspace {
  constructor({ now = () => new Date(), idFactory = crypto.randomUUID, retryBudget = 0 } = {}) {
    this.now = now;
    this.idFactory = idFactory;
    this.retryBudget = retryBudget;
    this.sessions = new Map();
  }

  _session(sessionId) {
    const id = String(sessionId || '').trim();
    if (!id) throw new ContractError('invalid_request', 'A session id is required.');
    let state = this.sessions.get(id);
    if (!state) {
      const project = createProject({
        ownerId: id,
        sessionId: id,
        title: 'Conversation project',
        purpose: 'Conversation workspace',
        audience: 'owner',
        now: this.now(),
        idFactory: this.idFactory,
      });
      state = { project, jobs: new Map(), idempotency: new Map(), artifacts: new Map() };
      this.sessions.set(id, state);
    }
    return { id, state };
  }

  beginJob({ sessionId, requestId, kind = 'conversation_response' } = {}) {
    const { id, state } = this._session(sessionId);
    const normalizedRequestId = String(requestId || '').trim();
    if (!normalizedRequestId) throw new ContractError('invalid_request', 'A request id is required.');
    const key = `${id}:${normalizedRequestId}`;
    const existingJobId = state.idempotency.get(key);
    if (existingJobId) {
      const existing = state.jobs.get(existingJobId);
      if (existing?.status === 'SUCCEEDED') return { replay: true, job: existing, response: clone(existing.response) };
      throw new ContractError('duplicate_request', 'This request is already recorded and cannot be started again.', { job_id: existingJobId, status: existing?.status || 'UNKNOWN' });
    }
    const queued = createJob({
      projectId: state.project.project_id,
      ownerId: id,
      kind,
      idempotencyKey: key,
      retryBudget: this.retryBudget,
      now: this.now(),
      idFactory: this.idFactory,
    });
    const running = transitionJob(queued, 'RUNNING', { now: this.now() });
    state.jobs.set(running.job_id, running);
    state.idempotency.set(key, running.job_id);
    return { replay: false, job: running };
  }

  succeedJob({ sessionId, requestId, response } = {}) {
    const { id, state } = this._session(sessionId);
    const key = `${id}:${String(requestId || '').trim()}`;
    const jobId = state.idempotency.get(key);
    const current = jobId ? state.jobs.get(jobId) : null;
    if (!current) throw new ContractError('invalid_request', 'The request job was not found.');
    const completed = transitionJob(current, 'SUCCEEDED', {
      now: this.now(),
      outputs: [{ kind: 'assistant_text', ref: response?.id || jobId }],
    });
    const stored = deepFreeze({ ...completed, response: clone(response) });
    state.jobs.set(jobId, stored);
    return stored;
  }

  transitionProject({ sessionId, nextStatus } = {}) {
    const { state } = this._session(sessionId);
    const next = transitionProject(state.project, nextStatus, { now: this.now() });
    state.project = next;
    return next;
  }

  linkProject({ sessionId, briefId, emotionProfileId, narrativePlanId, designSystemId, documentId, assetIds, jobId } = {}) {
    const { state } = this._session(sessionId);
    const current = state.project;
    const next = {
      ...current,
      current_revision: current.current_revision + 1,
      brief_id: briefId ?? current.brief_id,
      emotion_profile_id: emotionProfileId ?? current.emotion_profile_id,
      narrative_plan_id: narrativePlanId ?? current.narrative_plan_id,
      design_system_id: designSystemId ?? current.design_system_id,
      document_id: documentId ?? current.document_id,
      asset_ids: assetIds ? [...new Set([...current.asset_ids, ...assetIds])] : current.asset_ids,
      job_ids: jobId ? [...new Set([...current.job_ids, jobId])] : current.job_ids,
      updated_at: new Date(this.now()).toISOString(),
    };
    state.project = deepFreeze(next);
    return state.project;
  }

  failJob({ sessionId, requestId, error } = {}) {
    const { id, state } = this._session(sessionId);
    const key = `${id}:${String(requestId || '').trim()}`;
    const jobId = state.idempotency.get(key);
    const current = jobId ? state.jobs.get(jobId) : null;
    if (!current) throw new ContractError('invalid_request', 'The request job was not found.');
    const safeError = {
      code: typeof error?.code === 'string' ? error.code : 'provider_error',
      message: typeof error?.message === 'string' ? error.message : 'The request failed.',
      retryable: RETRYABLE_PROVIDER_CODES.has(error?.code),
    };
    const nextStatus = safeError.retryable ? 'FAILED_RETRYABLE' : 'FAILED_TERMINAL';
    const failed = transitionJob(current, nextStatus, { now: this.now(), error: safeError });
    state.jobs.set(jobId, failed);
    return failed;
  }

  getState(sessionId) {
    const { state } = this._session(sessionId);
    return deepFreeze({
      project: clone(state.project),
      jobs: [...state.jobs.values()].map(job => clone(job)),
    });
  }

  getProject(sessionId) {
    return this._session(sessionId).state.project;
  }

  storeArtifact({ sessionId, kind, artifactId, value } = {}) {
    const { id, state } = this._session(sessionId);
    const normalizedKind = String(kind || '').trim();
    const normalizedArtifactId = String(artifactId || '').trim();
    if (!normalizedKind || !normalizedArtifactId) throw new ContractError('invalid_request', 'Artifact kind and id are required.');
    const key = `${normalizedKind}:${normalizedArtifactId}`;
    const stored = deepFreeze(clone(value));
    state.artifacts.set(key, stored);
    return { sessionId: id, kind: normalizedKind, artifactId: normalizedArtifactId, value: clone(stored) };
  }

  getArtifact({ sessionId, kind, artifactId } = {}) {
    const { state } = this._session(sessionId);
    const normalizedKind = String(kind || '').trim();
    const normalizedArtifactId = String(artifactId || '').trim();
    if (!normalizedKind || !normalizedArtifactId) throw new ContractError('invalid_request', 'Artifact kind and id are required.');
    const value = state.artifacts.get(`${normalizedKind}:${normalizedArtifactId}`);
    if (value === undefined) throw new ContractError('artifact_not_found', 'The requested creative result is not available in this session.');
    return clone(value);
  }
}

module.exports = { RETRYABLE_PROVIDER_CODES, SessionWorkspace };
