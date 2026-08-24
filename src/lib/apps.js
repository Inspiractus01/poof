const { execFile } = require('child_process');

const SELF_BUNDLE_ID = 'com.inspiractus.poof';
// Finder relaunches itself the moment it is quit, so listing it is just noise.
const SKIP_IDS = new Set([SELF_BUNDLE_ID, 'com.apple.finder']);
const SKIP_NAMES = new Set(['Poof', 'Finder', 'Electron']);

function run(command, args, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) {
        resolve(stdout);
        return;
      }
      // err.message repeats the whole command, which is useless in the UI.
      const timedOut = err.killed || err.signal === 'SIGTERM';
      const detail = String(stderr).trim()
        || (timedOut ? `timed out after ${Math.round(timeoutMs / 1000)}s` : `exit code ${err.code}`);
      const error = new Error(detail);
      error.timedOut = timedOut;
      reject(error);
    });
  });
}

const isAlive = (pid) => {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// LaunchServices knows every running app, costs ~50ms, and needs no permission.
// AppleScript is only used to actually quit something.
function parseLsappinfo(text) {
  const apps = [];
  let current = null;

  for (const line of text.split('\n')) {
    const header = line.match(/^\s*\d+\)\s+"(.+?)"\s+ASN:/);
    if (header) {
      if (current) apps.push(current);
      current = { name: header[1], front: line.includes('(in front)') };
      continue;
    }
    if (!current) continue;

    const bundleId = line.match(/bundleID="(.+?)"/);
    if (bundleId) current.bundleId = bundleId[1];

    const bundlePath = line.match(/bundle path="(.+?)"/);
    if (bundlePath) current.path = bundlePath[1];

    const pid = line.match(/\bpid\s*=\s*(\d+)/);
    if (pid) current.pid = Number(pid[1]);

    const type = line.match(/\btype="(.+?)"/);
    if (type) current.type = type[1];
  }
  if (current) apps.push(current);

  return apps;
}

async function listApps() {
  const apps = parseLsappinfo(await run('/usr/bin/lsappinfo', ['list'], { timeoutMs: 10000 }))
    // "Foreground" is LaunchServices' term for an app with a dock icon and menus.
    .filter((a) => a.type === 'Foreground')
    // LaunchServices can hold on to an entry after the app is gone.
    .filter((a) => isAlive(a.pid))
    .filter((a) => !SKIP_IDS.has(a.bundleId) && !SKIP_NAMES.has(a.name))
    .map((a) => ({
      name: a.name,
      bundleId: a.bundleId || '',
      path: a.path || '',
      pid: a.pid || 0,
      front: Boolean(a.front),
      id: a.bundleId || a.name,
    }));

  apps.sort((a, b) => a.name.localeCompare(b.name));
  return apps;
}

async function frontmostId() {
  const apps = await listApps();
  const front = apps.find((a) => a.front);
  return front ? front.id : null;
}

function quitOne(target, { graceSeconds = 4 } = {}) {
  // `application id` is the reliable reference; a handful of processes report no
  // bundle identifier, and those have to go by name.
  const ref = target.bundleId
    ? `application id "${target.bundleId}"`
    : `application "${target.name.replace(/"/g, '')}"`;
  const script = `with timeout of ${graceSeconds} seconds\ntell ${ref} to quit\nend timeout`;
  return run('/usr/bin/osascript', ['-e', script], { timeoutMs: (graceSeconds + 2) * 1000 });
}

// Quits every target, then reports the ones still standing -- usually an app
// holding a "save changes?" sheet. Those are only killed when asked to.
async function quitApps(targets, { force = false, graceSeconds = 4 } = {}) {
  const errors = [];
  await Promise.all(targets.map((t) => quitOne(t, { graceSeconds }).catch((err) => {
    errors.push({ name: t.name, message: err.message, timedOut: Boolean(err.timedOut) });
  })));

  const stubborn = targets.filter((t) => isAlive(t.pid));
  if (force) {
    for (const t of stubborn) {
      try {
        process.kill(t.pid, 'SIGKILL');
      } catch {
        // gone already, or not ours to kill
      }
    }
    return { quit: targets.length, stuck: [], errors };
  }

  return {
    quit: targets.length - stubborn.length,
    stuck: stubborn.map((t) => t.name),
    errors,
  };
}

// osascript reports a denied automation prompt as errAEEventNotPermitted (-1743).
const isPermissionError = (err) => /-1743|not authoriz|not authoris/i.test(String((err && err.message) || err));

module.exports = { listApps, frontmostId, quitApps, quitOne, isPermissionError, isAlive, run };
