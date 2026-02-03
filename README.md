# ZenSync (CLI)

Seamlessly sync your Zen Browser profile between **macOS** and **Windows** using GitHub.

## ✨ Features
*   **Native CLI:** Node.js based tool.
*   **Cross-Platform:** Works identically on macOS and Windows.
*   **Smart Sync:** Automatically handles file locks and ignores caches.
*   **Auto Sync:** Continuous background sync (configurable).
*   **Auto Start:** Native startup integration (LaunchAgent / Startup Shortcut).

## 🚀 Installation

### Prerequisites
*   Node.js (v18+)
*   Git

### Setup
1.  Navigate to this folder:
    ```bash
    cd ~/ZenSync
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

## 🛠 Development
*   `src/cli.js`: Entry point.
*   `src/lib/`: Core logic.
