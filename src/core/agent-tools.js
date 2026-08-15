const MAX_ASSETS = 10;

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

module.exports = { MAX_ASSETS, createReadOnlyAgentTools, normalizeAssetIds };
