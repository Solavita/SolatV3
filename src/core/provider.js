class ProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.details = details;
  }
}

function completionUrl(baseUrl) {
  if (!baseUrl) return '';
  return baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
}

function extractMessage(payload) {
  const message = payload?.choices?.[0]?.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new ProviderError('malformed_response', 'The model returned no assistant message.');
  }
  return message;
}

function extractToolCalls(message) {
  if (message.tool_calls !== undefined && message.tool_calls !== null) {
    if (!Array.isArray(message.tool_calls)) throw new ProviderError('malformed_response', 'The model tool_calls field is not an array.');
    return message.tool_calls.map((call, index) => normalizeToolCall(call, index));
  }
  return extractDsmlToolCalls(message);
}

function normalizeToolCall(call, index) {
    const id = typeof call?.id === 'string' && call.id.trim() ? call.id.trim() : `tool-call-${index + 1}`;
    const name = typeof call?.function?.name === 'string' ? call.function.name.trim() : '';
    if (!name) throw new ProviderError('malformed_response', 'The model returned a tool call without a function name.');
    const rawArguments = call.function.arguments ?? '{}';
    let parsedArguments;
    try {
      parsedArguments = typeof rawArguments === 'string' ? JSON.parse(rawArguments) : rawArguments;
    } catch {
      throw new ProviderError('malformed_response', `The model returned invalid arguments for tool call ${id}.`);
    }
    if (!parsedArguments || typeof parsedArguments !== 'object' || Array.isArray(parsedArguments)) throw new ProviderError('malformed_response', `The arguments for tool call ${id} must be an object.`);
    return Object.freeze({ id, type: 'function', name, arguments: parsedArguments });
}

// Some DeepSeek-compatible deployments emit tool calls inside message.content
// using their DSML tags instead of the OpenAI tool_calls field. Treat that as
// an alternate transport only when one complete, valid DSML block is present.
// A natural-language lead-in is retained as assistant text; arbitrary or
// partially formed markup is never interpreted as executable instructions.
function extractDsmlToolCalls(message) {
  const content = typeof message?.content === 'string' ? message.content.trim() : '';
  const block = parseDsmlToolBlock(content);
  if (!block) return [];
  const token = '\uff5c\uff5cDSML\uff5c\uff5c';
  const openMarker = `<${token}`;
  const closeMarker = `</${token}`;
  const escapedOpenMarker = escapeRegExp(openMarker);
  const escapedCloseMarker = escapeRegExp(closeMarker);
  const invokePattern = new RegExp(`${escapedOpenMarker}invoke\\s+name="([A-Za-z_][\\w-]*)"\\s*>([\\s\\S]*?)${escapedCloseMarker}invoke>`, 'gu');
  const parameterPattern = new RegExp(`${escapedOpenMarker}parameter\\s+name="([A-Za-z_][\\w-]*)"(?:\\s+[^>]*)?>([\\s\\S]*?)${escapedCloseMarker}parameter>`, 'gu');
  const calls = [];
  let remainder = block.body;
  for (const match of block.body.matchAll(invokePattern)) {
    const argumentsObject = {};
    let parameterRemainder = match[2];
    let parameterCount = 0;
    for (const parameter of match[2].matchAll(parameterPattern)) {
      const name = parameter[1];
      const value = parameter[2];
      if (Object.hasOwn(argumentsObject, name) || value.includes(`${String.fromCharCode(60)}${String.fromCharCode(0xff5c)}${String.fromCharCode(0xff5c)}DSML${String.fromCharCode(0xff5c)}${String.fromCharCode(0xff5c)}parameter`)) {
        throw new ProviderError('malformed_response', 'The model returned malformed DSML tool arguments.');
      }
      argumentsObject[name] = decodeXml(value.trim());
      parameterRemainder = parameterRemainder.replace(parameter[0], '');
      parameterCount += 1;
    }
    if (!parameterCount || parameterRemainder.trim()) {
      throw new ProviderError('malformed_response', 'The model returned malformed DSML tool arguments.');
    }
    calls.push(normalizeToolCall({ id: `dsml-tool-${calls.length + 1}`, function: { name: match[1], arguments: argumentsObject } }, calls.length));
    remainder = remainder.replace(match[0], '');
  }
  if (!calls.length || remainder.trim()) throw new ProviderError('malformed_response', 'The model returned malformed DSML tool-call markup.');
  return calls;
}

function parseDsmlToolBlock(content) {
  if (!content.includes('\uff5c\uff5cDSML\uff5c\uff5ctool_calls')) return null;
  const token = '\uff5c\uff5cDSML\uff5c\uff5c';
  const openMarker = `<${token}`;
  const closeMarker = `</${token}`;
  const pattern = new RegExp(`${escapeRegExp(openMarker)}tool_calls>\\s*([\\s\\S]*?)\\s*${escapeRegExp(closeMarker)}tool_calls>`, 'u');
  const match = pattern.exec(content);
  if (!match) throw new ProviderError('malformed_response', 'The model returned malformed DSML tool-call markup.');
  const prose = `${content.slice(0, match.index)}${content.slice(match.index + match[0].length)}`.trim();
  if (prose.includes(token)) throw new ProviderError('malformed_response', 'The model returned malformed DSML tool-call markup.');
  return Object.freeze({ body: match[1], prose });
}

