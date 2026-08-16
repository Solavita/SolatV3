const test = require('node:test');
const assert = require('node:assert/strict');
const { planAgentCommand, validatePlannedCommand, requestedYoutubeMusicQuery, requestedWebsite } = require('../src/core/agent-command-planner');

test('Agent command planner identifies explicit website requests separately from app launch', () => {
  assert.equal(requestedWebsite('เปิด Google ใน Chrome เพื่อทดสอบ'), 'google');
  assert.equal(requestedWebsite('เปิด YouTube ใน Chrome'), 'youtube');
  assert.equal(requestedWebsite('เปิด YouTube แล้วเปิดเพลง Lllies'), null);
});

test('Agent command planner rejects a Chrome-only plan for an explicit Google request', () => {
  assert.throws(
    () => validatePlannedCommand(
      { status: 'planned', tool: 'computer_launch_app', arguments: { app_id: 'chrome' } },
      'computer-use',
      'เปิด Google ใน Chrome เพื่อทดสอบ',
    ),
    /requires opening google/i,
  );
});

test('Agent command planner rejects a Chrome-only plan for an explicit YouTube request', () => {
  assert.throws(
    () => validatePlannedCommand(
      { status: 'planned', tool: 'computer_launch_app', arguments: { app_id: 'chrome' } },
      'computer-use',
      'เปิด YouTube ใน Chrome',
    ),
    /requires opening youtube/i,
  );
});

test('YouTube playback detector recognises Thai requests that omit the word song', () => {
  assert.equal(requestedYoutubeMusicQuery('เปิด YouTube แล้วเปิด Lllies'), 'Lllies');
  assert.equal(requestedYoutubeMusicQuery('เปิด YouTube เเล้วเล่นเพลง Lllies'), 'Lllies');
  assert.equal(requestedYoutubeMusicQuery('Open YouTube then play Lllies'), 'Lllies');
  assert.equal(requestedYoutubeMusicQuery('เปิด YouTube'), null);
});

test('Agent command planner preserves the requested YouTube query instead of substituting a default', async () => {
  let plannerMessages;
  let plannerSchema;
  const provider = {
    async completeStructured(messages, schema) {
      plannerMessages = messages;
      plannerSchema = schema;
      return { data: {
        schema_version: 'solat.agent-command-plan.v1',
        status: 'planned',
        summary: 'จะค้นหาเพลง Lllies บน YouTube',
        tool: 'computer_play_youtube_music',
        arguments: { query: 'Lllies' },
      } };
    },
  };

  const plan = await planAgentCommand({
    provider,
    command: 'computer-use',
    messages: [{ role: 'user', content: 'เปิด Chrome แล้วเปิด YouTube แล้วเปิดเพลง Lllies' }],
  });

  assert.equal(plan.arguments.query, 'Lllies');
  assert.equal(plan.tool, 'computer_play_youtube_music');
  assert.equal(plannerSchema.properties.arguments.properties.query.maxLength, 160);
  assert.match(plannerMessages[0].content, /never replace a requested song with a default such as lofi/i);
});

test('Agent command planner retries one malformed structured response and then stops', async () => {
  let calls = 0;
  const provider = {
    async completeStructured(messages) {
      calls += 1;
      if (calls === 1) {
        const error = new Error('invalid structured JSON');
        error.code = 'malformed_response';
        throw error;
      }
      assert.match(messages.at(-1).content, /previous planner response was invalid/i);
      return { data: { schema_version: 'solat.agent-command-plan.v1', status: 'planned', summary: 'จะเปิด Chrome', tool: 'computer_launch_app', arguments: { app_id: 'chrome' } } };
    },
  };
  const plan = await planAgentCommand({ provider, command: 'computer-use', messages: [{ role: 'user', content: 'เปิด chrome' }] });
  assert.equal(calls, 2);
  assert.equal(plan.tool, 'computer_launch_app');
});

