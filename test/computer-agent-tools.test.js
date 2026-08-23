const test = require('node:test');
const assert = require('node:assert/strict');
const { createComputerAgentTools } = require('../src/core/computer-agent-tools');

test('computer agent tools classify reads and writes and dispatch without caller scope', async () => {
  const calls = [];
  const adapter = {
    async searchWeb(args) { calls.push(['search', args.query]); return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'search_web', query: args.query, verified: true, hwnd: 41 }; },
    async playYoutubeMusic(args) { calls.push(['youtube', args.query]); return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'play_youtube_music', playback: 'playing', verified: true }; },
    async launchApp(args) { calls.push(['launch', args.appId]); return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'launch_app', app_id: args.appId, launched: true, verified: true, hwnd: 42 }; },
    async openWebsite(args) { calls.push(['website', args.site]); return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'open_website', site: args.site, verified: true }; },
    async listWindows() { calls.push('list'); return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'list_windows', windows: [] }; },
    async inspect(args) { calls.push(['inspect', args.hwnd]); return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'inspect', tree: {} }; },
    async invoke(args) { calls.push(['invoke', args.hwnd]); return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'invoke', verified: true }; },
    async setValue(args) { calls.push(['set', args.hwnd]); return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'set_value', verified: true }; },
    async pressEnter(args) { calls.push(['enter', args.hwnd]); return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'press_enter', verified: true }; },
    async pressHotkey(args) { calls.push(['hotkey', args.chord]); return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'press_hotkey', verified: true }; },
    async scrollIntoView(args) { calls.push(['scroll', args.hwnd]); return { schema_version: 'solat.computer-result.v1', status: 'ready', operation: 'scroll_into_view', verified: true, tree: {} }; },
  };
  const tools = createComputerAgentTools({ adapter });
  assert.equal(tools.registry.computer_list_windows.side_effect_level, 'read');
  assert.equal(tools.registry.computer_search_web.side_effect_level, 'write');
  assert.equal(tools.registry.computer_invoke.side_effect_level, 'write');
  assert.equal(tools.registry.computer_launch_app.side_effect_level, 'write');
  assert.equal(tools.registry.computer_open_website.side_effect_level, 'write');
  assert.equal(tools.registry.computer_play_youtube_music.side_effect_level, 'write');
  assert.ok(tools.definitions.find(definition => definition.function.name === 'computer_open_website').function.parameters.properties.site.enum.includes('roblox'));
  assert.equal(tools.registry.computer_scroll_into_view.side_effect_level, 'write');
  assert.equal(tools.registry.computer_press_enter.side_effect_level, 'write');
  assert.equal(tools.registry.computer_press_hotkey.side_effect_level, 'write');
  const youtube = await tools.executeTool({ tool: 'computer_play_youtube_music', arguments: { query: 'Lllies' } });
  assert.equal(youtube.playback, 'playing');
  const launched = await tools.executeTool({ tool: 'computer_launch_app', arguments: { app_id: 'chrome' } });
  assert.equal(launched.operation, 'launch_app');
  const classroom = await tools.executeTool({ tool: 'computer_open_website', arguments: { site: 'google_classroom' } });
  assert.equal(classroom.site, 'google_classroom');
  assert.deepEqual(calls[0], ['youtube', 'Lllies']);
  assert.deepEqual(calls[1], ['launch', 'chrome']);
  const result = await tools.executeTool({ tool: 'computer_inspect', arguments: { hwnd: 42 } });
  assert.equal(result.operation, 'inspect');
  assert.deepEqual(calls[2], ['website', 'google_classroom']);
  assert.deepEqual(calls[3], ['inspect', 42]);
  const searched = await tools.executeTool({ tool: 'computer_search_web', arguments: { query: 'Diana King' } });
  assert.equal(searched.query, 'Diana King');
  assert.deepEqual(calls.at(-1), ['search', 'Diana King']);
  const hotkey = await tools.executeTool({ tool: 'computer_press_hotkey', arguments: { hwnd: 42, selector: 'editor', chord: 'ctrl+b', verify_selector: 'bold', verify_property: 'toggle_state', verify_value: 'on' } });
  assert.equal(hotkey.operation, 'press_hotkey');
  assert.deepEqual(calls.at(-1), ['hotkey', 'ctrl+b']);
  assert.equal(tools.definitions.length, 11);
  assert.equal(tools.registry.computer_invoke.validate_arguments({ hwnd: 42, selector: 'save' }), false);
  assert.equal(tools.registry.computer_invoke.validate_arguments({ hwnd: 42, selector: 'save', verify_selector: 'saved', verify_state: 'present' }), true);
});
