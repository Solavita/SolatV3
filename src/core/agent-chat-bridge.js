const crypto = require('node:crypto');
const { AgentContractError } = require('./agent-orchestrator');

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
  constructor({ agentService, toolDefinitions = [] } = {}) {
    if (!agentService || typeof agentService.createPlan !== 'function') throw new AgentContractError('invalid_agent_bridge', 'Agent service is required.');
    if (!Array.isArray(toolDefinitions)) throw new AgentContractError('invalid_agent_bridge', 'Agent tool definitions must be an array.');
    this.agentService = agentService;
    this.toolDefinitions = toolDefinitions;
    this.toolNames = new Set(toolDefinitions.map(definition => definition?.function?.name).filter(Boolean));
  }

  definitions() { return this.toolDefinitions.map(definition => JSON.parse(JSON.stringify(definition))); }

  owns(name) { return this.toolNames.has(String(name || '')); }

  async execute({ sessionId, requestId, call }) {
    if (!this.owns(call?.name)) throw new AgentContractError('unauthorized_tool', 'Agent tool is not registered.');
    const idempotencyKey = `chat-${toolCallKey({ requestId, call })}`;
    const created = await this.agentService.createPlan({
      ownerId: sessionId,
      sessionId,
      idempotencyKey,
      approvalRequired: false,
      steps: [{ step_id: 'chat-tool-1', tool: call.name, arguments: call.arguments || {}, side_effect_level: 'read' }],
      limits: { maxSteps: 1, maxIterations: 2, timeoutMs: 30_000, retryLimit: 0 },
    });
    const run = await this.agentService.run({ ownerId: sessionId, sessionId, idempotencyKey });
    if (run.plan.status === 'PAUSED_APPROVAL') {
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