test('Agent command planner rejects incomplete and cross-capability plans', () => {
  assert.throws(
    () => validatePlannedCommand({ status: 'planned', tool: 'computer_play_youtube_music', arguments: { query: 'Lllies' } }, 'create-file'),
    /complete create-file plan/,
  );
  assert.throws(
    () => validatePlannedCommand({ status: 'planned', tool: 'filesystem_create', arguments: { path: 'note.txt', content: 'hello' } }, 'computer-use'),
    /unsupported computer action/,
  );
});

test('Agent command planner repairs an incomplete launch-only plan for a YouTube music request', async () => {
  let calls = 0;
  const provider = {
    async completeStructured(messages) {
      calls += 1;
      if (calls === 1) return { data: { schema_version: 'solat.agent-command-plan.v1', status: 'planned', summary: 'จะเปิด Chrome', tool: 'computer_launch_app', arguments: { app_id: 'chrome' } } };
      assert.match(messages.at(-1).content, /requires the YouTube music workflow/i);
      return { data: { schema_version: 'solat.agent-command-plan.v1', status: 'planned', summary: 'จะเปิดเพลง Lllies', tool: 'computer_play_youtube_music', arguments: { query: 'Lllies' } } };
    },
  };
  const plan = await planAgentCommand({ provider, command: 'computer-use', messages: [{ role: 'user', content: 'เปิด Chrome แล้วเปิด YouTube แล้วเปิดเพลง Lllies' }] });
  assert.equal(calls, 2);
  assert.equal(plan.tool, 'computer_play_youtube_music');
  assert.equal(plan.arguments.query, 'Lllies');
});

test('auto Agent mode repairs a homepage-only plan for a Thai YouTube playback request', async () => {
  let calls = 0;
  const provider = {
    async completeStructured(messages) {
      calls += 1;
      if (calls === 1) return { data: {
        schema_version: 'solat.agent-command-plan.v1', status: 'planned', summary: 'Open YouTube.',
        tool: 'computer_open_website', arguments: { site: 'youtube' },
      } };
      assert.match(messages.at(-1).content, /requires the YouTube music workflow/i);
      return { data: {
        schema_version: 'solat.agent-command-plan.v1', status: 'planned', summary: 'Play Lllies.',
        tool: 'computer_play_youtube_music', arguments: { query: 'Lllies' },
      } };
    },
  };
  const plan = await planAgentCommand({
    provider,
    command: 'auto',
    messages: [{ role: 'user', content: 'เปิด YouTube แล้วเปิด Lllies' }],
  });
  assert.equal(calls, 2);
  assert.equal(plan.tool, 'computer_play_youtube_music');
  assert.equal(plan.arguments.query, 'Lllies');
});

test('Agent command plan rejects a substituted YouTube query', () => {
  assert.throws(
    () => validatePlannedCommand(
      { status: 'planned', tool: 'computer_play_youtube_music', arguments: { query: 'lofi music' } },
      'computer-use',
      'เปิด YouTube แล้วเปิดเพลง Lllies',
    ),
    /preserve a phrase from the user request exactly/,
  );
});

test('Computer planner permits Google Classroom only through the fixed website catalog', async () => {
  const provider = {
    async completeStructured() {
      return { data: {
        schema_version: 'solat.agent-command-plan.v1', status: 'planned', summary: 'Open Google Classroom first.',
        tool: 'computer_open_website', arguments: { site: 'google_classroom' },
      } };
    },
  };
  const plan = await planAgentCommand({ provider, command: 'computer-use', messages: [{ role: 'user', content: 'Open Google Classroom and find Physics.' }] });
  assert.equal(plan.tool, 'computer_open_website');
  assert.equal(plan.arguments.site, 'google_classroom');
  assert.throws(
    () => validatePlannedCommand({ status: 'planned', tool: 'computer_open_website', arguments: { site: 'any-site' } }, 'computer-use'),
    /unsupported website/,
  );
});
