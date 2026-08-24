const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

// Electron's app.getFileIcon returns the same generic bundle icon for every
// .app, and nativeImage cannot decode .icns, so the real icon is pulled out of
// the bundle with sips (~25ms) and cached on disk.
class AppIcons {
  constructor(cacheDir) {
    this.cacheDir = cacheDir;
    this.memory = new Map();
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
    } catch {
      // a missing cache dir just means every lookup goes to sips
    }
  }

  static exec(command, args) {
    return new Promise((resolve, reject) => {
      execFile(command, args, { timeout: 5000 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
  }

  async icnsPath(appPath) {
    const resources = path.join(appPath, 'Contents', 'Resources');
    try {
      const declared = await AppIcons.exec('/usr/bin/plutil', [
        '-extract', 'CFBundleIconFile', 'raw', '-o', '-',
        path.join(appPath, 'Contents', 'Info.plist'),
      ]);
      let name = declared.trim();
      if (name && !name.endsWith('.icns')) name += '.icns';
      const declaredPath = path.join(resources, name);
      if (name && fs.existsSync(declaredPath)) return declaredPath;
    } catch {
      // no CFBundleIconFile -- fall through to the conventional names
    }

    for (const name of ['AppIcon.icns', 'app.icns', 'icon.icns']) {
      const guess = path.join(resources, name);
      if (fs.existsSync(guess)) return guess;
    }

    try {
      const found = fs.readdirSync(resources).find((f) => f.endsWith('.icns'));
      if (found) return path.join(resources, found);
    } catch {
      // unreadable Resources folder
    }
    return null;
  }

  // Returns a data URL, or null for apps that keep their icon in Assets.car --
  // the renderer draws a lettered tile for those.
  async dataUrl(appPath) {
    if (!appPath) return null;
    if (this.memory.has(appPath)) return this.memory.get(appPath);

    const key = crypto.createHash('sha1').update(appPath).digest('hex').slice(0, 16);
    const cached = path.join(this.cacheDir, `${key}.png`);

    let result = null;
    try {
      if (!fs.existsSync(cached)) {
        const icns = await this.icnsPath(appPath);
        if (icns) {
          await AppIcons.exec('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '64', icns, '--out', cached]);
        }
      }
      if (fs.existsSync(cached)) {
        result = `data:image/png;base64,${fs.readFileSync(cached).toString('base64')}`;
      }
    } catch {
      result = null;
    }

    this.memory.set(appPath, result);
    return result;
  }

  async decorate(apps) {
    return Promise.all(apps.map(async (app) => ({ ...app, icon: await this.dataUrl(app.path) })));
  }
}

module.exports = { AppIcons };
