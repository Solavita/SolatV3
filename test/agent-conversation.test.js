const test = require('node:test');
const assert = require('node:assert/strict');
const { ConversationCore, parseDirectComputerLaunchRequest, parseDirectComputerWorkflowRequest, parseDirectFileCreateRequest, requestsAgentCapability, requiresScreenDrivenComputerTask } = require('../src/core/conversation-core');

function router() {
  return {
    analyze() {
      return {
        primary_intent: 'general_chat', confidence: 0.4, candidate_intents: [],
        allowed_tools: [], safety_constraints: [], task: {}, disambiguation: {},
      };
    },
  };
}

test('Agent mode OFF omits agent tools and keeps normal conversation model-first', async () => {
  let toolsWereOff = false;
  const provider = {
    status: () => ({ configured: true, provider: 'fake', model: 'fake' }),
    async complete(messages) {
      toolsWereOff = messages.some(message => message.role === 'system' && message.content.includes('Agent mode is OFF'));
      return { content: 'คุยได้ตามปกติ', provider: 'fake', model: 'fake' };
    },
    async completeWithTools() { throw new Error('agent tools must not be exposed'); },
  };
  const bridge = { definitions: () => [{ type: 'function', function: { name: 'filesystem_create', parameters: { type: 'object' } } }], owns: () => true };
  const result = await new ConversationCore({ config: {}, provider, router: router(), agentBridge: bridge }).send({ sessionId: 'agent-off', content: 'สวัสดี', agentMode: false });
  assert.equal(result.assistant, 'คุยได้ตามปกติ');
  assert.equal(result.agentMode, false);
  assert.equal(toolsWereOff, true);
});

test('Agent mode OFF rejects an explicit file mutation truthfully without calling the provider', async () => {
  let providerCalls = 0;
  const provider = {
    status: () => ({ configured: true, provider: 'fake', model: 'fake' }),
    async complete() { providerCalls += 1; throw new Error('provider must not be called for a disabled Agent mutation'); },
    async completeWithTools() { providerCalls += 1; throw new Error('tools must not be exposed while Agent mode is off'); },
  };
  const bridge = { definitions: () => [], owns: () => false };
  const result = await new ConversationCore({ config: {}, provider, router: router(), agentBridge: bridge }).send({
    sessionId: 'agent-off-file',
    content: 'สร้างไฟล์ must-not-exist.txt ให้ฉัน',
    agentMode: false,
  });
  assert.equal(providerCalls, 0);
  assert.equal(result.agentMode, false);
  assert.equal(result.agentActions.length, 0);
  assert.match(result.assistant, /Agent mode ปิดอยู่/);
  assert.match(result.assistant, /ยังไม่ได้สร้าง/);
});

test('Agent mode OFF also gates a natural Google Classroom control request', async () => {
  let providerCalls = 0;
  const provider = { status: () => ({ configured: true, provider: 'fake', model: 'fake' }), async complete() { providerCalls += 1; } };
  const result = await new ConversationCore({ config: {}, provider, router: router(), agentBridge: { definitions: () => [], owns: () => false } }).send({
    sessionId: 'agent-off-classroom', content: 'Open Google Classroom and find Physics.', agentMode: false,
  });
  assert.equal(providerCalls, 0);
  assert.equal(result.agentActions.length, 0);
  assert.match(result.assistant, /Agent mode is off/);
});

test('Agent mode ON exposes tools but a write returns an out-of-band approval action', async () => {
  let offeredTools = [];
  const provider = {
    status: () => ({ configured: true, provider: 'fake', model: 'fake' }),
    async completeWithTools(_messages, options) {
      offeredTools = options.tools.map(tool => tool.function.name);
      const outcome = await options.toolExecutor({ id: 'call-1', name: 'filesystem_create', arguments: { relative_path: 'note.txt', content: 'hello' } });
      assert.equal(outcome.status, 'confirmation_required');
      return { content: 'พร้อมสร้างไฟล์หลังคุณอนุมัติ', provider: 'fake', model: 'fake', toolRounds: 1 };
    },
  };
  const bridge = {
    definitions: () => [{ type: 'function', function: { name: 'filesystem_create', parameters: { type: 'object', properties: {}, additionalProperties: true } } }],
    owns: name => name === 'filesystem_create',
    execute: async () => ({
      model_result: { status: 'confirmation_required', tool: 'filesystem_create' },
      action: { status: 'confirmation_required', plan_id: 'p1', idempotency_key: 'k1', approval_token: 'one-time' },
    }),
  };
  const result = await new ConversationCore({ config: {}, provider, router: router(), agentBridge: bridge }).send({ sessionId: 'agent-on', content: 'สร้าง note.txt', agentMode: true });
  assert.deepEqual(offeredTools, ['filesystem_create']);
  assert.equal(result.agentMode, true);
  assert.equal(result.agentActions.length, 1);
  assert.equal(result.agentActions[0].approval_token, 'one-time');
});

