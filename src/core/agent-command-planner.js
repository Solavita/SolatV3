const AGENT_COMMAND_PLAN_VERSION = 'solat.agent-command-plan.v1';

const PLAN_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    schema_version: { type: 'string', enum: [AGENT_COMMAND_PLAN_VERSION] },
    status: { type: 'string', enum: ['planned', 'needs_clarification', 'unsupported'] },
    summary: { type: 'string', minLength: 1, maxLength: 600 },
    tool: { type: 'string', enum: ['none', 'filesystem_create', 'computer_launch_app', 'computer_open_website', 'computer_play_youtube_music'] },
    arguments: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 240 },
        content: { type: 'string', maxLength: 1048576 },
        app_id: { type: 'string', enum: ['chrome', 'notepad'] },
        site: { type: 'string', enum: ['google', 'google_classroom', 'youtube'] },
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

// A natural Thai request often omits the word "เพลง" (song):
// "เปิด YouTube แล้วเปิด Lllies" still means play Lllies, not merely open the
// YouTube homepage.  Keep this deterministic guard beside schema validation
// so the model cannot silently reduce a two-part request to its first step.
function requestedYoutubeMusicQuery(requestText) {
  const request = String(requestText || '').trim();
  if (!/(?:\byoutube\b|\byoutu\.be\b|ยูทูบ)/iu.test(request)) return null;
  const thai = request.match(/(?:แล้ว|เเล้ว)\s*(?:เปิด|เล่น)\s*(?:เพลง\s*)?([^,.;!?]+?)\s*$/iu);
  const english = request.match(/\byoutube\b[\s\S]*?\b(?:then\s+)?(?:play|open)\s+(?:the\s+)?(?:song\s+|music\s+)?([^,.;!?]+?)\s*$/iu);
  const explicit = request.match(/(?:\b(?:play|song|music)\b|(?:เปิด|เล่น)\s*เพลง)\s*[:=]?\s*([^,.;!?]+?)\s*$/iu);
  const candidate = thai?.[1] || english?.[1] || explicit?.[1] || '';
  const query = String(candidate).trim();
  return query && !/^(?:youtube|ยูทูบ)$/iu.test(query) ? query : null;
}

function requestedWebsite(requestText) {
  const request = String(requestText || '').trim().toLocaleLowerCase();
  if (!request || requestedYoutubeMusicQuery(request) || /(?:\b(?:play|music|song)\b|เปิด\s*เพลง|เล่น\s*เพลง|เพลง)/iu.test(request)) return null;
  if (/\bgoogle\s+classroom\b|classroom|กูเกิล\s*คลาสรูม/iu.test(request)) return 'google_classroom';
  if (/\bgoogle\b|กูเกิล/iu.test(request)) return 'google';
  if (/\byoutube\b|ยูทูบ/iu.test(request)) return 'youtube';
  return null;
}

