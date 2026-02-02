# Zen Browser Sync

Seamlessly sync your Zen Browser profile between **macOS** and **Windows** using GitHub. 

## ✨ Features
*   **Invisible:** Runs in the background. No special apps to click.
*   **Conflict-Free:** Automatic handling of file locks and merge updates.
*   **Clean:** Ignores caches, lock files, and machine-specific window sizes (`xulstore.json`).

---

## 🚀 Installation

### 🍎 macOS
1.  **Close Zen Browser.**
2.  Run the installer:
    ```bash
    cd ~/ZenSync
    ./install_mac.sh
    ```
3.  That's it! Open Zen Browser normally.

### 🪟 Windows
1.  **Close Zen Browser.**
2.  Open PowerShell as Admin (recommended) or User.
3.  Run the installer:
    ```powershell
    cd $HOME\ZenSync
    .\install_win.ps1
    ```
4.  **One-time start:** Double-click the "ZenSync" shortcut in your `Startup` folder (or reboot).

---

## ❓ Troubleshooting

**How do I know it's working?**
*   **macOS:** You will see a notification "Profile synced to cloud" when you close Zen. Log file: `/tmp/zen-sync.log`.
*   **Windows:** Log file: `~/ZenSync/zen-sync.log`.

**Files not syncing?**
*   Check the log files mentioned above.
*   Ensure you didn't leave Zen open on the *other* computer.

**Resetting the Repo (If things break)**
If you get merge conflicts that won't go away:
```bash
git fetch origin
git reset --hard origin/main
```
*(This resets your local state to match the cloud).*