test('Thai create-file command is model-planned before the filesystem approval bridge', async () => {
  let plannerCalls = 0;
  let bridgeCall = null;
  const provider = {
    status: () => ({ configured: true, provider: 'fake', model: 'fake' }),
    async completeStructured() {
      plannerCalls += 1;
      return { data: { schema_version: 'solat.agent-command-plan.v1', status: 'planned', summary: 'จะสร้าง note.txt ซึ่งมีข้อความ hello', tool: 'filesystem_create', arguments: { path: 'note.txt', content: 'hello' } } };
    },
  };
  const bridge = {
    definitions: () => [{ type: 'function', function: { name: 'filesystem_create', parameters: { type: 'object' } } }],
    owns: name => name === 'filesystem_create',
    execute: async ({ call }) => {
      bridgeCall = call;
      return { model_result: { status: 'confirmation_required', message: 'รออนุมัติ' }, action: { status: 'confirmation_required', idempotency_key: 'k2', plan_id: 'p2', approval_token: 'token2', tool: call.name, arguments: call.arguments } };
    },
  };
  assert.equal(requestsAgentCapability('สร้างไฟล์ note.txt เนื้อหา: hello'), true);
  assert.deepEqual(parseDirectFileCreateRequest('สร้างไฟล์ note.txt เนื้อหา: hello'), { status: 'ready', path: 'note.txt', content: 'hello' });
  const result = await new ConversationCore({ config: {}, provider, router: router(), agentBridge: bridge }).send({ sessionId: 'agent-direct', content: 'สร้างไฟล์ note.txt เนื้อหา: hello', agentMode: true, agentCommand: 'create-file' });
  assert.equal(plannerCalls, 1);
  assert.deepEqual(bridgeCall.arguments, { path: 'note.txt', content: 'hello' });
  assert.equal(result.agentActions.length, 1);
  assert.equal(result.agentCommand, 'create-file');
});

test('CPU Agent mode uses the model planner for a natural file request without an @ prefix', async () => {
  let plannedCommand = null;
  let bridgeCall = null;
  const provider = {
    status: () => ({ configured: true, provider: 'fake', model: 'fake' }),
    async completeStructured(messages) {
      plannedCommand = messages[0].content;
      return { data: { schema_version: 'solat.agent-command-plan.v1', status: 'planned', summary: 'I will create tree.html.', tool: 'filesystem_create', arguments: { path: 'tree.html', content: '<main>tree</main>' } } };
    },
  };
  const bridge = {
    definitions: () => [{ type: 'function', function: { name: 'filesystem_create', parameters: { type: 'object' } } }],
    owns: name => name === 'filesystem_create',
    async execute({ call }) {
      bridgeCall = call;
      return { model_result: { status: 'confirmation_required' }, action: { status: 'confirmation_required', idempotency_key: 'auto-k1', plan_id: 'auto-p1', approval_token: 'auto-token', tool: call.name, arguments: call.arguments } };
    },
  };
  const result = await new ConversationCore({ config: {}, provider, router: router(), agentBridge: bridge }).send({
    sessionId: 'agent-auto-file', content: 'Create tree.html with a simple tree.', agentMode: true,
  });
  assert.match(plannedCommand, /Allowed capability for this request: auto/);
  assert.deepEqual(bridgeCall, { id: 'model-plan-' + result.requestId, name: 'filesystem_create', arguments: { path: 'tree.html', content: '<main>tree</main>' } });
  assert.equal(result.agentCommand, null);
  assert.equal(result.agentActions.length, 1);
});

