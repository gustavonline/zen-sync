# ZenSync (CLI)

Seamlessly sync your Zen Browser profile between **macOS** and **Windows** using GitHub.

## ✨ Features
*   **Native CLI:** Node.js based tool.
*   **Cross-Platform:** Works identically on macOS and Windows.
*   **Smart Sync:** Automatically handles file locks and ignores caches.
*   **Auto Sync:** Continuous background sync (configurable).

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

### Start Watcher
Run this in the background to enable sync:
```bash
zensync watch
```

### Configuration
Enable Auto-Sync (e.g. every 10 mins):
```bash
zensync config
```

### 🔄 Auto-Start on Boot (Recommended)
We recommend using **PM2** to keep ZenSync running in the background.

1.  Install PM2:
    ```bash
    npm install -g pm2
    ```
2.  Start ZenSync:
    ```bash
    pm2 start zensync --name "zensync" -- watch
    ```
3.  Save configuration:
    ```bash
    pm2 save
    ```
4.  Generate startup script:
    ```bash
    pm2 startup
    ```
    (Run the command displayed by PM2).

## 🛠 Development
*   `src/cli.js`: Entry point.
*   `src/lib/`: Core logic.
