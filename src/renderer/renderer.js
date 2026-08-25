const list = document.getElementById('apps');
const quitButton = document.getElementById('quit-all');
const quitCount = document.getElementById('quit-count');
const statusLine = document.getElementById('status');
const versionLine = document.getElementById('version');
const errorBox = document.getElementById('error');
const permissionPanel = document.getElementById('permission');
const settingsPanel = document.getElementById('settings');
const forceQuitInput = document.getElementById('force-quit');
const autoUpdateInput = document.getElementById('auto-update');
const banner = document.getElementById('update');
const bannerText = document.getElementById('update-text');
const bannerAction = document.getElementById('update-action');

// A closed padlock for the apps Poof leaves alone, an open one for the rest.
const LOCK_CLOSED = '<path d="M5.2 7V4.9a2.8 2.8 0 0 1 5.6 0V7"/><rect x="3.4" y="7" width="9.2" height="6.2"/>';
const LOCK_OPEN = '<path d="M5.2 7V4.9a2.8 2.8 0 0 1 5.4-1"/><rect x="3.4" y="7" width="9.2" height="6.2"/>';

let apps = [];

// Minutes below an hour, whole hours above it, and h+m only when both matter.
function duration(minutes) {
  if (!minutes) return '—';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

const idleLabel = (ms) => `idle ${duration(Math.floor(ms / 60000)) || '0m'}`;

const MINUTE_STEPS = [1, 2, 5, 10, 15, 20, 30, 45];
const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 10, 12, 16, 18, 20, 24];

function setStatus(text) {
  statusLine.textContent = text || '';
}

function showError(message) {
  errorBox.hidden = !message;
  errorBox.textContent = message || '';
}

// A denied automation prompt is the one failure worth a fix-it button rather
// than an error string -- macOS can deep link straight to the right pane.
function showPermissionPrompt(needed) {
  permissionPanel.hidden = !needed;
  list.hidden = needed;
  quitButton.hidden = needed;
  if (needed) {
    showError('');
    setStatus('');
  }
}

function buildRow(app) {
  const row = document.createElement('li');
  row.className = app.keep ? 'app kept' : 'app';
  row.dataset.id = app.id;

  if (app.icon) {
    const img = document.createElement('img');
    img.src = app.icon;
    img.alt = '';
    row.append(img);
  } else {
    const tile = document.createElement('span');
    tile.className = 'tile';
    tile.textContent = app.name.slice(0, 1).toUpperCase();
    row.append(tile);
  }

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = app.name;
  row.append(name);

  const timer = document.createElement('span');
  timer.className = app.minutes ? 'timer armed' : 'timer';

  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.style.setProperty('--fill', `${Math.round(app.progress * 100)}%`);
  const chipLabel = document.createElement('span');
  chipLabel.textContent = duration(app.minutes);
  chip.append(chipLabel);
  timer.append(chip);

  const select = document.createElement('select');
  select.title = app.minutes
    ? `Quits after ${duration(app.minutes)} unused · ${idleLabel(app.idleMs)}`
    : 'Quit this app once it sits unused';

  select.append(new Option('Never quit on its own', '0', !app.minutes, !app.minutes));

  const groups = [
    ['Minutes', MINUTE_STEPS],
    ['Hours', HOUR_STEPS.map((h) => h * 60)],
  ];
  for (const [label, steps] of groups) {
    const group = document.createElement('optgroup');
    group.label = label;
    for (const minutes of steps) {
      const selected = app.minutes === minutes;
      group.append(new Option(`Quit after ${duration(minutes)} unused`, String(minutes), selected, selected));
    }
    select.append(group);
  }

  select.addEventListener('change', async () => {
    const minutes = Number(select.value);
    await window.poof.setRule(app.id, minutes);
    app.minutes = minutes;
    // A locked app never quits, so an idle rule would be a promise Poof can't keep.
    if (minutes && app.keep) {
      await window.poof.toggleKeep(app.id);
      app.keep = false;
    }
    render();
  });
  timer.append(select);
  row.append(timer);

  const pin = document.createElement('button');
  pin.className = 'pin';
  pin.title = app.keep ? 'Quit this app with the others' : 'Keep this app running';
  pin.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${app.keep ? LOCK_CLOSED : LOCK_OPEN}</svg>`;
  pin.addEventListener('click', async () => {
    const keep = await window.poof.toggleKeep(app.id);
    app.keep = keep.includes(app.id);
    if (app.keep && app.minutes) {
      await window.poof.setRule(app.id, 0);
      app.minutes = 0;
    }
    render();
  });
  row.append(pin);

  return row;
}

function render() {
  list.textContent = '';

  if (!apps.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'Nothing running but Poof.';
    list.append(empty);
  }

  for (const app of apps) list.append(buildRow(app));

  const toQuit = apps.filter((a) => !a.keep).length;
  const kept = apps.length - toQuit;
  quitCount.textContent = toQuit ? String(toQuit) : '';
  quitButton.disabled = toQuit === 0;
  setStatus(apps.length ? `${toQuit} to quit · ${kept} kept` : '');
}

function showLoading() {
  list.textContent = '';
  const loading = document.createElement('li');
  loading.className = 'empty';
  loading.textContent = 'Reading apps…';
  list.append(loading);
}

async function refresh() {
  if (!apps.length) showLoading();
  const result = await window.poof.listApps();
  showPermissionPrompt(Boolean(result.needsPermission));
  if (result.needsPermission) return;
  showError(result.error ? `Can't read running apps: ${result.error}` : '');
  apps = result.apps;
  render();
}