test('Create-file command without a filename or content asks for the missing fields', async () => {
  const provider = {
    status: () => ({ configured: true, provider: 'fake', model: 'fake' }),
    async completeStructured() {
      return { data: { schema_version: 'solat.agent-command-plan.v1', status: 'needs_clarification', summary: 'กรุณาระบุชื่อไฟล์และเนื้อหาที่ต้องการ', tool: 'none', arguments: {} } };
    },
  };
  const bridge = { definitions: () => [], owns: () => false, execute: async () => { throw new Error('should not execute'); } };
  const result = await new ConversationCore({ config: {}, provider, router: router(), agentBridge: bridge }).send({ sessionId: 'agent-missing', content: 'สร้างไฟล์ HTML ที่มีรูปประกอบ', agentMode: true, agentCommand: 'create-file' });
  assert.match(result.assistant, /ระบุชื่อไฟล์|ชื่อไฟล์/);
  assert.equal(result.agentActions.length, 0);
});

test('Computer-use launch command uses the deterministic allowlisted fast path before approval', async () => {
  let plannerCalls = 0;
  let bridgeCall = null;
  const provider = {
    status: () => ({ configured: true, provider: 'fake', model: 'fake' }),
    async completeStructured() {
      plannerCalls += 1;
      throw new Error('A plain allowlisted app launch must not call the model planner.');
    },
  };
  const bridge = {
    definitions: () => [{ type: 'function', function: { name: 'computer_launch_app', parameters: { type: 'object' } } }],
    owns: name => name === 'computer_launch_app',
    async execute({ call }) {
      bridgeCall = call;
      return {
        model_result: { status: 'confirmation_required', message: 'Approval required.' },
        action: { status: 'confirmation_required', idempotency_key: 'launch-k1', plan_id: 'launch-p1', approval_token: 'launch-token', tool: call.name, arguments: call.arguments },
      };
    },
  };
  assert.deepEqual(parseDirectComputerLaunchRequest('@computer-use open chrome'), { status: 'ready', appId: 'chrome' });
  const result = await new ConversationCore({ config: {}, provider, router: router(), agentBridge: bridge }).send({
    sessionId: 'agent-launch', content: '@computer-use open chrome', agentMode: true, agentCommand: 'computer-use',
  });
  assert.equal(plannerCalls, 0);
  assert.equal(bridgeCall.name, 'computer_launch_app');
  assert.deepEqual(bridgeCall.arguments, { app_id: 'chrome' });
  assert.equal(result.agentActions.length, 1);
  assert.equal(result.agentCommand, 'computer-use');
});

test('natural Notepad launch uses the same deterministic fast path with Agent mode on', async () => {
  let plannerCalls = 0;
  let bridgeCall = null;
  const provider = {
    status: () => ({ configured: true, provider: 'fake', model: 'fake' }),
    async completeStructured() { plannerCalls += 1; throw new Error('model planner must not run'); },
  };
  const bridge = {
    definitions: () => [{ type: 'function', function: { name: 'computer_launch_app', parameters: { type: 'object' } } }],
    owns: name => name === 'computer_launch_app',
    async execute({ call }) {
      bridgeCall = call;
      return {
        model_result: { status: 'confirmation_required', message: 'Approval required.' },
        action: { status: 'confirmation_required', idempotency_key: 'notepad-k1', plan_id: 'notepad-p1', approval_token: 'notepad-token', tool: call.name, arguments: call.arguments },
      };
    },
  };
  const result = await new ConversationCore({ config: {}, provider, router: router(), agentBridge: bridge }).send({
    sessionId: 'agent-notepad-fast', content: 'เปิด Notepad', agentMode: true,
  });
  assert.equal(plannerCalls, 0);
  assert.deepEqual(bridgeCall.arguments, { app_id: 'notepad' });
  assert.equal(result.agentActions.length, 1);
});

test('Computer requests use the persistent model-guided task loop when it is available', async () => {
  let received = null;
  const loop = {
    async start(input) {
      received = input;
      return {
        task_id: 'computer-task-1', status: 'AWAITING_APPROVAL', planner_turns: 2,
        summary: 'Open Google Classroom first.',
        pending_action: { tool: 'computer_open_website', action: { status: 'confirmation_required', idempotency_key: 'classroom-1', approval_token: 'once', arguments: { site: 'google_classroom' } } },
      };
    },
  };
  const provider = { status: () => ({ configured: true, provider: 'fake', model: 'fake' }) };
  const bridge = { definitions: () => [], owns: () => false };
  const result = await new ConversationCore({ config: {}, provider, router: router(), agentBridge: bridge, computerTaskLoop: loop }).send({
    sessionId: 'computer-task', requestId: 'request-task', content: '@computer-use open Google Classroom and find Physics.', agentMode: true, agentCommand: 'computer-use',
  });
  assert.equal(received.ownerId, 'computer-task');
  assert.equal(received.requestId, 'request-task');
  assert.equal(result.agentActions[0].computerTaskId, 'computer-task-1');
  assert.equal(result.agentActions[0].tool, 'computer_open_website');
  assert.match(result.assistant, /Open Google Classroom first/);
});

