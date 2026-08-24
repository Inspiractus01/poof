# Poof

A tiny macOS menu bar app. One click and every running app quits — except the ones you pin.

- Lives in the menu bar only. No dock icon, no window, just a popover under the icon.
- Star an app to keep it running. The list is remembered.
- Optional force quit for apps that hang on a "save changes?" dialog.

## Install

Download the `.dmg` from [Releases](../../releases), drag **Poof** to Applications, open it.

The build is not code-signed, so the first launch needs:

1. Right-click **Poof.app** → **Open** → **Open**, or
2. `xattr -dr com.apple.quarantine /Applications/Poof.app`

On first use macOS asks for permission to control other apps. If it is missing or denied, the
popover shows an **Open Automation settings** button that deep links straight to
**System Settings → Privacy & Security → Automation**. Turn on **System Events** under Poof,
then hit **Relaunch Poof** — macOS only hands over the new permission after a restart.

## Develop

```sh
npm install
npm start          # run from source
npm run dist       # build dmg + zip into dist/
```

Icons are generated from code by `scripts/gen-icons.js` — no image assets in the repo.

## How it works

`src/main.js` asks System Events for every non-background process, gets each app's real icon
through `app.getFileIcon`, then quits the unpinned ones with `tell application id "…" to quit`.
Anything still alive after the timeout is either reported or `SIGKILL`ed, depending on the
force quit setting. Finder is always skipped (it relaunches itself immediately).

MIT
