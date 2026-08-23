const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { readConfig } = require('./core/config');
const { createSolatServices } = require('./services');
const { registerSolatIpc } = require('./ipc-router');

let mainWindow;

function createWindow() {
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
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (process.env.SOLAT_DEVTOOLS === '1') mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  const executableDir = path.dirname(process.execPath);
  const userDataEnv = path.join(app.getPath('userData'), '.env');
  const config = readConfig({
    cwd: app.getAppPath(),
    envFiles: [path.join(executableDir, '.env'), userDataEnv],
  });
  const userDataDir = app.getPath('userData');
  const services = createSolatServices({ config, userDataDir, tempDir: app.getPath('temp') });
  registerSolatIpc({
    ipcMain,
    services,
    exportRoot: path.join(userDataDir, 'exports'),
    shellOpenPath: requestedPath => shell.openPath(requestedPath),
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
