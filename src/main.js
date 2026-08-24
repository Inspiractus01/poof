const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const SELF_BUNDLE_ID = 'com.inspiractus.poof';
// Finder relaunches itself instantly, so listing it would only be noise.
const ALWAYS_SKIP = new Set([SELF_BUNDLE_ID, 'com.apple.finder', 'Finder', 'Poof', 'Electron']);

const WINDOW_WIDTH = 320;
const WINDOW_HEIGHT = 460;

let tray = null;
let win = null;
let settings = { keep: [], forceQuit: false, quitDelay: 4 };

// --- settings --------------------------------------------------------------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    settings = { ...settings, ...raw, keep: Array.isArray(raw.keep) ? raw.keep : [] };
  } catch {
    // first run, or a settings file we can't read -- defaults are fine
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('could not save settings:', err);
  }
}

// --- AppleScript -----------------------------------------------------------
function osascript(script, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', script], { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout);
    });
  });
}

const LIST_SCRIPT = `
tell application "System Events"
  set output to ""
  repeat with p in (every process whose background only is false)
    set appName to name of p
    set bundleId to ""
    set appPath to ""
    set appPid to unix id of p
    try
      set bundleId to bundle identifier of p
    end try
    try
      set appPath to POSIX path of (file of p as alias)
    end try
    set output to output & appName & tab & bundleId & tab & appPath & tab & appPid & linefeed
  end repeat
end tell
return output`;

const iconCache = new Map();

async function iconFor(appPath) {
  if (!appPath) return null;
  if (iconCache.has(appPath)) return iconCache.get(appPath);
  let dataUrl = null;
  try {
    const image = await app.getFileIcon(appPath, { size: 'normal' });
    dataUrl = image.isEmpty() ? null : image.resize({ width: 32, height: 32 }).toDataURL();
  } catch {
    dataUrl = null;
  }
  iconCache.set(appPath, dataUrl);
  return dataUrl;
}

async function listApps() {
  const stdout = await osascript(LIST_SCRIPT);
  const apps = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const [name, bundleId, appPath, pid] = line.split('\t');
    if (!name) continue;
    if (ALWAYS_SKIP.has(bundleId) || ALWAYS_SKIP.has(name)) continue;
    apps.push({
      name,
      bundleId: bundleId || '',
      path: appPath || '',
      pid: Number(pid) || 0,
      id: bundleId || name,
      icon: await iconFor(appPath),
    });
  }
  apps.sort((a, b) => a.name.localeCompare(b.name));
  return apps.map((a) => ({ ...a, keep: settings.keep.includes(a.id) }));
}

function quitTarget(target) {
  // `tell application id` is the reliable form; fall back to the name for the
  // handful of processes that report no bundle identifier.
  const ref = target.bundleId ? `application id "${target.bundleId}"` : `application "${target.name}"`;
  return osascript(`with timeout of ${settings.quitDelay} seconds\ntell ${ref} to quit\nend timeout`,
    (settings.quitDelay + 2) * 1000);
}

const isRunning = (pid) => {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function quitAll() {
  const apps = await listApps();
  const targets = apps.filter((a) => !a.keep);
  const kept = apps.length - targets.length;

  await Promise.all(targets.map((t) => quitTarget(t).catch(() => {})));

  // Apps with an unsaved-changes dialog stay up. Only kill them when asked to.
  const stubborn = targets.filter((t) => t.pid > 0 && isRunning(t.pid));
  if (settings.forceQuit) {
    for (const t of stubborn) {
      try {
        if (t.pid > 0) process.kill(t.pid, 'SIGKILL');
      } catch {
        // already gone, or not ours to kill
      }
    }
    return { quit: targets.length, kept, stuck: [] };
  }

  return { quit: targets.length - stubborn.length, kept, stuck: stubborn.map((t) => t.name) };
}

// --- popover window --------------------------------------------------------
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
    vibrancy: 'popover',
    visualEffectState: 'active',
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('blur', () => win.hide());
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // External links (there are none today, but never open one in the popover)
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function positionWindow() {
  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const area = display.workArea;

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - WINDOW_WIDTH / 2);
  x = Math.max(area.x + 8, Math.min(x, area.x + area.width - WINDOW_WIDTH - 8));
  const y = Math.round(trayBounds.y + trayBounds.height + 4);

  win.setPosition(x, y, false);
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

function trayImage() {
  const image = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'trayTemplate.png'));
  image.setTemplateImage(true);
  return image;
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('Poof - quit all apps');
  tray.on('click', toggleWindow);
  tray.on('right-click', () => {
    tray.popUpContextMenu(Menu.buildFromTemplate([
      { label: 'Open Poof', click: toggleWindow },
      { type: 'separator' },
      { label: 'Quit Poof', click: () => app.quit() },
    ]));
  });
}

// --- IPC -------------------------------------------------------------------
ipcMain.handle('apps:list', async () => {
  try {
    return { apps: await listApps(), error: null };
  } catch (err) {
    return { apps: [], error: String(err.message || err) };
  }
});

ipcMain.handle('apps:quitAll', async () => {
  try {
    const result = await quitAll();
    if (win && win.isVisible()) win.hide();
    return { ...result, error: null };
  } catch (err) {
    return { quit: 0, kept: 0, stuck: [], error: String(err.message || err) };
  }
});

ipcMain.handle('keep:toggle', (_event, id) => {
  settings.keep = settings.keep.includes(id)
    ? settings.keep.filter((k) => k !== id)
    : [...settings.keep, id];
  saveSettings();
  return settings.keep;
});

ipcMain.handle('settings:get', () => settings);

ipcMain.handle('settings:set', (_event, patch) => {
  settings = { ...settings, ...patch };
  saveSettings();
  return settings;
});

ipcMain.on('window:hide', () => win && win.hide());
ipcMain.on('app:quit', () => app.quit());

// --- lifecycle -------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => win && toggleWindow());

  app.whenReady().then(() => {
    if (app.dock) app.dock.hide(); // menu bar only, no dock icon
    loadSettings();
    createWindow();
    createTray();
  });

  // No windows to reopen -- the tray is the whole app.
  app.on('window-all-closed', (e) => e.preventDefault());
}
