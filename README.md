# Poof

A macOS menu bar app that closes everything you are not using. One click quits every
running app except the ones you lock, and any app can be given its own idle deadline.

No dock icon, no window — just the mark in the menu bar and a popover under it.

## What it does

- **Quit all apps** — one button, every unlocked app closes.
- **Lock an app** — the padlock keeps it running through a Quit all.
- **Idle rules** — give an app anything from 1 minute to 24 hours; Poof closes it once it has
  sat unused that long. The chip on the row fills up as the deadline approaches.
- **Force quit** — optional, for apps that stall on an unsaved-changes dialog. Off by default.
- **Updates itself** — checks GitHub every six hours, downloads the new build, verifies its
  signature, swaps the bundle and restarts.

Idle is measured from the last time an app was frontmost, polled every 20 seconds through
LaunchServices. Rules keep running whether or not the popover is open.

## Install

Download the `.dmg` from [Releases](../../releases), drag **Poof** to Applications, open it.

The build is ad-hoc signed rather than notarized, so the first launch needs:

1. Right-click **Poof.app** → **Open** → **Open**, or
2. `xattr -dr com.apple.quarantine /Applications/Poof.app`

Quitting an app is an Apple event, so macOS asks for permission the first time. If it is
denied, the popover shows a button that deep links to
**System Settings → Privacy & Security → Automation**.

## Develop

```sh
npm install
npm start                                   # run from source
npm run dist                                # build dmg + zip into dist/
/Applications/Poof.app/Contents/MacOS/Poof --probe   # print what Poof sees, with timings
```

## How it works

| Job | Tool | Cost |
| --- | --- | --- |
| List running apps | `lsappinfo list` | ~50 ms, no permission needed |
| App icons | `sips` on the bundle's `.icns`, cached in Application Support | ~25 ms per app, once |
| Quit an app | `osascript` → `tell application id "…" to quit` | needs Automation permission |
| Idle tracking | `lsappinfo` poll every 20 s | negligible |

`app.getFileIcon` returns the same generic icon for every bundle and `nativeImage` cannot
decode `.icns`, which is why icons go through `sips`.

Both icons — the menu bar template and the app icon — are drawn from code in
`scripts/gen-icons.js`; there are no image assets in the repo.

MIT
