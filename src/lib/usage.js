const { listApps, quitApps } = require('./apps');

const POLL_MS = 20000;

// Tracks when each app was last the frontmost one, and quits the apps whose
// idle rule has run out. LaunchServices is cheap enough to poll -- no Apple
// events, so this keeps working whether or not the popover is open.
class UsageTracker {
  constructor({ settings, onAutoQuit }) {
    this.settings = settings;
    this.onAutoQuit = onAutoQuit;
    this.timer = null;
    this.quitting = new Set();
  }

  start() {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), POLL_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  // Idle is measured from the last time an app was in front. An app that has
  // never been in front counts from when Poof first saw it running.
  touch(apps) {
    const lastUsed = { ...this.settings.get('lastUsed') };
    const now = Date.now();
    let changed = false;

    for (const app of apps) {
      if (app.front || !lastUsed[app.id]) {
        lastUsed[app.id] = now;
        changed = true;
      }
    }

    if (changed) {
      this.settings.values.lastUsed = lastUsed;
      this.settings.save();
    }
    return lastUsed;
  }

  idleFor(app, lastUsed = this.settings.get('lastUsed')) {
    const since = lastUsed[app.id];
    return since ? Date.now() - since : 0;
  }

  dueApps(apps, lastUsed) {
    const rules = this.settings.get('rules');
    const keep = this.settings.get('keep');

    return apps.filter((app) => {
      const hours = Number(rules[app.id]);
      if (!hours || keep.includes(app.id) || app.front) return false;
      if (this.quitting.has(app.id)) return false;
      return this.idleFor(app, lastUsed) >= hours * 3600 * 1000;
    });
  }

  async tick() {
    let apps;
    try {
      apps = await listApps();
    } catch {
      return; // LaunchServices hiccup; the next tick will catch up
    }

    const lastUsed = this.touch(apps);
    const due = this.dueApps(apps, lastUsed);
    if (!due.length) return;

    for (const app of due) this.quitting.add(app.id);
    try {
      // Never force kill on a timer -- an app holding unsaved work gets to stay.
      const result = await quitApps(due, { force: false });
      const gone = due.filter((app) => !result.stuck.includes(app.name));
      if (gone.length && this.onAutoQuit) this.onAutoQuit(gone);
    } catch {
      // most likely the automation permission; the popover surfaces that
    } finally {
      for (const app of due) this.quitting.delete(app.id);
    }
  }
}

module.exports = { UsageTracker, POLL_MS };