test('bounded YouTube playback stays inside the persistent task loop until verified completion', async () => {
  let loopCalls = 0;
  const provider = {
    status: () => ({ configured: true, provider: 'fake', model: 'fake' }),
    async completeStructured() { throw new Error('ConversationCore must delegate the persistent task.'); },
  };
  const bridge = {
    definitions: () => [], owns: name => name === 'computer_play_youtube_music',
  };
  const loop = { hasActive: () => false, async start() { loopCalls += 1; return { task_id: 'youtube-task', status: 'AWAITING_APPROVAL', summary: 'Play and verify Lllies.', planner_turns: 1, pending_action: { tool: 'computer_play_youtube_music', action: { status: 'confirmation_required', idempotency_key: 'yt-direct', approval_token: 'once', arguments: { query: 'Lllies' } } } }; } };
  assert.equal(requiresScreenDrivenComputerTask('Open YouTube and play Lllies'), true);
  const result = await new ConversationCore({ config: {}, provider, router: router(), agentBridge: bridge, computerTaskLoop: loop }).send({
    sessionId: 'youtube-direct', content: 'Open YouTube and play Lllies', agentMode: true, agentCommand: 'computer-use',
  });
  assert.equal(loopCalls, 1);
  assert.equal(result.agentActions[0].computerTaskId, 'youtube-task');
  assert.equal(result.agentActions.length, 1);
});

test('natural Thai Instagram profile request reaches the persistent workflow without a mode toggle', async () => {
  let received = null;
  let plannerCalls = 0;
  const provider = {
    status: () => ({ configured: true, provider: 'fake', model: 'fake' }),
    async completeStructured() { plannerCalls += 1; throw new Error('The generic one-step planner must not truncate this workflow.'); },
  };
  const bridge = { definitions: () => [], owns: () => false };
  const loop = {
    hasActive: () => false,
    async start(input) {
      received = input;
      return {
        task_id: 'instagram-task', status: 'AWAITING_APPROVAL', summary: 'Open Instagram first.', planner_turns: 0,
        pending_action: { tool: 'computer_open_website', action: { status: 'confirmation_required', idempotency_key: 'instagram-open', approval_token: 'once', arguments: { site: 'instagram' } } },
      };
    },
  };
  const result = await new ConversationCore({ config: {}, provider, router: router(), agentBridge: bridge, computerTaskLoop: loop }).send({
    sessionId: 'instagram-natural', requestId: 'instagram-natural-request',
    content: 'เปิด Chrome แล้วเปิด Instagram แล้วไปที่หน้าโปรไฟล์ของฉัน', agentMode: true,
  });
  assert.equal(plannerCalls, 0);
  assert.deepEqual(received.workflowHint, { workflow: 'instagram_profile' });
  assert.equal(result.agentActions[0].tool, 'computer_open_website');
  assert.deepEqual(result.agentActions[0].arguments, { site: 'instagram' });
});

test('screen-driven navigation keeps the persistent planner', () => {
  assert.equal(requiresScreenDrivenComputerTask('Open Google Classroom and find Physics'), true);
  assert.equal(requiresScreenDrivenComputerTask('เปิด Google Classroom แล้วหาวิชาฟิสิกส์'), true);
  assert.equal(
    requiresScreenDrivenComputerTask('เปิด Chrome พิมพ์ Diana King แล้วเข้าเว็บ Wikipedia เลื่อนไปดูส่วน Biography และสรุปเพลงชื่อดัง 10 เพลง'),
    true,
  );
  assert.equal(requiresScreenDrivenComputerTask('สร้างไฟล์ page.html เนื้อหา: <main>ok</main>'), false);
  assert.equal(requiresScreenDrivenComputerTask('สรุปว่าคำสั่งก่อนหน้าทำอะไร'), false);
  assert.equal(requiresScreenDrivenComputerTask('เปิด Chrome แล้วสรุปหน้า Wikipedia นี้'), true);
});

