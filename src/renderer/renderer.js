const list = document.getElementById('apps');
const quitAllButton = document.getElementById('quit-all');
const quitCount = document.getElementById('quit-count');
const status = document.getElementById('status');
const errorBox = document.getElementById('error');
const permissionPanel = document.getElementById('permission');
const settingsPanel = document.getElementById('settings');
const forceQuitInput = document.getElementById('force-quit');

let apps = [];

function setStatus(text) {
  status.textContent = text || ' ';
}

function showError(message) {
  errorBox.hidden = !message;
  errorBox.textContent = message || '';
}

// Missing automation permission is the one error worth a fix-it button rather
// than an error string -- macOS can deep link straight to the right pane.
function showPermissionPrompt(needed) {
  permissionPanel.hidden = !needed;
  list.hidden = needed;
  quitAllButton.hidden = needed;
  document.querySelector('.hint').hidden = needed;
  if (needed) {
    showError('');
    setStatus('');
  }
}

function render() {
  list.textContent = '';

  if (!apps.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No apps running.';
    list.append(empty);
  }

  for (const app of apps) {
    const row = document.createElement('li');
    row.className = app.keep ? 'app kept' : 'app';

    if (app.icon) {
      const img = document.createElement('img');
      img.src = app.icon;
      img.alt = '';
      row.append(img);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'placeholder';
      row.append(placeholder);
    }

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = app.name;
    row.append(name);

    const pin = document.createElement('button');
    pin.className = 'pin';
    pin.textContent = app.keep ? '★' : '☆';
    pin.title = app.keep ? 'Quit this app too' : 'Keep this app running';
    pin.addEventListener('click', async () => {
      const keep = await window.poof.toggleKeep(app.id);
      app.keep = keep.includes(app.id);
      render();
    });
    row.append(pin);

    list.append(row);
  }

  const toQuit = apps.filter((a) => !a.keep).length;
  quitCount.textContent = toQuit ? String(toQuit) : '';
  quitAllButton.disabled = toQuit === 0;
  const kept = apps.length - toQuit;
  setStatus(kept ? `${kept} kept` : '');
}

async function refresh() {
  const result = await window.poof.listApps();
  showPermissionPrompt(Boolean(result.needsPermission));
  if (result.needsPermission) return;
  showError(result.error ? `Can't read running apps: ${result.error}` : '');
  apps = result.apps;
  render();
}

quitAllButton.addEventListener('click', async () => {
  quitAllButton.disabled = true;
  setStatus('Quitting...');
  const result = await window.poof.quitAll();
  if (result.needsPermission) showPermissionPrompt(true);
  else if (result.error) showError(result.error);
  else if (result.stuck.length) setStatus(`Still open: ${result.stuck.join(', ')}`);
  await refresh();
});

document.getElementById('open-settings').addEventListener('click', () => {
  window.poof.openAutomationSettings();
});

document.getElementById('retry').addEventListener('click', refresh);
document.getElementById('relaunch').addEventListener('click', () => window.poof.relaunch());

document.getElementById('settings-toggle').addEventListener('click', () => {
  settingsPanel.hidden = !settingsPanel.hidden;
});

forceQuitInput.addEventListener('change', () => {
  window.poof.setSettings({ forceQuit: forceQuitInput.checked });
});

document.getElementById('quit-self').addEventListener('click', () => window.poof.quitSelf());

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.poof.hide();
});

// The app list is only fetched when the popover opens -- that keeps the macOS
// automation prompt tied to a click instead of firing at login.
window.poof.onShown(refresh);

window.poof.getSettings().then((settings) => {
  forceQuitInput.checked = Boolean(settings.forceQuit);
});

render();