function validatePlannedCommand(plan, command, requestText = '') {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('Agent command plan is invalid.');
  if (plan.status !== 'planned') return plan;
  const args = plan.arguments || {};
  const isAuto = command === 'auto';
  const request = String(requestText || '');
  const requiredYoutubeQuery = requestedYoutubeMusicQuery(request);
  const requiredWebsite = requestedWebsite(request);
  if (command === 'create-file') {
    if (plan.tool !== 'filesystem_create' || typeof args.path !== 'string' || typeof args.content !== 'string') {
      throw new Error('The model did not produce a complete create-file plan.');
    }
  } else if (command === 'computer-use') {
    if (plan.tool === 'computer_launch_app' && !['chrome', 'notepad'].includes(args.app_id)) throw new Error('The model selected an unsupported application.');
    if (plan.tool === 'computer_play_youtube_music' && (typeof args.query !== 'string' || !args.query.trim())) throw new Error('The model omitted the requested YouTube search query.');
    if (plan.tool === 'computer_open_website' && !['google', 'google_classroom', 'youtube'].includes(args.site)) throw new Error('The model selected an unsupported website.');
    if (!['computer_launch_app', 'computer_open_website', 'computer_play_youtube_music'].includes(plan.tool)) throw new Error('The model selected an unsupported computer action.');
    if (requiredYoutubeQuery && plan.tool !== 'computer_play_youtube_music') {
      throw invalidPlan('The plan is incomplete: this request requires the YouTube music workflow, not only launching an app.');
    }
    if (requiredWebsite && (plan.tool !== 'computer_open_website' || args.site !== requiredWebsite)) {
      throw invalidPlan(`The plan is incomplete: this request requires opening ${requiredWebsite}, not only launching an app.`);
    }
    if (plan.tool === 'computer_play_youtube_music' && !request.toLocaleLowerCase().includes(args.query.trim().toLocaleLowerCase())) {
      throw invalidPlan('The YouTube query must preserve a phrase from the user request exactly; do not substitute a default.');
    }
  } else if (isAuto) {
    if (!['filesystem_create', 'computer_launch_app', 'computer_open_website', 'computer_play_youtube_music'].includes(plan.tool)) {
      throw invalidPlan('The model selected an unsupported Agent action.');
    }
    if (plan.tool === 'filesystem_create' && (typeof args.path !== 'string' || typeof args.content !== 'string')) {
      throw invalidPlan('The model did not provide a complete file creation plan.');
    }
    if (plan.tool === 'computer_launch_app' && !['chrome', 'notepad'].includes(args.app_id)) {
      throw invalidPlan('The model selected an unsupported application.');
    }
    if (plan.tool === 'computer_open_website' && !['google', 'google_classroom', 'youtube'].includes(args.site)) {
      throw invalidPlan('The model selected an unsupported website.');
    }
    if (plan.tool === 'computer_play_youtube_music' && (typeof args.query !== 'string' || !args.query.trim())) {
      throw invalidPlan('The model omitted the requested YouTube search query.');
    }
    if (requiredYoutubeQuery && plan.tool !== 'computer_play_youtube_music') {
      throw invalidPlan('The plan is incomplete: this request requires the YouTube music workflow, not only launching an app.');
    }
    if (requiredWebsite && (plan.tool !== 'computer_open_website' || args.site !== requiredWebsite)) {
      throw invalidPlan(`The plan is incomplete: this request requires opening ${requiredWebsite}, not only launching an app.`);
    }
    if (plan.tool === 'computer_play_youtube_music' && requiredYoutubeQuery
      && !request.toLocaleLowerCase().includes(args.query.trim().toLocaleLowerCase())) {
      throw invalidPlan('The YouTube query must preserve a phrase from the user request exactly; do not substitute a default.');
    }
  }
  return plan;
}

async function planAgentCommand({ provider, messages, command }) {
  if (!provider || typeof provider.completeStructured !== 'function') throw new Error('The configured model cannot create a validated Agent plan.');
  const allowed = command === 'create-file'
    ? 'filesystem_create(path, content)'
    : command === 'computer-use'
      ? 'computer_launch_app(app_id=chrome|notepad), computer_open_website(site=google|google_classroom|youtube), computer_play_youtube_music(query)'
      : 'filesystem_create(path, content), computer_launch_app(app_id=chrome|notepad), computer_open_website(site=google|google_classroom|youtube), computer_play_youtube_music(query)';
  const instruction = {
    role: 'system',
    content: `You are the SOLAT Agent command planner (${AGENT_COMMAND_PLAN_VERSION}). Interpret the user's actual request before any tool runs. Allowed capability for this request: ${command}. Allowed tools: ${allowed}. Preserve requested filenames, content, application names, song names, spelling, and typos exactly; never replace a requested song with a default such as lofi. A request such as "open YouTube then open Lllies" or "เปิด YouTube แล้วเปิด Lllies" is a music-playback workflow: choose computer_play_youtube_music and put Lllies in arguments.query. Do not reduce it to computer_open_website. For a Google Classroom request, choose computer_open_website with site google_classroom as the first bounded action; inspecting classes and choosing a subject happens only after verified on-screen evidence in a later step. If this is only a question about a capability, or required information is missing, use status needs_clarification, tool none, empty arguments, and ask one concise question in summary. Do not claim execution or success. Return exactly one JSON object with these keys and no Markdown: {"schema_version":"${AGENT_COMMAND_PLAN_VERSION}","status":"planned|needs_clarification|unsupported","summary":"...","tool":"none|filesystem_create|computer_launch_app|computer_open_website|computer_play_youtube_music","arguments":{}}. Permission, ownership, approval, and final verification are enforced by code, not by you.`,
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

module.exports = { AGENT_COMMAND_PLAN_VERSION, PLAN_SCHEMA, planAgentCommand, validatePlannedCommand, requestedYoutubeMusicQuery, requestedWebsite };