test('Multi-step YouTube music command routes to one verified computer workflow', async () => {
  let plannerCalls = 0;
  let bridgeCall = null;
  const provider = {
    status: () => ({ configured: true, provider: 'fake', model: 'fake' }),
    async completeStructured() {
      plannerCalls += 1;
      return { data: { schema_version: 'solat.agent-command-plan.v1', status: 'planned', summary: 'จะเปิด YouTube และค้นหาเพลง Lllies', tool: 'computer_play_youtube_music', arguments: { query: 'Lllies' } } };
    },
  };
  const bridge = {
    definitions: () => [{ type: 'function', function: { name: 'computer_play_youtube_music', parameters: { type: 'object' } } }],
    owns: name => name === 'computer_play_youtube_music',
    async execute({ call }) {
      bridgeCall = call;
      return {
        model_result: { status: 'confirmation_required', message: 'Approval required.' },
        action: { status: 'confirmation_required', idempotency_key: 'yt-k1', plan_id: 'yt-p1', approval_token: 'yt-token', tool: call.name, arguments: call.arguments },
      };
    },
  };
  assert.deepEqual(parseDirectComputerWorkflowRequest('@computer-use เปิด chrome แล้วเปิด youtube แล้วเปิดเพลง Lllies'), { status: 'ready', workflow: 'youtube_music', query: 'Lllies' });
  assert.deepEqual(parseDirectComputerWorkflowRequest('เปิด Chrome แล้วเปิด Instagram แล้วไปที่หน้าโปรไฟล์ของฉัน'), { status: 'ready', workflow: 'instagram_profile' });
  assert.equal(requiresScreenDrivenComputerTask('เปิด Chrome แล้วเปิด Instagram แล้วไปที่หน้าโปรไฟล์ของฉัน'), true);
  assert.deepEqual(parseDirectComputerWorkflowRequest('ค้นเพลง Lllies บน YouTube แล้วเปิดผลลัพธ์ที่ตรงที่สุด'), { status: 'ready', workflow: 'youtube_music', query: 'Lllies' });
  assert.deepEqual(parseDirectComputerWorkflowRequest('เปลี่ยนเป็นเพลง Lllies (Acoustic Live) บน YouTube'), { status: 'ready', workflow: 'youtube_music', query: 'Lllies (Acoustic Live)' });
  assert.deepEqual(parseDirectComputerWorkflowRequest('@computer-use Open Chrome and search Diana King'), { status: 'ready', workflow: 'web_search', query: 'Diana King' });
  assert.deepEqual(parseDirectComputerWorkflowRequest('เปิด Chrome แล้วค้นหา Diana King ให้หน่อย'), { status: 'ready', workflow: 'web_search', query: 'Diana King' });
  assert.deepEqual(parseDirectComputerWorkflowRequest('เปิด Chrome แล้วค้นหา computer use regression 15 เป็นงานสุดท้าย'), { status: 'ready', workflow: 'web_search', query: 'computer use regression 15' });
  assert.deepEqual(parseDirectComputerWorkflowRequest('@computer-use เปิด Chrome แล้วค้นหา วิธีปลูกมะเขือเทศ'), { status: 'ready', workflow: 'web_search', query: 'วิธีปลูกมะเขือเทศ' });
  assert.deepEqual(parseDirectComputerWorkflowRequest('เปลี่ยนไปค้นหา Persona 5 UI ใน Chrome'), { status: 'ready', workflow: 'web_search', query: 'Persona 5 UI' });
  assert.deepEqual(parseDirectComputerWorkflowRequest('@computer-use open browser and search for SOLAT AI'), { status: 'ready', workflow: 'web_search', query: 'SOLAT AI' });
  assert.equal(parseDirectComputerWorkflowRequest('@computer-use ค้นหา Diana King'), null, 'a browser target is required before the deterministic launch path');
  assert.deepEqual(
    parseDirectComputerWorkflowRequest('@computer-use เปิด Chrome แล้วเข้า YouTube ค้นหาและเล่นเพลง Lllies ดูจนแน่ใจว่าเพลงกำลังเล่นแบบไม่หยุดเอง แล้วจบงาน'),
    { status: 'ready', workflow: 'youtube_music', query: 'Lllies' },
  );
  const result = await new ConversationCore({ config: {}, provider, router: router(), agentBridge: bridge }).send({
    sessionId: 'agent-youtube', content: '@computer-use เปิด chrome แล้วเปิด youtube แล้วเปิดเพลง Lllies', agentMode: true, agentCommand: 'computer-use',
  });
  assert.equal(plannerCalls, 1);
  assert.equal(bridgeCall.name, 'computer_play_youtube_music');
  assert.deepEqual(bridgeCall.arguments, { query: 'Lllies' });
  assert.match(result.assistant, /Lllies/);
  assert.equal(result.agentActions.length, 1);
});

