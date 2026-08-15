const AGENT_COMMAND_PLAN_VERSION = 'solat.agent-command-plan.v1';

const PLAN_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    schema_version: { type: 'string', enum: [AGENT_COMMAND_PLAN_VERSION] },
    status: { type: 'string', enum: ['planned', 'needs_clarification', 'unsupported'] },
    summary: { type: 'string', minLength: 1, maxLength: 600 },
    tool: { type: 'string', enum: ['none', 'filesystem_create', 'computer_launch_app', 'computer_play_youtube_music'] },
    arguments: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 240 },
        content: { type: 'string', maxLength: 1048576 },
        app_id: { type: 'string', enum: ['chrome', 'notepad'] },
        query: { type: 'string', minLength: 1, maxLength: 160 },
      },
      additionalProperties: false,
    },
  },
  required: ['schema_version', 'status', 'summary', 'tool', 'arguments'],
  additionalProperties: false,
});

function invalidPlan(message) {
  const error = new Error(message);
  error.code = 'malformed_response';
  return error;
}

function validatePlannedCommand(plan, command, requestText = '') {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('Agent command plan is invalid.');
  if (plan.status !== 'planned') return plan;
  const args = plan.arguments || {};
  if (command === 'create-file') {
    if (plan.tool !== 'filesystem_create' || typeof args.path !== 'string' || typeof args.content !== 'string') {
      throw new Error('The model did not produce a complete create-file plan.');
    }
  } else if (command === 'computer-use') {
    if (plan.tool === 'computer_launch_app' && !['chrome', 'notepad'].includes(args.app_id)) throw new Error('The model selected an unsupported application.');
    if (plan.tool === 'computer_play_youtube_music' && (typeof args.query !== 'string' || !args.query.trim())) throw new Error('The model omitted the requested YouTube search query.');
    if (!['computer_launch_app', 'computer_play_youtube_music'].includes(plan.tool)) throw new Error('The model selected an unsupported computer action.');
    const request = String(requestText || '');
    const requestsYoutubeMusic = /youtube/iu.test(request) && /(?:music|song|play|เพลง|เปิดเพลง)/iu.test(request);
    if (requestsYoutubeMusic && plan.tool !== 'computer_play_youtube_music') {
      throw invalidPlan('The plan is incomplete: this request requires the YouTube music workflow, not only launching an app.');
    }
    if (plan.tool === 'computer_play_youtube_music' && !request.toLocaleLowerCase().includes(args.query.trim().toLocaleLowerCase())) {
      throw invalidPlan('The YouTube query must preserve a phrase from the user request exactly; do not substitute a default.');
    }
  }
  return plan;
}

async function planAgentCommand({ provider, messages, command }) {
  if (!provider || typeof provider.completeStructured !== 'function') throw new Error('The configured model cannot create a validated Agent plan.');
  const allowed = command === 'create-file'
    ? 'filesystem_create(path, content)'
    : 'computer_launch_app(app_id=chrome|notepad), computer_play_youtube_music(query)';
  const instruction = {
    role: 'system',
    content: `You are the SOLAT Agent command planner (${AGENT_COMMAND_PLAN_VERSION}). Interpret the user's actual request before any tool runs. Allowed capability for this request: ${command}. Allowed tools: ${allowed}. Preserve requested filenames, content, application names, song names, spelling, and typos exactly; never replace a requested song with a default such as lofi. For a YouTube music request, put the user's requested song/search phrase in arguments.query. If required information is missing, use status needs_clarification, tool none, empty arguments, and ask one concise question in summary. Do not claim execution or success. Return exactly one JSON object with these keys and no Markdown: {"schema_version":"${AGENT_COMMAND_PLAN_VERSION}","status":"planned|needs_clarification|unsupported","summary":"...","tool":"none|filesystem_create|computer_launch_app|computer_play_youtube_music","arguments":{}}. Permission, ownership, approval, and final verification are enforced by code, not by you.`,
  };
  const recentUserMessage = [...(Array.isArray(messages) ? messages : [])].reverse().find(message => message?.role === 'user');
  const plannerMessages = [instruction, ...(recentUserMessage ? [{ role: 'user', content: recentUserMessage.content }] : [])];
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await provider.completeStructured(
        attempt === 0 ? plannerMessages : [...plannerMessages, { role: 'system', content: `Your previous planner response was invalid: ${String(lastError?.message || 'invalid output').slice(0, 300)} Return only the corrected strict JSON object now, without a code fence, commentary, or tool-call markup.` }],
        PLAN_SCHEMA,
      );
      const plan = response?.data && typeof response.data === 'object' ? response.data : response;
      return validatePlannedCommand(plan, command, recentUserMessage?.content || '');
    } catch (error) {
      lastError = error;
      if (attempt > 0 || error?.code !== 'malformed_response') throw error;
    }
  }
  throw lastError;
}

module.exports = { AGENT_COMMAND_PLAN_VERSION, PLAN_SCHEMA, planAgentCommand, validatePlannedCommand };
