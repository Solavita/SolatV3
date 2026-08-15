const test = require('node:test');
const assert = require('node:assert/strict');
const { ConversationCore, parseDirectComputerLaunchRequest, parseDirectComputerWorkflowRequest, parseDirectFileCreateRequest, requestsAgentCapability } = require('../src/core/conversation-core');

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

test('Computer-use launch command is model-planned before approval', async () => {
  let plannerCalls = 0;
  let bridgeCall = null;
  const provider = {
    status: () => ({ configured: true, provider: 'fake', model: 'fake' }),
    async completeStructured() {
      plannerCalls += 1;
      return { data: { schema_version: 'solat.agent-command-plan.v1', status: 'planned', summary: 'จะเปิด Chrome', tool: 'computer_launch_app', arguments: { app_id: 'chrome' } } };
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
  assert.equal(plannerCalls, 1);
  assert.equal(bridgeCall.name, 'computer_launch_app');
  assert.deepEqual(bridgeCall.arguments, { app_id: 'chrome' });
  assert.equal(result.agentActions.length, 1);
  assert.equal(result.agentCommand, 'computer-use');
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
  const result = await new ConversationCore({ config: {}, provider, router: router(), agentBridge: bridge }).send({
    sessionId: 'agent-youtube', content: '@computer-use เปิด chrome แล้วเปิด youtube แล้วเปิดเพลง Lllies', agentMode: true, agentCommand: 'computer-use',
  });
  assert.equal(plannerCalls, 1);
  assert.equal(bridgeCall.name, 'computer_play_youtube_music');
  assert.deepEqual(bridgeCall.arguments, { query: 'Lllies' });
  assert.match(result.assistant, /Lllies/);
  assert.equal(result.agentActions.length, 1);
});
