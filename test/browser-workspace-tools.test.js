const test = require('node:test');
const assert = require('node:assert/strict');
const { BrowserWorkspacePort, createBrowserWorkspaceTools } = require('../src/core/browser-workspace-tools');

test('browser tools reuse the existing plan owner/session and never accept renderer ownership arguments', async () => {
  const calls = [];
  const manager = {
    async openForOwner(value) { calls.push(['open', value]); return { schema_version: 'solat.browser-surface.v1', status: 'ready', surface_id: 'surface-1' }; },
    async observe(value) { calls.push(['observe', value]); return { schema_version: 'solat.browser-observation.v1', items: [] }; },
  };
  const port = new BrowserWorkspacePort(); port.attach(manager);
  const tools = createBrowserWorkspaceTools({ port });
  const plan = { owner_id: 'renderer:7', session_id: 'thread-a' };
  await tools.executeTool({ tool: 'browser_workspace_open', arguments: { url: 'https://example.com/' }, plan });
  await tools.executeTool({ tool: 'browser_workspace_observe', arguments: { surface_id: 'surface-1' }, plan });
  assert.deepEqual(calls, [
    ['open', { ownerId: 'renderer:7', request: { sessionId: 'thread-a', url: 'https://example.com/', mode: 'focused' } }],
    ['observe', { ownerId: 'renderer:7', request: { sessionId: 'thread-a', surfaceId: 'surface-1' } }],
  ]);
  assert.equal(tools.definitions.some(item => Object.hasOwn(item.function.parameters.properties, 'owner_id')), false);
  assert.equal(tools.registry.browser_workspace_observe.side_effect_level, 'read');
  assert.equal(tools.registry.browser_workspace_click.task_grant_eligible, false);
});

test('browser tool port fails visibly before the main-process manager is attached', async () => {
  const tools = createBrowserWorkspaceTools({ port: new BrowserWorkspacePort() });
  await assert.rejects(() => tools.executeTool({ tool: 'browser_workspace_open', arguments: { url: 'https://example.com/' }, plan: { owner_id: 'renderer:7', session_id: 'thread-a' } }), error => error.code === 'browser_workspace_unavailable');
});

test('browser visual tool is read-only and preserves the surface/navigation binding', async () => {
  const calls = [];
  const manager = {
    async openForOwner() { return { schema_version: 'solat.browser-surface.v1', status: 'ready', surface_id: 'surface-1', verified: true }; },
    async visualObserve(value) {
      calls.push(value);
      return {
        schema_version: 'solat.browser-visual-observation.v1', status: 'ready', verified: true,
        surface_id: 'surface-1', navigation_revision: 3,
        capture_id: 'capture-1',
        sha256: `sha256:${'a'.repeat(64)}`,
      };
    },
    getVisualCapture() { return { metadata: {}, bytes: Buffer.from('png') }; },
  };
  const port = new BrowserWorkspacePort(); port.attach(manager);
  const tools = createBrowserWorkspaceTools({ port });
  const result = await tools.executeTool({
    tool: 'browser_workspace_visual_observe',
    arguments: { surface_id: 'surface-1', navigation_revision: 3 },
    plan: { owner_id: 'renderer:7', session_id: 'thread-a' },
  });
  assert.equal(result.schema_version, 'solat.browser-visual-observation.v1');
  assert.deepEqual(calls, [{ ownerId: 'renderer:7', request: { sessionId: 'thread-a', surfaceId: 'surface-1', navigationRevision: 3 } }]);
  assert.equal(tools.registry.browser_workspace_visual_observe.side_effect_level, 'read');
  assert.equal(tools.registry.browser_workspace_visual_observe.validate_output(result), true);
});

test('full Chrome tab tools are versioned, owner/session scoped, and expose opaque tab_ref only', async () => {
  const calls = [];
  const manager = {
    async openForOwner() { return { schema_version: 'solat.browser-surface.v1', status: 'ready', surface_id: 'surface-1', verified: true }; },
    async listTabsForOwner(value) {
      calls.push(['list-tabs', value]);
      return {
        schema_version: 'solat.chrome-tab-list.v1', status: 'ready', verified: true,
        session_id: 'thread-a', full_control: true, tab_count: 1, total_count: 1, truncated: false,
        tabs: [{ tab_ref: 'chrome_tab_opaque', status: 'ready', privacy: 'standard', controllable: true, active: true }],
      };
    },
    async switchTabForOwner(value) {
      calls.push(['switch-tab', value]);
      return { schema_version: 'solat.browser-surface.v1', status: 'ready', verified: true, surface_id: 'surface-2' };
    },
  };
  const port = new BrowserWorkspacePort(); port.attach(manager);
  const tools = createBrowserWorkspaceTools({ port });
  const plan = { owner_id: 'renderer:7', session_id: 'thread-a' };
  const listed = await tools.executeTool({ tool: 'browser_workspace_list_tabs', arguments: {}, plan });
  const switched = await tools.executeTool({ tool: 'browser_workspace_switch_tab', arguments: { tab_ref: 'chrome_tab_opaque' }, plan });

  assert.equal(listed.schema_version, 'solat.chrome-tab-list.v1');
  assert.equal(tools.registry.browser_workspace_list_tabs.side_effect_level, 'read');
  assert.equal(tools.registry.browser_workspace_switch_tab.side_effect_level, 'write');
  assert.equal(tools.registry.browser_workspace_switch_tab.task_grant_eligible, false);
  assert.equal(tools.registry.browser_workspace_list_tabs.validate_output(listed), true);
  assert.equal(tools.registry.browser_workspace_list_tabs.validate_output({
    ...listed, tabs: [{ ...listed.tabs[0], tab_id: 'raw-chrome-id' }],
  }), false);
  assert.equal(tools.registry.browser_workspace_switch_tab.validate_output(switched), true);
  assert.deepEqual(calls, [
    ['list-tabs', { ownerId: 'renderer:7', request: { sessionId: 'thread-a' } }],
    ['switch-tab', { ownerId: 'renderer:7', request: { sessionId: 'thread-a', tabRef: 'chrome_tab_opaque' } }],
  ]);

  const listDefinition = tools.definitions.find(item => item.function.name === 'browser_workspace_list_tabs');
  const switchDefinition = tools.definitions.find(item => item.function.name === 'browser_workspace_switch_tab');
  assert.deepEqual(Object.keys(listDefinition.function.parameters.properties), []);
  assert.deepEqual(Object.keys(switchDefinition.function.parameters.properties), ['tab_ref']);
  assert.equal(Object.hasOwn(switchDefinition.function.parameters.properties, 'tab_id'), false);
  assert.equal(tools.registry.browser_workspace_switch_tab.validate_arguments({ tab_ref: 'opaque', tab_id: 'raw-id' }), false);
});

test('full Chrome tab tools fail visibly when the manager lacks the tab capability', async () => {
  const port = new BrowserWorkspacePort(); port.attach({ openForOwner() {} });
  const tools = createBrowserWorkspaceTools({ port });
  await assert.rejects(
    () => tools.executeTool({ tool: 'browser_workspace_list_tabs', arguments: {}, plan: { owner_id: 'renderer:7', session_id: 'thread-a' } }),
    error => error.code === 'browser_tabs_unavailable',
  );
});
