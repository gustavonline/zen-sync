# ZenSync (CLI)

Seamlessly sync your Zen Browser profile between **macOS** and **Windows** using GitHub.

## ✨ Features
*   **Native CLI:** Node.js based tool.
*   **Cross-Platform:** Works identically on macOS and Windows.
*   **Smart Sync:** Automatically handles file locks and ignores caches.
*   **Auto Sync:** Continuous background sync (configurable).
*   **Auto Start:** Native startup integration (LaunchAgent / Startup Shortcut).
*   **Friendly Notifications:** Cute & helpful alerts keep you in the loop! 🧘✨

## 🚀 Installation

### Prerequisites
*   Node.js (v18+)
*   Git

### Setup
1.  Navigate to this folder:
    ```bash
    cd ~/zen-sync
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Link the tool globally:
    ```bash
    npm link
    ```
4.  Run setup:
    ```bash
    zensync setup
    ```

## 🎮 Usage

### 🟢 Start & Stop
Run the watcher in the background:
```bash
zensync start
```

Stop the background watcher:
```bash
zensync stop
```

### 📊 Status & Logs
Check if it's running and when it last synced:
```bash
zensync status
```

View recent log activity:
```bash
zensync logs
```

### ⚡ Auto-Start (Recommended)
Make ZenSync start automatically when you turn on your computer:
```bash
zensync startup
```
*(To disable: `zensync uninstall`)*

### ⚙️ Configuration
Set the Auto-Sync interval (e.g. every 10 mins):
```bash
zensync config
```

## Multi-Machine Workflow

ZenSync is designed to keep your Zen Browser profile in sync across multiple machines (e.g. a Mac and a Windows PC) via a shared GitHub repo.

### Setting up a new machine

```bash
git clone https://github.com/<your-user>/zen-sync.git
cd zen-sync
npm install
npm link          # On Windows: run as Administrator
zensync setup
zensync startup   # Optional: auto-start on boot
```

### Updating an existing machine after developing on another

If you made changes (code or profile) on Machine A and want Machine B to pick them up:

```bash
cd ~/zen-sync
git pull
npm install       # In case dependencies changed
npm link          # Re-link if package.json bin changed
zensync setup     # Re-run to fix any profile junction issues
```

### Clean uninstall before re-setup

If things are broken or you want to start fresh on a machine:

```bash
zensync uninstall         # Stops daemon, removes startup, unlinks profile, clears config
npm uninstall -g zensync  # Remove the global CLI link
# Then delete the repo folder if desired
```

After uninstalling, follow the "Setting up a new machine" steps again.

### Notes

- **Windows**: `npm link` requires an Administrator terminal (symlink creation needs elevated privileges).
- **macOS**: If your local folder is still named `ZenSync` (uppercase), rename it to `zen-sync` to match the repo:
  ```bash
  mv ~/ZenSync ~/zen-sync
  ```
- **Profile junction**: `zensync setup` handles all three scenarios: already linked, existing local profile (backs it up), or missing profile folder (creates junction from `profiles.ini`).
- **Uninstall is safe**: `zensync uninstall` restores your backed-up local profile if one exists, so you won't lose data.

## Uninstall

```bash
zensync uninstall
```

This will:
1. Stop the background daemon
2. Remove startup hooks (LaunchAgent / Startup shortcut)
3. Remove the profile junction and restore from backup if available
4. Clear all config, state, and log data

After running this, you can also run `npm uninstall -g zensync` and delete the repo folder.

## Development

*   `src/cli.js`: Entry point (Commander-based CLI).
*   `src/lib/setup.js`: Setup wizard + profile linking logic.
*   `src/lib/watch.js`: Main watcher loop (process detection, auto-sync, git ops).
*   `src/lib/daemon.js`: Background process management.
*   `src/lib/startup.js`: OS startup integration (LaunchAgent / VBS+Shortcut).
*   `src/lib/git.js`: Git operations (add, commit, push, pull).
*   `src/lib/config.js`: Persistent config store (Conf).
*   `src/lib/state.js`: Volatile state store (PID, heartbeat, lastSync).
*   `src/lib/logger.js`: File logging.

### Firefox Sync Overlap
ZenSync ignores the following files to prevent conflicts with **Firefox Sync** and session issues:
*   `cookies.sqlite` (Session cookies - Prevents being signed out)
*   `places.sqlite` (History & Bookmarks - Handled by Firefox Sync)
*   `favicons.sqlite` (Site Icons)

We recommend using **Firefox Sync** for History, Bookmarks, and Open Tabs, and using **ZenSync** for everything else (Extensions, Themes, `userChrome.css`).