// The rows lift off before the popover closes -- the app's one bit of theatre.
function playQuitAnimation(ids) {
  const rows = ids
    .map((id) => list.querySelector(`[data-id="${CSS.escape(id)}"]`))
    .filter(Boolean);
  rows.forEach((row, index) => setTimeout(() => row.classList.add('leaving'), index * 24));
  return new Promise((resolve) => setTimeout(resolve, rows.length * 24 + 200));
}

quitButton.addEventListener('click', async () => {
  quitButton.disabled = true;
  const doomed = apps.filter((a) => !a.keep).map((a) => a.id);
  const animation = playQuitAnimation(doomed);
  const result = await window.poof.quitAll();
  await animation;

  if (result.needsPermission) {
    showPermissionPrompt(true);
    return;
  }
  apps = [];
  if (result.error) showError(result.error);
  else if (result.stuck.length) setStatus(`Still open: ${result.stuck.join(', ')}`);
  else window.poof.hide();
  await refresh();
});

document.getElementById('settings-toggle').addEventListener('click', () => {
  settingsPanel.hidden = !settingsPanel.hidden;
});

document.getElementById('open-settings').addEventListener('click', () => window.poof.openAutomationSettings());
document.getElementById('retry').addEventListener('click', refresh);
document.getElementById('relaunch').addEventListener('click', () => window.poof.relaunch());
document.getElementById('quit-self').addEventListener('click', () => window.poof.quitSelf());
document.getElementById('check-update').addEventListener('click', () => window.poof.checkForUpdate());

forceQuitInput.addEventListener('change', () => window.poof.setSettings({ forceQuit: forceQuitInput.checked }));
autoUpdateInput.addEventListener('change', () => window.poof.setSettings({ autoUpdate: autoUpdateInput.checked }));

bannerAction.addEventListener('click', async () => {
  bannerAction.disabled = true;
  const result = await window.poof.installUpdate();
  if (!result.ok) {
    bannerAction.disabled = false;
    showError(`Update failed: ${result.error}`);
  }
});

function renderUpdate(state) {
  const messages = {
    available: [`Version ${state.version} is out`, 'Install', false],
    downloading: [`Downloading ${state.version}… ${state.progress}%`, 'Install', true],
    verifying: ['Checking the download…', 'Install', true],
    installing: ['Restarting Poof…', 'Install', true],
  };
  const entry = messages[state.status];
  banner.hidden = !entry;
  if (!entry) return;
  bannerText.textContent = entry[0];
  bannerAction.textContent = entry[1];
  bannerAction.disabled = entry[2];
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.poof.hide();
});

// The app list is read when the popover opens, so the very first automation
// prompt lands on a click instead of at login.
window.poof.onShown(refresh);
window.poof.onUpdateState(renderUpdate);

window.poof.getSettings().then((settings) => {
  forceQuitInput.checked = Boolean(settings.forceQuit);
  autoUpdateInput.checked = Boolean(settings.autoUpdate);
  versionLine.textContent = settings.version || '';
});

window.poof.updateState().then(renderUpdate);

render();
