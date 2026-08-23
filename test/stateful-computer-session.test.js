const test = require('node:test');
const assert = require('node:assert/strict');
const { ConversationCore } = require('../src/core/conversation-core');

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

test('15 natural turns in one session never leak stale computer-task state', async () => {
  const events = [];
  let active = null;
  let nextTask = 1;
  const terminalFailure = new Set(['request-12']);
  const loop = {
    hasActive() { return Boolean(active); },
    async start(input) {
      events.push({ type: 'start', input });
      if (terminalFailure.has(input.requestId)) {
        const view = {
          task_id: `task-${nextTask++}`, status: 'FAILED', planner_turns: 1,
          summary: 'The target window closed before the action could run.', pending_action: null,
        };
        throw Object.assign(new Error(view.summary), { computer_task_terminal: view });
      }
      active = { id: `task-${nextTask++}`, goal: input.goal, workflowHint: input.workflowHint };
      return taskView(active);
    },
    async revise(input) {
      events.push({ type: 'revise', input });
      if (terminalFailure.has(input.requestId)) {
        const view = {
          task_id: active.id, status: 'FAILED', planner_turns: 1,
          summary: 'The target window closed before the action could run.', pending_action: null,
        };
        active = null;
        throw Object.assign(new Error(view.summary), { computer_task_terminal: view });
      }
      active.goal = input.instruction;
      active.workflowHint = input.workflowHint;
      return taskView(active);
    },
    async interruptActive(input) {
      events.push({ type: 'interrupt', input, task: active });
      active = null;
      return { status: 'CANCELLED' };
    },
  };

  function taskView(task) {
    const query = task.workflowHint?.query || task.goal;
    return {
      task_id: task.id, status: 'AWAITING_APPROVAL', planner_turns: 1,
      summary: `Ready: ${query}`,
      pending_action: {
        tool: task.workflowHint?.workflow === 'youtube_music'
          ? 'computer_play_youtube_music' : 'computer_search_web',
        action: {
          status: 'confirmation_required', idempotency_key: `${task.id}:${query}`,
          approval_token: 'once', arguments: { query },
        },
      },
    };
  }

  const provider = {
    status: () => ({ configured: true, provider: 'fake', model: 'fake' }),
    async complete(messages) {
      return { content: `CHAT:${messages.at(-1).content}`, provider: 'fake', model: 'fake' };
    },
    async completeStructured() {
      return {
        data: {
          schema_version: 'solat.agent-command-plan.v1', status: 'planned',
          summary: 'Create note.txt.', tool: 'filesystem_create',
          arguments: { path: 'note.txt', content: 'fresh content' },
        },
      };
    },
  };
  const bridge = {
    definitions: () => [{
      type: 'function',
      function: { name: 'filesystem_create', parameters: { type: 'object' } },
    }],
    owns: name => name === 'filesystem_create',
    async execute({ call }) {
      return {
        model_result: { status: 'confirmation_required' },
        action: {
          status: 'confirmation_required', idempotency_key: `file:${call.arguments.path}`,
          approval_token: 'once', tool: call.name, arguments: call.arguments,
        },
      };
    },
  };
  const core = new ConversationCore({ config: {}, provider, router: router(), agentBridge: bridge, computerTaskLoop: loop });
  const send = (content, index) => core.send({
    sessionId: 'stateful-15', requestId: `request-${index}`, content, agentMode: true,
  });

  const results = [];
  results.push(await send('เปิด Chrome แล้วเข้า YouTube ค้นหาและเล่นเพลง Lllies', 1));
  results.push(await send('เปลี่ยนเป็นเพลง Lllies (Acoustic Live) บน YouTube', 2));
  results.push(await send('เปิด Chrome แล้วค้นหา Diana King', 3));
  results.push(await send('สร้างไฟล์ note.txt เนื้อหา: fresh content', 4));
  results.push(await send('สรุปว่าคำสั่งก่อนหน้าทำอะไร', 5));
  results.push(await send('เปิด Chrome แล้วค้นหา SOLAT AI', 6));
  results.push(await send('เปิด YouTube แล้วเล่นเพลง 500 Miles', 7));
  results.push(await send('เปลี่ยนไปค้นหา Persona 5 UI ใน Chrome', 8));
  results.push(await send('ตอบสั้น ๆ ว่าตอนนี้กำลังทำอะไร', 9));
  results.push(await send('เปิด Chrome แล้วค้นหา Qwen local inference', 10));
  results.push(await send('เปิด YouTube แล้วเล่นเพลง Lllies', 11));
  results.push(await send('เปิด Chrome แล้วค้นหา stale window recovery', 12));
  results.push(await send('เปิด Chrome แล้วค้นหา task ใหม่หลัง error', 13));
  results.push(await send('เปลี่ยนเป็นค้นหา computer use regression ใน Chrome', 14));
  results.push(await send('สร้างไฟล์ note.txt เนื้อหา: fresh content', 15));

  assert.equal(results.length, 15);
  assert.equal(events.filter(event => event.type === 'start').length, 4);
  assert.equal(events.filter(event => event.type === 'revise').length, 7);
  assert.equal(events.filter(event => event.type === 'interrupt').length, 3);

  assert.equal(events.find(event => event.input?.requestId === 'request-1').input.workflowHint.query, 'Lllies');
  assert.equal(events.find(event => event.input?.requestId === 'request-2').input.workflowHint.query, 'Lllies (Acoustic Live)');
  assert.equal(events.find(event => event.input?.requestId === 'request-3').input.workflowHint.query, 'Diana King');
  assert.equal(events.find(event => event.input?.requestId === 'request-8').input.workflowHint.query, 'Persona 5 UI');
  assert.equal(events.find(event => event.input?.requestId === 'request-14').input.workflowHint.query, 'computer use regression');

  assert.equal(results[3].agentActions[0].tool, 'filesystem_create');
  assert.doesNotMatch(results[3].assistant, /Lllies|YouTube/iu);
  assert.match(results[4].assistant, /^CHAT:/u);
  assert.equal(results[11].provider, 'solat_computer_task');
  assert.match(results[11].assistant, /target window closed/iu);
  assert.equal(results[11].agentActions.length, 0);
  assert.match(results[12].assistant, /task ใหม่หลัง error/u);
  assert.equal(results[14].agentActions[0].tool, 'filesystem_create');
  assert.equal(active, null);
});
