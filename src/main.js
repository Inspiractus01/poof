const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, screen, shell } = require('electron');
const path = require('path');

const { Settings } = require('./lib/settings');
const { AppIcons } = require('./lib/appicons');
const { listApps, quitApps, isPermissionError } = require('./lib/apps');
const { UsageTracker } = require('./lib/usage');
const { Updater } = require('./lib/updater');

const WINDOW_WIDTH = 332;
const WINDOW_HEIGHT = 496;

let tray = null;
let win = null;
let settings = null;
let icons = null;
let tracker = null;
let updater = null;
let busy = false;

// --- data ------------------------------------------------------------------
async function collect() {
  const apps = await icons.decorate(await listApps());
  const keep = settings.get('keep');
  const rules = settings.get('rules');
  const lastUsed = settings.get('lastUsed');

  return apps.map((entry) => {
    const minutes = Number(rules[entry.id]) || 0;
    const idleMs = lastUsed[entry.id] ? Date.now() - lastUsed[entry.id] : 0;
    return {
      ...entry,
      keep: keep.includes(entry.id),
      minutes,
      idleMs,
      // How far this app has drifted toward its own deadline, 0..1.
      progress: minutes ? Math.min(1, idleMs / (minutes * 60 * 1000)) : 0,
    };
  });
}

async function quitAll() {
  const apps = await collect();
  const targets = apps.filter((a) => !a.keep);
  const result = await quitApps(targets, { force: settings.get('forceQuit') });
  return { ...result, kept: apps.length - targets.length };
}

// --- popover ---------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    transparent: true,
    hasShadow: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Keep the popover up while work is in flight -- the macOS permission dialog
  // steals focus, and hiding on blur would throw the answer away.
  win.on('blur', () => {
    if (!busy) win.hide();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function positionWindow() {
  const trayBounds = tray.getBounds();
  const area = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y }).workArea;

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - WINDOW_WIDTH / 2);
  x = Math.max(area.x + 8, Math.min(x, area.x + area.width - WINDOW_WIDTH - 8));
  win.setPosition(x, Math.round(trayBounds.y + trayBounds.height + 4), false);
}

function toggleWindow() {
  if (win.isVisible()) {
    win.hide();
    return;
  }
  positionWindow();
  win.show();
  win.focus();
  win.webContents.send('window:shown');
}

function createTray() {
  const image = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'trayTemplate.png'));
  image.setTemplateImage(true);

  tray = new Tray(image);
  tray.setToolTip('Poof');
  tray.on('click', toggleWindow);
  tray.on('right-click', () => {
    tray.popUpContextMenu(Menu.buildFromTemplate([
      { label: 'Open Poof', click: toggleWindow },
      { type: 'separator' },
      { label: `Version ${app.getVersion()}`, enabled: false },
      { label: 'Check for updates', click: () => updater.check() },
      { type: 'separator' },
      { label: 'Quit Poof', click: () => app.quit() },
    ]));
  });
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, silent: true }).show();
}

// --- IPC -------------------------------------------------------------------
ipcMain.handle('apps:list', async () => {
  busy = true;
  try {
    return { apps: await collect(), error: null, needsPermission: false };
  } catch (err) {
    return { apps: [], error: String(err.message || err), needsPermission: isPermissionError(err) };
  } finally {
    busy = false;
  }
});

ipcMain.handle('apps:quitAll', async () => {
  busy = true;
  try {
    const result = await quitAll();
    const failure = result.errors.find((e) => isPermissionError(e));
    return { ...result, error: null, needsPermission: Boolean(failure) };
  } catch (err) {
    return {
      quit: 0, kept: 0, stuck: [], errors: [],
      error: String(err.message || err),
      needsPermission: isPermissionError(err),
    };
  } finally {
    busy = false;
  }
});

ipcMain.handle('keep:toggle', (_event, id) => {
  const keep = settings.get('keep');
  const next = keep.includes(id) ? keep.filter((k) => k !== id) : [...keep, id];
  settings.set({ keep: next });
  return next;
});

ipcMain.handle('rule:set', (_event, id, minutes) => {
  const rules = { ...settings.get('rules') };
  if (minutes) rules[id] = minutes;
  else delete rules[id];
  settings.set({ rules });
  return rules;
});

ipcMain.handle('settings:get', () => ({ ...settings.values, version: app.getVersion() }));
ipcMain.handle('settings:set', (_event, patch) => settings.set(patch));

ipcMain.handle('update:check', () => updater.check());
ipcMain.handle('update:state', () => updater.state);
ipcMain.handle('update:install', async () => {
  try {
    await updater.install();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

// Deep link straight to System Settings > Privacy & Security > Automation.
ipcMain.on('system:openAutomationSettings', () => {
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Automation');
});

ipcMain.on('app:relaunch', () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.on('window:hide', () => win && win.hide());
ipcMain.on('app:quit', () => app.quit());

// --- lifecycle -------------------------------------------------------------
// `Poof.app/Contents/MacOS/Poof --probe` prints what the app sees, with timings.
async function probe() {
  const started = Date.now();
  try {
    const apps = await collect();
    console.log(JSON.stringify({
      ms: Date.now() - started,
      count: apps.length,
      apps: apps.map((a) => ({ name: a.name, icon: Boolean(a.icon), minutes: a.minutes, keep: a.keep })),
    }, null, 2));
  } catch (err) {
    console.log(JSON.stringify({
      ms: Date.now() - started,
      error: String(err.message || err),
      needsPermission: isPermissionError(err),
    }, null, 2));
  }
  app.exit(0);
}

function boot() {
  settings = new Settings(app.getPath('userData'));
  icons = new AppIcons(path.join(app.getPath('userData'), 'icons'));
}

if (process.argv.includes('--probe')) {
  app.whenReady().then(() => {
    boot();
    probe();
  });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => win && toggleWindow());

  app.whenReady().then(() => {
    if (app.dock) app.dock.hide(); // menu bar only
    boot();

    tracker = new UsageTracker({
      settings,
      onAutoQuit: (closed) => {
        const names = closed.map((a) => a.name).join(', ');
        notify('Poof', closed.length === 1 ? `${names} sat unused, so Poof closed it.` : `Closed after sitting unused: ${names}`);
        if (win && win.isVisible()) win.webContents.send('window:shown');
      },
    });

    updater = new Updater({
      app,
      onState: (state) => win && win.webContents.send('update:state', state),
    });

    createWindow();
    createTray();
    tracker.start();
    if (settings.get('autoUpdate')) updater.startPeriodicChecks();
  });

  app.on('before-quit', () => settings && settings.save({ immediate: true }));
  app.on('window-all-closed', (event) => event.preventDefault());
}
