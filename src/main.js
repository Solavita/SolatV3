const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { app, BrowserWindow, WebContentsView, globalShortcut, ipcMain, nativeImage, screen, shell } = require('electron');
const { readConfig } = require('./core/config');
const { createSolatServices } = require('./services');
const { registerSolatIpc } = require('./ipc-router');
const { createSpatialOverlayManager } = require('./spatial-overlay-manager');
const { createBrowserWorkspaceManager } = require('./browser-workspace-manager');
const { createChromeControlManager } = require('./chrome-control-manager');
const { createHybridBrowserManager } = require('./hybrid-browser-manager');
const { BrowserWorkspacePort } = require('./core/browser-workspace-tools');
const { browserWorkspaceEventToMultimodal, createBrowserSpatialAssetBridge } = require('./core/browser-spatial-asset-bridge');
const { createChromeSpatialAssetBridge } = require('./core/chrome-spatial-asset-bridge');
const { defaultLaunchRunner, resolveLaunchableApp } = require('./core/computer-use-adapter');

let mainWindow;
let activeServices;
let activeSpatialOverlay;
let activeBrowserWorkspace;
let activeEmbeddedBrowserWorkspace;
let activeChromeControl;

function createWindow() {
  const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#f7f6f2',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
    return webContents === mainWindow.webContents && permission === 'media' && requestingOrigin.startsWith('file:')
      && mediaTypes.length > 0 && mediaTypes.every(type => type === 'audio' || type === 'video');
  });
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
    callback(webContents === mainWindow.webContents && permission === 'media'
      && mediaTypes.length > 0 && mediaTypes.every(type => type === 'audio' || type === 'video'));
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).protocol === 'file:' && path.resolve(fileURLToPath(url)) === path.resolve(rendererPath)) return;
    } catch {}
    event.preventDefault();
  });
  mainWindow.loadFile(rendererPath);
  if (process.env.SOLAT_DEVTOOLS === '1') mainWindow.webContents.openDevTools();
}

app.whenReady().then(async () => {
  const executableDir = path.dirname(process.execPath);
  const userDataEnv = path.join(app.getPath('userData'), '.env');
  const config = readConfig({
    cwd: app.getAppPath(),
    envFiles: [path.join(executableDir, '.env'), userDataEnv],
  });
  const userDataDir = app.getPath('userData');
  // This value is an identity inside the OS-user-scoped Electron profile, not
  // a secret or renderer capability. Unlike webContents.id it remains stable
  // across process restarts, allowing V6 semantic interaction recovery.
  const multimodalOwnerId = 'local-desktop-profile:v1';
  const browserWorkspacePort = new BrowserWorkspacePort();
  const services = createSolatServices({ config, userDataDir, tempDir: app.getPath('temp'), browserWorkspacePort });
  activeServices = services;
  activeSpatialOverlay = createSpatialOverlayManager({ BrowserWindow, screen, appRoot: app.getAppPath() });
  const adoptBrowserSelection = createBrowserSpatialAssetBridge({ services });
  const importChromeImage = createChromeSpatialAssetBridge({ nativeImage, adoptSelection: adoptBrowserSelection });
  const launchChromeUrl = async url => {
    const chrome = resolveLaunchableApp('chrome');
    await defaultLaunchRunner(chrome.executable, { args: ['--profile-directory=Default', '--new-tab', url] });
  };
  activeEmbeddedBrowserWorkspace = createBrowserWorkspaceManager({
    BrowserWindow, WebContentsView, appRoot: app.getAppPath(), profileId: multimodalOwnerId,
    openInChrome: async url => launchChromeUrl(url),
    onTakeover: ({ ownerId, sessionId }) => services.computerTaskLoop.interruptActive({
      ownerId, sessionId, reason: 'The owner took control of the SOLAT Browser Workspace.',
    }),
    onEvent: ({ ownerId, sessionId, type, surface, screen_hash: screenHash }) => {
      const multimodalEvent = browserWorkspaceEventToMultimodal({ type, surface, screen_hash: screenHash });
      if (multimodalEvent) void services.multimodalCoordinator?.record?.(multimodalEvent, { ownerId: multimodalOwnerId, sessionId }).catch(() => {});
    },
    onAssetSelected: adoptBrowserSelection,
  });
  const chromeExtensionPath = app.isPackaged
    ? path.join(process.resourcesPath, 'chrome-extension')
    : path.join(app.getAppPath(), 'chrome-extension');
  activeChromeControl = createChromeControlManager({
    userDataDir,
    extensionPath: chromeExtensionPath,
    openChromeUrl: launchChromeUrl,
    revealExtension: async requestedPath => {
      const failure = await shell.openPath(requestedPath);
      if (failure) throw Object.assign(new Error(failure), { code: 'chrome_control_extension_unavailable' });
    },
    onEvent: ({ ownerId, sessionId, type, surface, screen_hash: screenHash }) => {
      const multimodalEvent = browserWorkspaceEventToMultimodal({ type, surface, screen_hash: screenHash });
      if (multimodalEvent) void services.multimodalCoordinator?.record?.(multimodalEvent, { ownerId: multimodalOwnerId, sessionId }).catch(() => {});
    },
    onAssetSelected: importChromeImage,
  });
  // Failure to reserve the local bridge must not remove the isolated browser
  // path. Pairing can retry start later from an explicit owner action.
  await activeChromeControl.start().catch(() => {});
  activeBrowserWorkspace = createHybridBrowserManager({ chrome: activeChromeControl, embedded: activeEmbeddedBrowserWorkspace });
  browserWorkspacePort.attach(activeBrowserWorkspace);
  registerSolatIpc({
    ipcMain,
    services,
    exportRoot: path.join(userDataDir, 'exports'),
    shellOpenPath: requestedPath => shell.openPath(requestedPath),
    spatialOverlay: activeSpatialOverlay,
    browserWorkspace: activeBrowserWorkspace,
    chromeAssetImport: importChromeImage,
    chromeControl: activeChromeControl,
    chromeExtensionPath,
    revealChromeExtension: requestedPath => shell.openPath(requestedPath),
    multimodalOwnerId,
    handDisplayResolver: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return null;
      const display = screen.getDisplayMatching(mainWindow.getBounds());
      return { id: String(display.id), scale_factor: display.scaleFactor, bounds: { x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height } };
    },
  });
  createWindow();
  const spatialShortcutReady = globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('solat:spatial-shortcut', { available: true });
  });
  if (!spatialShortcutReady) mainWindow.webContents.once('did-finish-load', () => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('solat:spatial-shortcut', { available: false });
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  activeSpatialOverlay?.dispose();
  activeEmbeddedBrowserWorkspace?.dispose();
  void activeChromeControl?.dispose();
  activeServices?.handInputService?.dispose();
  activeServices?.voiceService?.dispose();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
