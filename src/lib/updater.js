const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const REPO = 'Inspiractus01/poof';
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const exec = (command, args, options = {}) => new Promise((resolve, reject) => {
  execFile(command, args, { timeout: 120000, ...options }, (err, stdout, stderr) => {
    if (err) reject(new Error(String(stderr).trim() || err.message));
    else resolve(stdout);
  });
});

const parseVersion = (value) => String(value).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);

function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

// Poof is ad-hoc signed, so Squirrel/electron-updater cannot drive the update.
// This does the same job by hand: fetch the release, verify the signature of
// what was downloaded, then swap the bundle from a detached script.
class Updater {
  constructor({ app, onState }) {
    this.app = app;
    this.onState = onState;
    this.state = { status: 'idle', version: null, error: null, progress: 0 };
    this.timer = null;
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    if (this.onState) this.onState(this.state);
  }

  startPeriodicChecks() {
    if (this.timer) return;
    this.check().catch(() => {});
    this.timer = setInterval(() => this.check().catch(() => {}), CHECK_INTERVAL_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async check() {
    this.setState({ status: 'checking', error: null });
    try {
      const response = await fetch(RELEASES_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Poof' },
      });
      if (!response.ok) throw new Error(`GitHub replied ${response.status}`);

      const release = await response.json();
      const version = String(release.tag_name || '').replace(/^v/, '');
      const asset = (release.assets || []).find((a) => a.name.endsWith('-arm64-mac.zip'));

      if (!version || !asset) {
        this.setState({ status: 'idle', version: null });
        return this.state;
      }

      if (isNewer(version, this.app.getVersion())) {
        this.setState({ status: 'available', version, url: asset.browser_download_url, size: asset.size });
      } else {
        this.setState({ status: 'current', version });
      }
      return this.state;
    } catch (err) {
      this.setState({ status: 'error', error: String(err.message || err) });
      return this.state;
    }
  }

  // The running bundle: .../Poof.app/Contents/MacOS/Poof -> .../Poof.app
  bundlePath() {
    return path.resolve(path.dirname(this.app.getPath('exe')), '..', '..');
  }

  async download(url) {
    const response = await fetch(url, { headers: { 'User-Agent': 'Poof' }, redirect: 'follow' });
    if (!response.ok) throw new Error(`download failed: ${response.status}`);

    const total = Number(response.headers.get('content-length')) || 0;
    const target = path.join(os.tmpdir(), `poof-update-${Date.now()}.zip`);
    const file = fs.createWriteStream(target);
    let received = 0;

    for await (const chunk of response.body) {
      received += chunk.length;
      if (total) this.setState({ progress: Math.round((received / total) * 100) });
      if (!file.write(chunk)) {
        await new Promise((resolve) => file.once('drain', resolve));
      }
    }
    await new Promise((resolve, reject) => file.end((err) => (err ? reject(err) : resolve())));
    return target;
  }

  async install() {
    if (this.state.status !== 'available' || !this.state.url) {
      throw new Error('no update to install');
    }

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poof-update-'));
    try {
      this.setState({ status: 'downloading', progress: 0 });
      const zip = await this.download(this.state.url);

      this.setState({ status: 'verifying' });
      await exec('/usr/bin/ditto', ['-x', '-k', zip, workDir]);

      const staged = path.join(workDir, 'Poof.app');
      if (!fs.existsSync(staged)) throw new Error('the download did not contain Poof.app');

      // Refuse anything that is not a valid, correctly identified Poof bundle.
      await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged]);
      const bundleId = (await exec('/usr/bin/plutil', [
        '-extract', 'CFBundleIdentifier', 'raw', '-o', '-',
        path.join(staged, 'Contents', 'Info.plist'),
      ])).trim();
      if (bundleId !== 'com.inspiractus.poof') throw new Error(`unexpected bundle id ${bundleId}`);

      this.setState({ status: 'installing' });
      this.swapAndRelaunch(staged);
      return true;
    } catch (err) {
      fs.rmSync(workDir, { recursive: true, force: true });
      this.setState({ status: 'error', error: String(err.message || err) });
      throw err;
    }
  }

  // A running bundle cannot replace itself, so hand the swap to a script that
  // waits for this process to exit first.
  swapAndRelaunch(staged) {
    const destination = this.bundlePath();
    const script = path.join(os.tmpdir(), `poof-swap-${Date.now()}.sh`);

    fs.writeFileSync(script, `#!/bin/sh
set -e
while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done
rm -rf "${destination}.old"
mv "${destination}" "${destination}.old"
if /usr/bin/ditto "${staged}" "${destination}"; then
  rm -rf "${destination}.old"
else
  mv "${destination}.old" "${destination}"
fi
rm -rf "${path.dirname(staged)}"
/usr/bin/open "${destination}"
rm -f "${script}"
`, { mode: 0o755 });

    spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => this.app.quit(), 400);
  }
}

module.exports = { Updater, isNewer, REPO };
