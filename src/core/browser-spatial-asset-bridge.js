function bridgeError(code, message) {
  return Object.assign(new Error(message), { code });
}

function browserWorkspaceEventToMultimodal({ type, surface, screen_hash: screenHash } = {}, now = Date.now) {
  if (!['ready', 'takeover', 'control_returned', 'navigation', 'screen_observed'].includes(type)) return null;
  return Object.freeze({
    source: 'screen',
    type: type === 'screen_observed' ? 'screen_observed' : 'surface_activated',
    occurred_at_ms: Math.round(now()),
    payload: Object.freeze({
      surface_id: surface?.surface_id,
      surface_kind: 'browser_workspace',
      navigation_revision: surface?.navigation_revision,
      ...(screenHash ? { screen_hash: screenHash } : {}),
    }),
  });
}

function createBrowserSpatialAssetBridge({ services, now = Date.now } = {}) {
  const core = services?.core;
  const assetStore = services?.assetStore;
  const runtime = services?.spatialAssetRuntime;
  if (!core?.workspace || !assetStore?.storeOriginal || !runtime?.register) {
    throw bridgeError('invalid_browser_asset_bridge', 'Browser SpatialAsset services are unavailable.');
  }

  return async function adoptBrowserSelection({ ownerId, sessionId, sender, surface, selection, capture } = {}) {
    const project = core.workspace.getProject(sessionId);
    const bytes = Buffer.isBuffer(capture?.bytes) ? Buffer.from(capture.bytes) : Buffer.from(capture?.bytes || []);
    if (!bytes.length || capture?.media_type !== 'image/png') {
      throw bridgeError('invalid_browser_asset_capture', 'Browser image capture must be a non-empty PNG.');
    }
    const sourceKind = selection?.source_kind === 'chrome_lane_selection'
      ? 'chrome_lane_selection' : 'browser_workspace_selection';
    const stored = await assetStore.storeOriginal({
      // AssetStore historically scopes immutable chat originals by session;
      // SpatialAssetRuntime independently enforces the renderer principal.
      ownerId: sessionId,
      projectId: project.project_id,
      fileName: `browser-selection-${now()}.png`,
      mimeType: 'image/png',
      bytes,
      sourceMetadata: {
        kind: sourceKind,
        page_url: selection?.page_url,
        element_tag: selection?.tag,
        navigation_revision: surface?.revision,
      },
    });
    core.workspace.linkProject({ sessionId, assetIds: [stored.asset_id] });
    const asset = runtime.register({
      project_id: project.project_id,
      label: selection?.label || 'Browser image',
      original: {
        asset_id: stored.asset_id,
        hash: stored.hash,
        mime_type: stored.mime_type,
        width: capture.width,
        height: capture.height,
      },
      provenance: {
        source_kind: sourceKind,
        source_url: selection?.page_url,
        element_tag: selection?.tag,
        navigation_revision: surface?.revision,
      },
    }, { ownerId, sessionId });
    runtime.select({ ownerId, sessionId, spatialAssetId: asset.spatial_asset_id, surface });
    const held = runtime.beginDrag({
      ownerId,
      sessionId,
      spatialAssetId: asset.spatial_asset_id,
      surface,
      pointer: {
        x: selection.bounds.x + selection.bounds.width / 2,
        y: selection.bounds.y + selection.bounds.height / 2,
        display_id: 'browser-workspace',
      },
      inputSource: 'mouse',
    });
    const event = {
      schema_version: 'solat.browser-asset-selection.v1',
      session_id: sessionId,
      asset,
      ghost: held.ghost,
      surface,
      preview_bytes: Uint8Array.from(bytes),
      media_type: 'image/png',
    };
    if (sender && !sender.isDestroyed?.()) sender.send('solat:browser-asset-selected', event);
    return { spatial_asset_id: asset.spatial_asset_id, ghost_id: held.ghost.ghost_id };
  };
}

module.exports = { browserWorkspaceEventToMultimodal, createBrowserSpatialAssetBridge };
