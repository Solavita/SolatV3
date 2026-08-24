const crypto = require('node:crypto');
const { Agent, Runner, Usage, tool } = require('@openai/agents');
const { ProviderError, serializeToolOutcome } = require('./provider');

const AGENTS_RUNTIME_SCHEMA_VERSION = 'solat.openai-agents-runtime.v1';
const DEFAULT_MAX_TURNS = 4;

function textFromContent(content, role) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => {
    if (role === 'assistant' && part?.type === 'output_text') return String(part.text || '');
    if (role === 'assistant' && part?.type === 'refusal') return String(part.refusal || '');
    if (part?.type === 'input_text') return String(part.text || '');
    if (part?.type === 'audio' && typeof part.transcript === 'string') return part.transcript;
    return '';
  }).filter(Boolean).join('\n');
}

function flushToolCalls(messages, pending) {
  if (!pending.length) return;
  messages.push({
    role: 'assistant',
    content: '',
    tool_calls: pending.splice(0).map(call => ({
      id: call.callId,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    })),
  });
}

function providerMessagesFromRequest(request) {
  const messages = [];
  if (String(request?.systemInstructions || '').trim()) {
    messages.push({ role: 'system', content: String(request.systemInstructions).trim() });
  }
  const input = typeof request?.input === 'string'
    ? [{ role: 'user', content: request.input }]
    : Array.isArray(request?.input) ? request.input : [];
  const pendingToolCalls = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'function_call') {
      pendingToolCalls.push({
        callId: String(item.callId || item.id || crypto.randomUUID()),
        name: String(item.name || ''),
        arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {}),
      });
      continue;
    }
    flushToolCalls(messages, pendingToolCalls);
    if (item.type === 'function_call_result') {
      messages.push({
        role: 'tool',
        tool_call_id: String(item.callId || ''),
        name: String(item.name || ''),
        content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? null),
      });
      continue;
    }
    if (['system', 'user', 'assistant'].includes(item.role)) {
      messages.push({ role: item.role, content: textFromContent(item.content, item.role) });
      continue;
    }
    throw new ProviderError('unsupported_agent_item', `The SOLAT model adapter cannot serialize Agents SDK item type ${String(item.type || 'unknown')}.`);
  }
  flushToolCalls(messages, pendingToolCalls);
  return messages;
}

function providerToolsFromRequest(request) {
  const tools = [];
  for (const value of Array.isArray(request?.tools) ? request.tools : []) {
    if (value?.type !== 'function') {
      throw new ProviderError('unsupported_agent_tool', `SOLAT V1-V2 supports function tools through the Agents SDK; received ${String(value?.type || 'unknown')}.`);
    }
    tools.push({
      type: 'function',
      function: {
        name: value.name,
        description: value.description,
        parameters: value.parameters,
      },
    });
  }
  return tools;
}

function sdkUsage(value) {
  return new Usage({
    requests: 1,
    inputTokens: Number(value?.prompt_tokens ?? value?.input_tokens ?? 0) || 0,
    outputTokens: Number(value?.completion_tokens ?? value?.output_tokens ?? 0) || 0,
    totalTokens: Number(value?.total_tokens ?? 0) || 0,
  });
}

function assistantOutput(text, responseId) {
  const value = String(text || '');
  if (!value) return [];
  return [{
    id: `${responseId}-message`,
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: value }],
  }];
}

function functionCallOutput(calls) {
  return (Array.isArray(calls) ? calls : []).map(call => {
    const callId = String(call.id || crypto.randomUUID());
    return {
      id: callId,
      type: 'function_call',
      callId,
      name: String(call.name || ''),
      status: 'completed',
      arguments: JSON.stringify(call.arguments || {}),
    };
  });
}

function modelResponseFromProvider(result, responseId = crypto.randomUUID()) {
  return {
    usage: sdkUsage(result?.usage),
    output: [...assistantOutput(result?.content, responseId), ...functionCallOutput(result?.toolCalls)],
    responseId,
    providerData: {
      provider: result?.provider || null,
      model: result?.model || null,
      routing: result?.routing || null,
      timing: result?.timing || null,
    },
  };
}

class SolatAgentsModel {
  constructor(provider) {
    if (!provider || typeof provider.complete !== 'function') throw new ProviderError('invalid_config', 'An existing SOLAT model provider is required.');
    this.provider = provider;
  }

  async getResponse(request) {
    const messages = providerMessagesFromRequest(request);
    const tools = providerToolsFromRequest(request);
    const result = await this.provider.complete(messages, {
      ...(tools.length ? { tools, toolChoice: 'auto' } : {}),
      signal: request?.signal,
    });
    return modelResponseFromProvider(result);
  }

  async *getStreamedResponse(request) {
    const responseId = crypto.randomUUID();
    yield { type: 'response_started' };
    const messages = providerMessagesFromRequest(request);
    const tools = providerToolsFromRequest(request);
    if (tools.length) {
      const result = await this.provider.complete(messages, { tools, toolChoice: 'auto', signal: request?.signal });
      if (result?.content) yield { type: 'output_text_delta', itemId: `${responseId}-message`, delta: String(result.content) };
      yield { type: 'response_done', response: { ...modelResponseFromProvider(result, responseId), id: responseId } };
      return;
    }

    const queued = [];
    let wake = null;
    let settled = false;
    let failure = null;
    let completedResult = null;
    const push = delta => {
      const text = String(delta || '');
      if (!text) return;
      queued.push(text);
      if (wake) { const resolve = wake; wake = null; resolve(); }
    };
    void this.provider.complete(messages, {
      stream: true,
      onDelta: push,
      signal: request?.signal,
    }).then(result => { completedResult = result; }, error => { failure = error; }).finally(() => {
      settled = true;
      if (wake) { const resolve = wake; wake = null; resolve(); }
    });
    while (!settled || queued.length) {
      if (!queued.length) await new Promise(resolve => { wake = resolve; });
      while (queued.length) yield { type: 'output_text_delta', itemId: `${responseId}-message`, delta: queued.shift() };
    }
    if (failure) throw failure;
    yield { type: 'response_done', response: { ...modelResponseFromProvider(completedResult, responseId), id: responseId } };
  }
}

