const fs = require('fs');
const path = require('path');

const SCHEMA = 2;

const DEFAULTS = {
  schemaVersion: SCHEMA,
  keep: [],           // app ids that survive Quit all
  rules: {},          // app id -> idle minutes before Poof quits it
  lastUsed: {},       // app id -> epoch ms it was last frontmost (or first seen)
  forceQuit: false,   // kill apps that ignore the quit request
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
      this.migrate();
    } catch {
      // first run, or an unreadable file -- defaults stand
    }
  }

  // Schema 1 stored idle rules in hours; schema 2 stores minutes.
  migrate() {
    if (this.values.schemaVersion === SCHEMA) return;
    const rules = {};
    for (const [id, hours] of Object.entries(this.values.rules)) {
      const minutes = Math.round(Number(hours) * 60);
      if (minutes > 0) rules[id] = minutes;
    }
    this.values.rules = rules;
    this.values.schemaVersion = SCHEMA;
    this.save({ immediate: true });
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

module.exports = { Settings, DEFAULTS, SCHEMA };
