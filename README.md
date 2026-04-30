# ZenSync

Minimal background sync for a Zen Browser profile via a private GitHub repo.

ZenSync is designed for one active computer at a time: close Zen on one machine, let ZenSync push a final snapshot, then open Zen on another machine and it pulls the latest snapshot. While Zen is open, ZenSync also makes lightweight live checkpoints as a fallback if a laptop sleeps or shuts down before Zen can close cleanly.

## What syncs

- Zen settings and UI customizations
- extensions and extension metadata
- bookmark backups
- closed-browser session files used to restore tabs/workspaces
- live tab/session checkpoints while Zen is open, marked clearly as non-final

## What does **not** sync

ZenSync intentionally excludes sensitive or high-conflict data:

- passwords and encryption keys (`logins*`, `key4.db`, `cert9.db`)
- cookies / login sessions (`cookies.sqlite`)
- site storage (`storage/`)
- browsing history database (`places.sqlite`)
- form/autofill data
- caches, locks, telemetry, crash reports, DRM/media plugin state

Note: synced tab/session files can still contain page URLs and tab titles. Keep the profile repo private.

## Install / update ZenSync

Source install today:

```bash
git clone https://github.com/gustavonline/zen-sync.git ~/zen-sync
cd ~/zen-sync
npm install
npm link
```

NPM install:

```bash
npm install -g @gustavonline/zen-sync
```

If you previously installed the older alias, remove it too:

```bash
npm uninstall -g @gustavonline/zensync
```

To update a source install:

```bash
cd ~/zen-sync
git pull --rebase
npm install
npm link
zensync restart
```

To update an npm install:

```bash
zensync update
```

Manual equivalent:

```bash
npm install -g @gustavonline/zen-sync
zensync restart
```

The background watcher checks for new npm versions and notifies you with the update command.

## First setup on any machine

1. Open Zen Browser once, then close it.
2. Run:

```bash
zensync setup
```

Setup now starts with **preflight checks** for Git, GitHub CLI (`gh`), and Git identity before it changes anything.
It then configures the profile, enables launch-on-login, and starts/restarts the background watcher.

During setup:

- On the first/original machine, choose **Start brand-new repo** and optionally import your local Zen profile.
- On additional machines, choose **Connect to existing repo** and paste the profile repo URL, e.g. `https://github.com/gustavonline/zen-profile-data.git`.
- If you picked the wrong path earlier, just run `zensync setup` again — the wizard can now keep the current repo, replace it with a clone, or recreate it with a backup first.

ZenSync points Zen directly at `~/zensync-data/profile` and then keeps that repo synced in the background.

## Daily use

- Do not run Zen on two machines at the same time.
- Close Zen on the current machine before opening it on another machine.
- ZenSync pushes a `Final Sync (Closed)` commit when Zen closes.
- While Zen is open, ZenSync may push `Live Checkpoint` commits. They are fallback snapshots, not clean finals.
- While Zen is closed, ZenSync pulls remote changes every few seconds so the next launch is fresh.
- If the newest remote commit is only a live checkpoint, ZenSync logs/notifies you so you know the other machine was probably slept/shut down without closing Zen.

Useful checks:

```bash
zensync status
zensync logs -n 30
```

## Platform notes

- **Windows:** startup uses a hidden Startup-folder shortcut.
- **macOS:** startup uses a LaunchAgent.
- **Linux:** startup uses a systemd user service. Native Zen uses `~/.zen`; Flatpak profiles are detected under `~/.var/app/...`.

More details: [`docs/setup.md`](docs/setup.md).