function decodeXml(value) {
  return value.replace(/&quot;/gu, '"').replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function boundedToolEvidence(messages, maxChars = 24000) {
  const evidence = (Array.isArray(messages) ? messages : [])
    .filter(message => message?.role === 'tool' && typeof message?.content === 'string')
    .map(message => ({ name: String(message.name || 'tool'), content: message.content.slice(0, 6000) }));
  return JSON.stringify(evidence).slice(0, maxChars);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(item => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function extractContent(payload) {
  const message = extractMessage(payload);
  const content = message.content;
  if (typeof content === 'string' && content.trim()) {
    const dsml = parseDsmlToolBlock(content.trim());
    const visible = dsml ? dsml.prose : content.trim();
    if (visible) return visible;
  }
  if (Array.isArray(content)) {
    const text = content
      .filter(part => part && part.type === 'text' && typeof part.text === 'string')
      .map(part => part.text)
      .join('')
      .trim();
    if (text) return text;
  }
  throw new ProviderError('malformed_response', 'The model returned no usable text response.');
}

function parseStructuredJson(content) {
  if (typeof content !== 'string' || !content.trim()) {
    throw new ProviderError('malformed_response', 'The model returned no structured response.');
  }
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new ProviderError('malformed_response', 'The model returned invalid structured JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProviderError('malformed_response', 'The model structured response must be an object.');
  }
  return parsed;
}

class OpenAICompatibleProvider {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  status() {
    return {
      provider: providerLabel(this.config),
      model: this.config.model,
      configured: Boolean(this.config.baseUrl && this.config.apiKey),
      baseHost: this.config.baseUrl ? safeHost(this.config.baseUrl) : null,
    };
  }

  async complete(messages, { responseFormat, tools, toolChoice = 'auto' } = {}) {
    if (!this.config.baseUrl || !this.config.apiKey) {
      throw new ProviderError('not_configured', 'Model provider is not configured.');
    }
    if (typeof this.fetchImpl !== 'function') {
      throw new ProviderError('fetch_unavailable', 'This runtime cannot call the model provider.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      let response;
      try {
        const body = {
          model: this.config.model,
          messages,
          stream: false,
        };
        // DeepSeek V4 requires an explicit thinking mode for a reliable
        // non-streaming conversational path.  Keep it provider-local so other
        // OpenAI-compatible endpoints still receive only portable fields.
        if (safeHost(this.config.baseUrl) === 'api.deepseek.com') {
          body.thinking = { type: this.config.thinkingMode === 'enabled' ? 'enabled' : 'disabled' };
        }
        if (responseFormat) body.response_format = responseFormat;
        if (tools !== undefined) {
          if (!Array.isArray(tools)) throw new ProviderError('invalid_tools', 'Provider tools must be an array.');
          body.tools = tools;
          body.tool_choice = toolChoice;
        }
        response = await this.fetchImpl(completionUrl(this.config.baseUrl), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new ProviderError('timeout', 'The model provider timed out.');
        }
        throw new ProviderError('network_error', 'The model provider could not be reached.');
      }
      if (!response?.ok) {
        let diagnostic = '';
        try {
          const payload = await response.json();
          diagnostic = typeof payload?.error?.message === 'string' ? payload.error.message.trim().slice(0, 400) : '';
        } catch {
          // The status still provides a truthful, safe failure when the body
          // is not JSON.
        }
        throw new ProviderError('provider_error', diagnostic || `The model provider returned HTTP ${response?.status ?? 'unknown'}.`, { status: response?.status ?? null });
      }
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new ProviderError('malformed_response', 'The model provider returned invalid JSON.');
      }
      const message = extractMessage(payload);
      const toolCalls = extractToolCalls(message);
      let content = '';
      try {
        content = extractContent(payload);
      } catch (error) {
        if (!toolCalls.length) throw error;
      }
      return {
        content,
        message,
        toolCalls,
        provider: providerLabel(this.config),
        model: this.config.model,
        usage: payload.usage || null,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async completeStructured(messages, schema = {}) {
    const result = await this.complete(messages, { responseFormat: { type: 'json_object' } });
    return { ...result, data: parseStructuredJson(result.content), schema };
  }

  async completeWithTools(messages, { tools = [], toolExecutor, maxToolRounds = 3, maxToolCalls = 3 } = {}) {
    if (!Number.isInteger(maxToolRounds) || maxToolRounds < 1 || maxToolRounds > 8) throw new ProviderError('invalid_tools', 'maxToolRounds must be between 1 and 8.');
    if (!Number.isInteger(maxToolCalls) || maxToolCalls < 1 || maxToolCalls > 12) throw new ProviderError('invalid_tools', 'maxToolCalls must be between 1 and 12.');
    if (typeof toolExecutor !== 'function') throw new ProviderError('tool_unavailable', 'A tool executor is required when tool calls are enabled.');
    let working = Array.isArray(messages) ? messages.map(message => ({ ...message })) : [];
    let toolCallsExecuted = 0;
    // Compatible providers sometimes emit the same search request again after
    // receiving an empty/degraded result. Track semantic call signatures so a
    // new call id cannot turn that repetition into an unbounded tool loop.
    const executedToolSignatures = new Set();
    for (let round = 0; round < maxToolRounds; round += 1) {
      const result = await this.complete(working, { tools, toolChoice: 'auto' });
      if (!result.toolCalls.length) return { ...result, messages: working, toolRounds: round };
      const permittedCalls = result.toolCalls.slice(0, Math.max(0, maxToolCalls - toolCallsExecuted));
      if (!permittedCalls.length) break;
      const novelCalls = permittedCalls.filter(call => {
        const signature = `${String(call.name || '')}\u0000${stableJson(call.arguments || {})}`;
        return !executedToolSignatures.has(signature);
      });
      // If every permitted call is a semantic duplicate, preserve the
      // completed evidence and move directly to the bounded text-only pass.
      // Do not append an assistant tool call without a matching tool result.
      if (!novelCalls.length) break;
      // DeepSeek V4 requires assistant content to remain a string in a
      // tool-call history, even when it is empty. Preserve reasoning content
      // as well if a compatible provider returns it for a future thinking
      // mode, rather than rebuilding an incomplete assistant turn.
      const assistantToolTurn = {
        role: 'assistant',
        // `result.content` is the validated visible text; for a DSML turn it
        // excludes the executable markup while preserving any lead-in prose.
        content: typeof result.content === 'string' ? result.content : (typeof result.message?.content === 'string' ? result.message.content : ''),
        tool_calls: novelCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })),
      };
      if (typeof result.message?.reasoning_content === 'string') assistantToolTurn.reasoning_content = result.message.reasoning_content;
      working.push(assistantToolTurn);
      for (const call of novelCalls) {
        executedToolSignatures.add(`${String(call.name || '')}\u0000${stableJson(call.arguments || {})}`);
        let outcome;
        try {
          outcome = await toolExecutor(call);
        } catch (error) {
          throw new ProviderError('tool_error', `Tool ${call.name} failed.`, { tool: call.name, cause: error?.code || 'unknown' });
        }
        if (outcome === undefined) throw new ProviderError('tool_error', `Tool ${call.name} returned no result.`);
        working.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: JSON.stringify(outcome) });
        toolCallsExecuted += 1;
      }
      if (toolCallsExecuted >= maxToolCalls) break;
    }
    // The tool cap limits side effects, not the model's chance to synthesize
    // the evidence it already received. Force one final text-only turn after
    // the last permitted tool round. This prevents a model that keeps asking
    // for the same search from turning a usable evidence set into a failure.
    // Do not merely ask the provider to choose none while continuing to send
    // the tool definitions: some OpenAI-compatible models still emit a call
    // in that shape. The final synthesis turn has no tools at all.
    const finalMessages = [...working, {
      role: 'system',
      content: 'Tool use is no longer available for this response. Do not emit tool-call markup or request another tool. Write the final answer now using only the evidence already returned by the tools. If that evidence is insufficient, say so plainly.',
    }];
    const finalResult = await this.complete(finalMessages);
    if (finalResult.toolCalls.length) {
      // Some compatible models remain in a function-call pattern after a
      // long tool transcript even when no definitions are sent. Reframe one
      // bounded final synthesis using the original non-tool context plus the
      // completed evidence, never by executing another requested tool.
      const baseMessages = working.filter(message => message?.role !== 'tool' && !Array.isArray(message?.tool_calls));
      const recoveryMessages = [...baseMessages, {
        role: 'system',
        content: `This is a separate final synthesis. Tool use is unavailable and must not be requested. Answer the user's existing request using only this completed tool evidence. If it is empty or insufficient, say that plainly.\n${boundedToolEvidence(working)}`,
      }];
      const recovered = await this.complete(recoveryMessages);
      if (recovered.toolCalls.length) {
        throw new ProviderError('tool_loop_limit', 'The model ignored the final no-tool instruction after the tool-call round limit.');
      }
      return { ...recovered, messages: recoveryMessages, toolRounds: Math.min(maxToolRounds, toolCallsExecuted), toolCallsExecuted, forcedFinalResponse: true, recoveredFinalSynthesis: true };
    }
    return { ...finalResult, messages: finalMessages, toolRounds: Math.min(maxToolRounds, toolCallsExecuted), toolCallsExecuted, forcedFinalResponse: true };
  }
}

function createProvider(config, fetchImpl = globalThis.fetch) {
  // Milestone 1 uses the DeepSeek OpenAI-compatible API only. Other provider
  // adapters must not become an accidental paid path in this rebuild.
  return new OpenAICompatibleProvider(config, fetchImpl);
}

function providerLabel(config) {
  return safeHost(config?.baseUrl) === 'api.deepseek.com' ? 'deepseek_api' : 'openai-compatible';
}

function safeHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

module.exports = {
  OpenAICompatibleProvider,
  ProviderError,
  completionUrl,
  extractMessage,
  extractToolCalls,
  createProvider,
  extractContent,
  parseStructuredJson,
};