test('an unrelated file request interrupts a pending computer task instead of revising the old YouTube goal', async () => {
  const calls = [];
  let active = true;
  const loop = {
    hasActive: () => active,
    async interruptActive(input) { active = false; calls.push({ type: 'interrupt', input }); return { status: 'CANCELLED' }; },
    async revise() { throw new Error('an unrelated file request must not revise the old computer task'); },
  };
  const provider = {
    status: () => ({ configured: true, provider: 'fake', model: 'fake' }),
    async completeStructured() {
      return { data: { schema_version: 'solat.agent-command-plan.v1', status: 'planned', summary: 'Create page.html.', tool: 'filesystem_create', arguments: { path: 'page.html', content: '<main>ok</main>' } } };
    },
  };
  const bridge = {
    definitions: () => [{ type: 'function', function: { name: 'filesystem_create', parameters: { type: 'object' } } }],
    owns: name => name === 'filesystem_create',
    async execute({ call }) {
      calls.push({ type: 'execute', call });
      return { model_result: { status: 'confirmation_required' }, action: { status: 'confirmation_required', idempotency_key: 'file-new', approval_token: 'once', tool: call.name, arguments: call.arguments } };
    },
  };
  const result = await new ConversationCore({ config: {}, provider, router: router(), agentBridge: bridge, computerTaskLoop: loop }).send({
    sessionId: 'stale-youtube', requestId: 'new-file-request', content: 'สร้างไฟล์ page.html เนื้อหา: <main>ok</main>', agentMode: true,
  });
  assert.deepEqual(calls.map(item => item.type), ['interrupt', 'execute']);
  assert.equal(result.agentActions[0].tool, 'filesystem_create');
  assert.doesNotMatch(result.assistant, /youtube|music/iu);
});

test('a new screen instruction revises only the new goal and workflow', async () => {
  let revised = null;
  const loop = {
    hasActive: () => true,
    async interruptActive() { throw new Error('a screen steering instruction should use revise'); },
    async revise(input) {
      revised = input;
      return { task_id: 'same-task', status: 'AWAITING_APPROVAL', summary: 'Play New Song.', planner_turns: 1, pending_action: { tool: 'computer_play_youtube_music', action: { status: 'confirmation_required', idempotency_key: 'new-song', approval_token: 'once', arguments: { query: 'New Song' } } } };
    },
  };
  const provider = { status: () => ({ configured: true, provider: 'fake', model: 'fake' }) };
  const bridge = { definitions: () => [], owns: () => false };
  const result = await new ConversationCore({ config: {}, provider, router: router(), agentBridge: bridge, computerTaskLoop: loop }).send({
    sessionId: 'replace-youtube', requestId: 'new-song-request', content: 'เปิด YouTube แล้วเล่นเพลง New Song', agentMode: true,
  });
  assert.equal(revised.instruction, 'เปิด YouTube แล้วเล่นเพลง New Song');
  assert.deepEqual(revised.workflowHint, { workflow: 'youtube_music', query: 'New Song' });
  assert.equal(result.agentActions[0].arguments.query, 'New Song');
});

test('a terminal computer-task failure becomes one truthful task response instead of a provider delivery failure', async () => {
  const failure = Object.assign(new Error('The model selected invalid arguments for a computer tool.'), {
    code: 'invalid_tool_arguments',
    computer_task_terminal: { task_id: 'failed-task', status: 'FAILED', summary: 'The model selected invalid arguments for a computer tool.', planner_turns: 1, pending_action: null },
  });
  const loop = { hasActive: () => false, async start() { throw failure; } };
  const provider = { status: () => ({ configured: true, provider: 'fake', model: 'fake' }) };
  const bridge = { definitions: () => [], owns: () => false };
  const result = await new ConversationCore({ config: {}, provider, router: router(), agentBridge: bridge, computerTaskLoop: loop }).send({
    sessionId: 'terminal-error', requestId: 'terminal-error-request', content: 'เปิด Chrome แล้วค้นหา SOLAT', agentMode: true,
  });
  assert.equal(result.provider, 'solat_computer_task');
  assert.match(result.assistant, /invalid arguments/iu);
  assert.equal(result.agentActions.length, 0);
});
