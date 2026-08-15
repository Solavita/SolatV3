const test = require('node:test');
const assert = require('node:assert/strict');
const { createComputerAgentTools } = require('../src/core/computer-agent-tools');

test('computer agent tools classify reads and writes and dispatch without caller scope', async () => {
  const calls = [];
  const adapter = {
    async playYoutubeMusic(args) { calls.push(['youtube', args.query]); return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'play_youtube_music', playback: 'playing', verified: true }; },
    async launchApp(args) { calls.push(['launch', args.appId]); return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'launch_app', app_id: args.appId, launched: true }; },
    async listWindows() { calls.push('list'); return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'list_windows', windows: [] }; },
    async inspect(args) { calls.push(['inspect', args.hwnd]); return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'inspect', tree: {} }; },
    async invoke(args) { calls.push(['invoke', args.hwnd]); return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'invoke', verified: true }; },
    async setValue(args) { calls.push(['set', args.hwnd]); return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'set_value', verified: true }; },
  };
  const tools = createComputerAgentTools({ adapter });
  assert.equal(tools.registry.computer_list_windows.side_effect_level, 'read');
  assert.equal(tools.registry.computer_invoke.side_effect_level, 'write');
  assert.equal(tools.registry.computer_launch_app.side_effect_level, 'write');
  assert.equal(tools.registry.computer_play_youtube_music.side_effect_level, 'write');
  const youtube = await tools.executeTool({ tool: 'computer_play_youtube_music', arguments: { query: 'Lllies' } });
  assert.equal(youtube.playback, 'playing');
  const launched = await tools.executeTool({ tool: 'computer_launch_app', arguments: { app_id: 'chrome' } });
  assert.equal(launched.operation, 'launch_app');
  assert.deepEqual(calls[0], ['youtube', 'Lllies']);
  assert.deepEqual(calls[1], ['launch', 'chrome']);
  const result = await tools.executeTool({ tool: 'computer_inspect', arguments: { hwnd: 42 } });
  assert.equal(result.operation, 'inspect');
  assert.deepEqual(calls[2], ['inspect', 42]);
  assert.equal(tools.definitions.length, 6);
  assert.equal(tools.registry.computer_invoke.validate_arguments({ hwnd: 42, selector: 'save' }), false);
  assert.equal(tools.registry.computer_invoke.validate_arguments({ hwnd: 42, selector: 'save', verify_selector: 'saved', verify_state: 'present' }), true);
});
