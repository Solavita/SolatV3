const MAX_ASSETS = 10;
const FILESYSTEM_RESULT_SCHEMA_VERSION = 'solat.filesystem-result.v1';
const FILESYSTEM_TOOL_DEFINITIONS = Object.freeze([
  { type: 'function', function: { name: 'filesystem_read', description: 'Read one UTF-8 text file from the current owner/session SOLAT workspace. Read-only.', parameters: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 240 } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'filesystem_create', description: 'Create a new TXT, Markdown, JSON, CSV, or HTML file in the current owner/session SOLAT workspace. Never overwrites. Requires owner approval.', parameters: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 240 }, content: { type: 'string', maxLength: 1048576 } }, required: ['path', 'content'], additionalProperties: false } } },
  { type: 'function', function: { name: 'filesystem_update', description: 'Replace an existing workspace text file only when its current SHA-256 matches expected_sha256. Requires owner approval.', parameters: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 240 }, content: { type: 'string', maxLength: 1048576 }, expected_sha256: { type: 'string', minLength: 71, maxLength: 71 } }, required: ['path', 'content', 'expected_sha256'], additionalProperties: false } } },
  { type: 'function', function: { name: 'filesystem_undo', description: 'Restore the most recent private SOLAT workspace snapshot when the current SHA-256 matches expected_sha256. Requires owner approval.', parameters: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 240 }, expected_sha256: { type: 'string', minLength: 71, maxLength: 71 } }, required: ['path', 'expected_sha256'], additionalProperties: false } } },
  { type: 'function', function: { name: 'filesystem_export', description: 'Copy a verified workspace file to the owner/session SOLAT export area without overwriting. Requires owner approval.', parameters: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 240 }, export_name: { type: 'string', minLength: 1, maxLength: 120 }, expected_sha256: { type: 'string', minLength: 71, maxLength: 71 } }, required: ['path', 'export_name', 'expected_sha256'], additionalProperties: false } } },
]);

function normalizeAssetIds(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ASSETS) return null;
  const ids = [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))];
  return ids.length === value.length ? ids : null;
}

function createReadOnlyAgentTools({ fileContextProvider } = {}) {
  if (!fileContextProvider || typeof fileContextProvider.build !== 'function') throw new Error('A file context provider is required.');
  const fileContextRead = {
    side_effect_level: 'read',
    validate_arguments: argumentsValue => Boolean(argumentsValue && normalizeAssetIds(argumentsValue.asset_ids) && String(argumentsValue.project_id || '').trim()),
    validate_output: result => Boolean(result && result.status === 'ready' && typeof result.context === 'string'),
  };
  return {
    registry: { file_context_read: fileContextRead },
    executeTool: async ({ tool, arguments: argumentsValue, plan, signal }) => {
      if (tool !== 'file_context_read') return { status: 'failed', error: { code: 'unauthorized_tool', message: 'Tool is not registered.' } };
      const assetIds = normalizeAssetIds(argumentsValue?.asset_ids);
      const projectId = String(argumentsValue?.project_id || '').trim();
      if (!assetIds || !projectId) return { status: 'failed', error: { code: 'invalid_tool_arguments', message: 'project_id and 1-10 unique asset_ids are required.' } };
      const contextRequest = { ownerId: plan.owner_id, projectId, assetIds };
      if (signal) contextRequest.signal = signal;
      const context = await fileContextProvider.build(contextRequest);
      return { status: 'ready', context, asset_ids: assetIds };
    },
  };
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function noScopeOverride(value) {
  return plainObject(value) && !['owner_id', 'ownerId', 'session_id', 'sessionId', 'root', 'root_dir', 'absolute_path'].some(key => Object.hasOwn(value, key));
}

function relativePathArguments(value, extra = []) {
  if (!noScopeOverride(value) || typeof value.path !== 'string' || !value.path.trim()) return false;
  return extra.every(key => typeof value[key] === 'string');
}

function validExpectedHash(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function filesystemResult(operation, { withContent = false } = {}) {
  return result => Boolean(
    result
    && result.schema_version === FILESYSTEM_RESULT_SCHEMA_VERSION
    && result.status === 'ready'
    && result.operation === operation
    && typeof result.relative_path === 'string'
    && /^sha256:[a-f0-9]{64}$/u.test(result.sha256)
    && Number.isSafeInteger(result.size_bytes)
    && result.size_bytes >= 0
    && (!withContent || typeof result.content === 'string'),
  );
}

function createAgentTools({ fileContextProvider, fileWorkspace } = {}) {
  const readOnly = createReadOnlyAgentTools({ fileContextProvider });
  if (!fileWorkspace || !['create', 'read', 'update', 'undo', 'exportFile'].every(method => typeof fileWorkspace[method] === 'function')) {
    throw new Error('A filesystem workspace with create/read/update/undo/exportFile is required.');
  }
  const registry = {
    ...readOnly.registry,
    filesystem_read: {
      side_effect_level: 'read',
      validate_arguments: value => relativePathArguments(value),
      validate_output: filesystemResult('read', { withContent: true }),
    },
    filesystem_create: {
      side_effect_level: 'write',
      validate_arguments: value => relativePathArguments(value, ['content']),
      validate_output: filesystemResult('create'),
    },
    filesystem_update: {
      side_effect_level: 'write',
      validate_arguments: value => relativePathArguments(value, ['content', 'expected_sha256']) && validExpectedHash(value.expected_sha256),
      validate_output: filesystemResult('update'),
    },
    filesystem_undo: {
      side_effect_level: 'write',
      validate_arguments: value => relativePathArguments(value, ['expected_sha256']) && validExpectedHash(value.expected_sha256),
      validate_output: filesystemResult('undo'),
    },
    filesystem_export: {
      side_effect_level: 'write',
      validate_arguments: value => relativePathArguments(value, ['export_name', 'expected_sha256']) && Boolean(value.export_name.trim()) && validExpectedHash(value.expected_sha256),
      validate_output: filesystemResult('export'),
    },
  };
  return {
    definitions: FILESYSTEM_TOOL_DEFINITIONS.map(value => JSON.parse(JSON.stringify(value))),
    registry,
    executeTool: async ({ tool, arguments: argumentsValue, plan, signal }) => {
      if (tool === 'file_context_read') return readOnly.executeTool({ tool, arguments: argumentsValue, plan, signal });
      const scope = { ownerId: plan?.owner_id, sessionId: plan?.session_id, relativePath: argumentsValue?.path, signal };
      if (tool === 'filesystem_read') return fileWorkspace.read(scope);
      if (tool === 'filesystem_create') return fileWorkspace.create({ ...scope, content: argumentsValue?.content });
      if (tool === 'filesystem_update') return fileWorkspace.update({ ...scope, content: argumentsValue?.content, expectedSha256: argumentsValue?.expected_sha256 });
      if (tool === 'filesystem_undo') return fileWorkspace.undo({ ...scope, expectedSha256: argumentsValue?.expected_sha256 });
      if (tool === 'filesystem_export') return fileWorkspace.exportFile({ ...scope, exportName: argumentsValue?.export_name, expectedSha256: argumentsValue?.expected_sha256 });
      return { status: 'failed', error: { code: 'unauthorized_tool', message: 'Tool is not registered.' } };
    },
  };
}

module.exports = { FILESYSTEM_RESULT_SCHEMA_VERSION, FILESYSTEM_TOOL_DEFINITIONS, MAX_ASSETS, createAgentTools, createReadOnlyAgentTools, normalizeAssetIds };
