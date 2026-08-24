const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  keep: [],          // app ids that survive Quit all
  rules: {},         // app id -> idle hours before Poof quits it
  lastUsed: {},      // app id -> epoch ms it was last frontmost (or first seen)
  forceQuit: false,  // kill apps that ignore the quit request
  autoUpdate: true,
};

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.values = { ...DEFAULTS };
    this.writeTimer = null;
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.values = {
        ...DEFAULTS,
        ...raw,
        keep: Array.isArray(raw.keep) ? raw.keep : [],
        rules: raw.rules && typeof raw.rules === 'object' ? raw.rules : {},
        lastUsed: raw.lastUsed && typeof raw.lastUsed === 'object' ? raw.lastUsed : {},
      };
    } catch {
      // first run, or an unreadable file -- defaults stand
    }
  }

  get(key) {
    return this.values[key];
  }

  set(patch) {
    this.values = { ...this.values, ...patch };
    this.save();
    return this.values;
  }

  // Usage timestamps change every poll; batch them instead of writing each time.
  save({ immediate = false } = {}) {
    if (immediate) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
      this.flush();
      return;
    }
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.flush();
    }, 2000);
  }

  flush() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.values, null, 2));
    } catch (err) {
      console.error('settings: could not write', err);
    }
  }
}

module.exports = { Settings, DEFAULTS };
