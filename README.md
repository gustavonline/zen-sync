# Zen Browser Sync

This repository contains your Zen Browser profile and sync scripts.

## Structure
- `profile/`: The actual browser profile files.
- `scripts/`: Sync scripts for macOS and Windows.

## Setup

### macOS (Host Setup)
1. **Close Zen Browser.**
2. Run the setup script:
   ```bash
   ./setup_mac.sh
   ```
3. Add your GitHub remote:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   ```
4. **Usage:** Instead of clicking the Zen icon, run `scripts/zen-sync-mac.sh`. (See "Application Shortcut" below).

### Windows (Client Setup)
1. Clone this repository to `%USERPROFILE%\ZenSync`.
   ```powershell
   git clone <REPO_URL> $HOME\ZenSync
   ```
2. Locate your Zen Browser profile folder (usually in `%APPDATA%\Zen\Profiles\xxxx.default`).
3. **Close Zen Browser.**
4. Rename your existing profile folder to `backup_profile`.
5. Create a specific directory junction (symlink) to the repo profile:
   ```powershell
   New-Item -ItemType Junction -Path "C:\Users\YOUR_USER\AppData\Roaming\Zen\Profiles\YOUR_PROFILE_ID.default" -Target "$HOME\ZenSync\profile"
   ```
   *(Note: You might need to update `profiles.ini` in the Zen AppData folder to point to the correct profile path if names differ).*

## Usage

### macOS
Run the **Zen Sync** app (created via Automator) or run:
```bash
~/ZenSync/scripts/zen-sync-mac.sh
```

### Windows
Right-click `scripts/zen-sync-win.ps1` -> "Run with PowerShell" or create a shortcut to it.

## Troubleshooting
- **Merge Conflicts:** If you leave the browser open on both machines, conflicts will happen. The script tries to `git pull --rebase`, but if it fails, you may need to manually fix conflicts in the `profile` folder.
- **Lock Files:** If Zen complains it is already running, check for `parent.lock` files in the `profile` directory and delete them if you are sure it's closed.
