# ZenSync (CLI)

Seamlessly sync your Zen Browser profile between **macOS** and **Windows** using GitHub.

## ✨ Features
*   **Native CLI:** Node.js based tool.
*   **Cross-Platform:** Works identically on macOS and Windows.
*   **Smart Sync:** Automatically handles file locks and ignores caches.
*   **Zero Conflict:** Syncs when you close the browser.

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
3.  Link the tool (optional, makes `zensync` available everywhere):
    ```bash
    npm link
    ```
4.  Run setup:
    ```bash
    zensync setup
    ```

## 🎮 Usage

### Start Watcher
Run this in the background to enable sync:
```bash
zensync watch
```

(You can use `pm2` or a startup script to run this automatically on boot).

### Configuration
Config is stored in your system's default config directory (e.g., `~/.config/zensync` or `AppData`).

## 🛠 Development
This tool is built with Node.js.
*   `src/cli.js`: Entry point.
*   `src/lib/`: Core logic.
