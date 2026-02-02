# Zen Browser Sync

This repository contains your Zen Browser profile and sync scripts. It allows you to keep your bookmarks, history, and extensions in sync between macOS and Windows using GitHub.

## 📂 Structure
- `profile/`: The actual browser profile files (linked to your system).
- `scripts/`: Sync scripts for macOS and Windows.
- `setup_mac.sh` / `setup_win.ps1`: One-time setup scripts.

---

## 🍎 macOS Setup (Host)

1. **Close Zen Browser** completely (Cmd+Q).
2. Open Terminal and run the setup script:
   ```bash
   ~/ZenSync/setup_mac.sh
   ```
   *This links your existing profile to this folder.*

3. **Create the Dock App:**
   Run the helper script to create "Zen Sync.app" in your Applications folder:
   ```bash
   ~/ZenSync/create_mac_app.sh
   ```
4. **Usage:**
   - Drag **"Zen Sync"** from your Applications folder to your Dock.
   - Use this icon to launch Zen. It will auto-sync before opening and after closing.

---

## 🪟 Windows Setup (Client)

1. **Clone the Repo:**
   Open PowerShell and clone this repo to your home directory:
   ```powershell
   git clone <REPO_URL> $HOME\ZenSync
   ```

2. **Close Zen Browser.**

3. **Run the Magic Setup:**
   ```powershell
   cd $HOME\ZenSync
   .\setup_win.ps1
   ```
   *This automatically finds your Zen profile, backs it up, and links it to the synced folder.*

4. **Create the Shortcut (Silent Launch):**
   To launch Zen without seeing a black terminal window:
   
   - Right-click Desktop -> **New** -> **Shortcut**.
   - **Target:** 
     ```cmd
     wscript.exe "%USERPROFILE%\ZenSync\scripts\zen-silent-launch.vbs"
     ```
   - **Name:** "Zen Sync"
   - Click **Finish**.

   **Make it look nice (Optional):**
   - Right-click the new shortcut -> **Properties** -> **Change Icon**.
   - Browse to: `%APPDATA%\..\Local\Zen\Application\zen.exe` (or wherever you installed Zen) and select the logo.
   - Pin this to your Taskbar.

---

## ℹ️ How it Works
1. **Launch:** The script runs `git pull` to get the latest changes from GitHub.
2. **Browse:** Zen Browser opens.
3. **Close:** When you close Zen, the script wakes up, runs `git commit` and `git push`.

### Notes
- **Window Sizes:** Window sizes and positions are **not** synced (`xulstore.json` is ignored). This allows you to have different layouts on Mac and Windows.
- **Merge Conflicts:** Always close Zen on one device before opening it on another. "Last one to close wins."
- **Troubleshooting:** If the sync fails, check the `README.md` or manually run `git pull` in the folder to see errors.
