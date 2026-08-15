const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { AgentContractError, AgentOrchestrator } = require('./agent-orchestrator');

const AGENT_STORAGE_SCHEMA_VERSION = 'solat.agent-storage.v1';

function required(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized === '.' || normalized === '..' || /[\\/]/u.test(normalized)) throw new AgentContractError('invalid_request', `${field} is invalid.`);
  return normalized;
}

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

function redact(value, key = '') {
  if (typeof value === 'string') {
    return value.replace(/(sk-[A-Za-z0-9_-]{12,})/gu, '[REDACTED_SECRET]').replace(/(Bearer\s+)[A-Za-z0-9._~-]{12,}/giu, '$1[REDACTED_SECRET]');
  }
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (!value || typeof value !== 'object') return value;
  return Object.entries(value).reduce((out, [entryKey, entryValue]) => {
    out[entryKey] = /(?:api[_-]?key|secret|password|approval_token$)/iu.test(entryKey) ? '[REDACTED_SECRET]' : redact(entryValue, entryKey);
    return out;
  }, {});
}

class AgentService {
  constructor({ rootDir, executeTool, toolRegistry = {}, fsImpl = fs.promises, now = () => new Date(), idFactory } = {}) {
    if (!rootDir || typeof rootDir !== 'string') throw new AgentContractError('invalid_request', 'Agent storage root is required.');
    this.rootDir = path.resolve(rootDir);
    this.fs = fsImpl;
    this.idFactory = idFactory;
    this.orchestrator = new AgentOrchestrator({ executeTool, toolRegistry, now, idFactory });
  }

  async createPlan(input) {
    const existing = await this.#load(input);
    if (existing) return { plan: this.preview(existing), approval_token: undefined };
    const plan = this.orchestrator.createPlan(input);
    await this.#persist(plan);
    return { plan: this.preview(plan), approval_token: plan.approval_token };
  }

  async inspect({ ownerId, sessionId = ownerId, idempotencyKey }) {
    const loaded = await this.#load({ ownerId, sessionId, idempotencyKey });
    const plan = loaded || this.orchestrator.getPlan({ ownerId, sessionId, idempotencyKey });
    if (!plan) return null;
    return this.preview(plan);
  }

  preview(plan) {
    const safe = clone(plan);
    if (safe) delete safe.approval_token;
    return safe;
  }

  async approve(input) {
    await this.#ensureLoaded(input);
    const plan = this.orchestrator.approve(input);
    await this.#persist(plan);
    return this.preview(plan);
  }

  async cancel(input) {
    await this.#ensureLoaded(input);
    const plan = this.orchestrator.cancel(input);
    await this.#persist(plan);
    return this.preview(plan);
  }

  async run(input) {
    await this.#ensureLoaded(input);
    const result = await this.orchestrator.run(input);
    await this.#persist(result.plan, result.audit);
    return { plan: this.preview(result.plan), audit: result.audit };
  }

  async #ensureLoaded(input) {
    const current = this.orchestrator.getPlan(input);
    if (current) return current;
    const loaded = await this.#load(input);
    if (!loaded) throw new AgentContractError('not_found', 'Agent plan was not found.');
    return loaded;
  }

  #fileFor({ ownerId, sessionId = ownerId, idempotencyKey }) {
    const owner = required(ownerId, 'owner_id');
    const session = required(sessionId, 'session_id');
    const idempotency = required(idempotencyKey, 'idempotency_key');
    const digest = crypto.createHash('sha256').update(`${owner}:${session}:${idempotency}`, 'utf8').digest('hex');
    return { owner, session, idempotency, file: path.join(this.rootDir, `${digest}.json`) };
  }

  async #load(input) {
    const { file } = this.#fileFor(input);
    try {
      const record = JSON.parse(await this.fs.readFile(file, 'utf8'));
      if (record.schema_version !== AGENT_STORAGE_SCHEMA_VERSION || !record.plan) throw new AgentContractError('persistence_invalid', 'Persisted agent plan is malformed.');
      if (record.plan.owner_id !== String(input.ownerId).trim() || record.plan.session_id !== String(input.sessionId || input.ownerId).trim()) throw new AgentContractError('ownership_mismatch', 'Persisted agent plan ownership does not match.');
      return this.orchestrator.restore({ plan: record.plan, audit: record.audit });
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async #persist(plan, audit) {
    const { file } = this.#fileFor({ ownerId: plan.owner_id, sessionId: plan.session_id, idempotencyKey: plan.idempotency_key });
    await this.fs.mkdir(this.rootDir, { recursive: true });
    const record = redact({ schema_version: AGENT_STORAGE_SCHEMA_VERSION, plan, audit: audit || this.orchestrator.getAudit({ ownerId: plan.owner_id, sessionId: plan.session_id, idempotencyKey: plan.idempotency_key }) });
    const temp = `${file}.${this.idFactory ? this.idFactory() : crypto.randomUUID()}.tmp`;
    try {
      await this.fs.writeFile(temp, JSON.stringify(record, null, 2), { flag: 'wx', encoding: 'utf8' });
      await this.fs.rename(temp, file);
    } catch (error) {
      await this.fs.rm(temp, { force: true }).catch(() => {});
      throw Object.assign(new AgentContractError('persistence_write_failed', 'Agent plan persistence failed.'), { cause: error });
    }
  }
}

module.exports = { AGENT_STORAGE_SCHEMA_VERSION, AgentService, redact };