function sdkTools(definitions, toolExecutor, { maxToolCalls = 3 } = {}) {
  if (!Array.isArray(definitions) || definitions.length === 0) return [];
  if (typeof toolExecutor !== 'function') throw new ProviderError('tool_unavailable', 'A tool executor is required for an Agents SDK tool run.');
  if (!Number.isSafeInteger(maxToolCalls) || maxToolCalls < 1 || maxToolCalls > 12) {
    throw new ProviderError('invalid_tools', 'maxToolCalls must be between 1 and 12.');
  }
  let executedCalls = 0;
  return definitions.map(definition => {
    const fn = definition?.function;
    if (definition?.type !== 'function' || !fn?.name || !fn?.parameters) {
      throw new ProviderError('invalid_tools', 'SOLAT received an invalid function-tool definition.');
    }
    return tool({
      name: fn.name,
      description: String(fn.description || fn.name),
      parameters: fn.parameters,
      strict: false,
      timeoutMs: 90_000,
      timeoutBehavior: 'raise_exception',
      execute: async (input, _context, details) => {
        executedCalls += 1;
        if (executedCalls > maxToolCalls) throw new ProviderError('tool_loop_limit', 'The Agents SDK tool-call limit was reached.');
        const callId = String(details?.toolCall?.callId || details?.toolCallId || crypto.randomUUID());
        const outcome = await toolExecutor({ id: callId, name: fn.name, arguments: input || {} });
        if (outcome === undefined) throw new ProviderError('tool_error', `Tool ${fn.name} returned no result.`);
        return serializeToolOutcome(fn.name, outcome);
      },
    });
  });
}

function providerMetadata(rawResponses, provider) {
  const latest = [...(Array.isArray(rawResponses) ? rawResponses : [])].reverse().find(item => item?.providerData)?.providerData || {};
  const status = provider?.status?.() || {};
  return {
    provider: latest.provider || status.provider || 'solat_model_provider',
    model: latest.model || status.model || 'configured model',
    routing: latest.routing || null,
    timing: latest.timing || null,
  };
}

class OpenAIAgentsRuntime {
  constructor({ provider } = {}) {
    this.provider = provider;
    this.model = new SolatAgentsModel(provider);
    this.modelProvider = { getModel: () => this.model };
    this.runner = new Runner({
      modelProvider: this.modelProvider,
      tracingDisabled: true,
      traceIncludeSensitiveData: false,
    });
  }

  status() {
    return {
      schema_version: AGENTS_RUNTIME_SCHEMA_VERSION,
      framework: '@openai/agents',
      enabled: true,
      tracing: 'disabled',
    };
  }

  async run({ messages, toolDefinitions = [], toolExecutor = null, maxTurns = DEFAULT_MAX_TURNS, maxToolCalls = 3, onDelta = null, groupId = null } = {}) {
    if (!Array.isArray(messages) || !messages.some(message => message?.role === 'user')) {
      throw new ProviderError('invalid_request', 'An Agents SDK run requires at least one user message.');
    }
    const tools = sdkTools(toolDefinitions, toolExecutor, { maxToolCalls });
    const agent = new Agent({
      name: 'SOLAT V1-V2',
      instructions: 'You are SOLAT. Answer the owner directly. Use only the tools attached to this turn, only when required. Never claim an action succeeded unless its tool result confirms success.',
      model: 'solat-qwen',
      tools,
    });
    const input = messages.map(message => ({
      type: 'message',
      role: message.role,
      ...(message.role === 'assistant'
        ? { status: 'completed', content: [{ type: 'output_text', text: String(message.content || '') }] }
        : { content: String(message.content || '') }),
    }));
    const options = {
      maxTurns,
      groupId: groupId ? String(groupId) : undefined,
      workflowName: 'SOLAT V1-V2 conversation',
      tracingDisabled: true,
      traceIncludeSensitiveData: false,
    };
    let result;
    if (typeof onDelta === 'function') {
      result = await this.runner.run(agent, input, { ...options, stream: true });
      for await (const delta of result.toTextStream({ compatibleWithNodeStreams: true })) {
        try { await onDelta(String(delta)); } catch { /* UI/TTS observer failure must not break the run. */ }
      }
      await result.completed;
      if (result.error) throw result.error;
    } else {
      result = await this.runner.run(agent, input, options);
    }
    const content = String(result.finalOutput || '').trim();
    if (!content) throw new ProviderError('malformed_response', 'The Agents SDK returned an empty final response.');
    const metadata = providerMetadata(result.rawResponses, this.provider);
    return {
      schema_version: AGENTS_RUNTIME_SCHEMA_VERSION,
      content,
      provider: metadata.provider,
      model: metadata.model,
      usage: result.runContext?.usage || null,
      routing: metadata.routing,
      timing: metadata.timing,
      toolRounds: Math.max(0, result.rawResponses.length - 1),
      sdkTurns: result.rawResponses.length,
    };
  }
}

module.exports = {
  AGENTS_RUNTIME_SCHEMA_VERSION,
  DEFAULT_MAX_TURNS,
  OpenAIAgentsRuntime,
  SolatAgentsModel,
  modelResponseFromProvider,
  providerMessagesFromRequest,
  providerToolsFromRequest,
  sdkTools,
};
