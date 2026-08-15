const TOOL_RESULT_VERSION = 'solat.computer-result.v1';

function object(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function validHwnd(value) { return Number.isSafeInteger(Number(value)) && Number(value) > 0; }
function validSelector(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 300; }
function ready(result, operation) { return result?.schema_version === TOOL_RESULT_VERSION && result?.status === 'ready' && result?.operation === operation; }

const definitions = [
  {
    type: 'function',
    function: {
      name: 'computer_play_youtube_music',
      description: 'Open Chrome with the fixed local Default profile, open an approved YouTube music page, start playback when needed, and verify that playback is active. This changes computer state and always requires owner approval.',
      parameters: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 160 } }, required: ['query'], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'computer_launch_app',
      description: 'Launch one explicitly allowlisted local application without arguments. This changes computer state and always requires owner approval.',
      parameters: { type: 'object', properties: { app_id: { type: 'string', enum: ['chrome', 'notepad'] } }, required: ['app_id'], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'computer_list_windows',
      description: 'List currently visible, non-sensitive Windows application windows. Read-only. Use this before inspecting or changing an app.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'computer_inspect',
      description: 'Read the bounded interactive UI Automation tree of one visible window by HWND. Read-only; never use on credential or protected windows.',
      parameters: { type: 'object', properties: { hwnd: { type: 'integer', minimum: 1 }, selector: { type: 'string', minLength: 1, maxLength: 300 }, depth: { type: 'integer', minimum: 1, maximum: 8 } }, required: ['hwnd'], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'computer_invoke',
      description: 'Invoke one semantic UI element in an explicitly identified visible window, then verify an expected UI state. This changes computer state and always requires owner approval.',
      parameters: { type: 'object', properties: { hwnd: { type: 'integer', minimum: 1 }, selector: { type: 'string', minLength: 1, maxLength: 300 }, verify_selector: { type: 'string', minLength: 1, maxLength: 300 }, verify_state: { type: 'string', enum: ['present', 'gone', 'value'] }, verify_value: { type: 'string', minLength: 1, maxLength: 4000 } }, required: ['hwnd', 'selector', 'verify_selector', 'verify_state'], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'computer_set_value',
      description: 'Set text/value on one semantic UI element in an explicitly identified visible window. This changes computer state and always requires owner approval. Password fields are forbidden.',
      parameters: { type: 'object', properties: { hwnd: { type: 'integer', minimum: 1 }, selector: { type: 'string', minLength: 1, maxLength: 300 }, value: { type: 'string', minLength: 1, maxLength: 4000 } }, required: ['hwnd', 'selector', 'value'], additionalProperties: false },
    },
  },
];

function createComputerAgentTools({ adapter } = {}) {
  if (!adapter || typeof adapter.listWindows !== 'function') throw new Error('A computer-use adapter is required.');
  const registry = {
    computer_play_youtube_music: { side_effect_level: 'write', validate_arguments: value => object(value) && typeof value.query === 'string' && value.query.trim().length > 0 && value.query.length <= 160 && Object.keys(value).length === 1, validate_output: value => ready(value, 'play_youtube_music') && value.verified === true && value.playback === 'playing' },
    computer_launch_app: { side_effect_level: 'write', validate_arguments: value => object(value) && ['chrome', 'notepad'].includes(value.app_id), validate_output: value => ready(value, 'launch_app') && value.launched === true },
    computer_list_windows: { side_effect_level: 'read', validate_arguments: value => object(value) && Object.keys(value).length === 0, validate_output: value => ready(value, 'list_windows') },
    computer_inspect: { side_effect_level: 'read', validate_arguments: value => object(value) && validHwnd(value.hwnd) && (value.selector === undefined || validSelector(value.selector)), validate_output: value => ready(value, 'inspect') },
    computer_invoke: { side_effect_level: 'write', validate_arguments: value => object(value) && validHwnd(value.hwnd) && validSelector(value.selector) && validSelector(value.verify_selector) && ['present', 'gone', 'value'].includes(value.verify_state) && (value.verify_state !== 'value' || validSelector(value.verify_value)), validate_output: value => ready(value, 'invoke') && value.verified === true },
    computer_set_value: { side_effect_level: 'write', validate_arguments: value => object(value) && validHwnd(value.hwnd) && validSelector(value.selector) && typeof value.value === 'string' && value.value.length > 0 && value.value.length <= 4000, validate_output: value => ready(value, 'set_value') && value.verified === true },
  };
  return {
    definitions,
    registry,
    async executeTool({ tool, arguments: args = {}, signal }) {
      if (!registry[tool]) return { status: 'failed', error: { code: 'unauthorized_tool', message: 'Computer tool is not registered.' } };
      if (tool === 'computer_play_youtube_music') return adapter.playYoutubeMusic({ query: args.query, signal });
      if (tool === 'computer_launch_app') return adapter.launchApp({ appId: args.app_id, signal });
      if (tool === 'computer_list_windows') return adapter.listWindows({ signal });
      if (tool === 'computer_inspect') return adapter.inspect({ ...args, signal });
      if (tool === 'computer_invoke') return adapter.invoke({ hwnd: args.hwnd, selector: args.selector, verifySelector: args.verify_selector, verifyState: args.verify_state, verifyValue: args.verify_value, signal });
      if (tool === 'computer_set_value') return adapter.setValue({ ...args, signal });
      return { status: 'failed', error: { code: 'unauthorized_tool', message: 'Computer tool is not registered.' } };
    },
  };
}

module.exports = { createComputerAgentTools, definitions };
