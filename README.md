# ZenSync

Minimal background sync for a Zen Browser profile via a private GitHub repo.

ZenSync is designed for one active computer at a time: close Zen on one machine, let ZenSync push a final snapshot, then open Zen on another machine and it pulls the latest snapshot.

## What syncs

- Zen settings and UI customizations
- extensions and extension metadata
- bookmark backups
- closed-browser session files used to restore tabs/workspaces

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

```bash
git clone https://github.com/gustavonline/zen-sync.git ~/zen-sync
cd ~/zen-sync
npm install
npm link
```

To update later:

```bash
cd ~/zen-sync
git pull --rebase
npm install
npm link
zensync restart
```

## First setup on any machine

1. Open Zen Browser once, then close it.
2. Run:

```bash
zensync setup
zensync startup
zensync start
```

During setup:

- On the first/original machine, create or use the private profile-data repo.
- On additional machines, choose **Clone existing repository** and use the profile repo URL, e.g. `https://github.com/gustavonline/zen-profile-data.git`.

ZenSync points Zen directly at `~/zensync-data/profile` and then keeps that repo synced in the background.

## Daily use

- Do not run Zen on two machines at the same time.
- Close Zen on the current machine before opening it on another machine.
- ZenSync pushes a `Final Sync (Closed)` commit when Zen closes.
- While Zen is closed, ZenSync pulls remote changes every few seconds so the next launch is fresh.

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
