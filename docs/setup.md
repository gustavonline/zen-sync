# ZenSync setup and update guide

This is the short operational guide for installing, updating, and recovering ZenSync on Windows, macOS, and Linux.

## Model

ZenSync has one default behavior:

1. Zen is closed: ZenSync pulls latest remote changes in the background.
2. Zen is open: ZenSync pushes safe `Live Checkpoint` commits at the configured interval. These are fallback snapshots in case the computer sleeps/shuts down before Zen closes.
3. Zen closes: ZenSync commits and pushes a clean `Final Sync (Closed)` snapshot.

Other machines can pull a live checkpoint if no final exists yet, but ZenSync logs/notifies that it was not a clean browser-close snapshot. This keeps tabs/workspaces more resilient without uploading cookies, passwords, site storage, form data, caches, or history databases.

## Install or update the tool

Source install/update today:

```bash
cd ~/zen-sync 2>/dev/null || git clone https://github.com/gustavonline/zen-sync.git ~/zen-sync && cd ~/zen-sync
git pull --rebase
npm install
npm link
zensync restart
zensync status
```

NPM install/update after publishing:

```bash
npm install -g @gustavonline/zen-sync
# later:
npm update -g @gustavonline/zen-sync
zensync restart
```

On Windows PowerShell, use:

```powershell
cd $HOME\zen-sync
git pull --rebase
npm install
npm link
zensync restart
zensync status
```

If `~/zen-sync` does not exist yet, clone it first:

```bash
git clone https://github.com/gustavonline/zen-sync.git ~/zen-sync
cd ~/zen-sync
npm install
npm link
```

## First-time setup on a machine

Close Zen Browser, then run:

```bash
zensync setup
```

Setup configures the profile, launch-on-login, and background watcher.

Choose:

- **Create new repo** only on the first/original machine.
- **Clone existing repo** on every other machine.

Recommended profile-data location: `~/zensync-data`.

Daily rule: do not keep Zen open on multiple machines. Close Zen on one machine before opening it on another. If you forget and the newest remote snapshot is only a live checkpoint, ZenSync will warn you.

## Windows

Requirements:

- Node.js
- Git
- GitHub access to the private profile repo

Commands:

```powershell
cd $HOME\zen-sync
npm install
npm link
zensync setup
```

Zen profile config lives under:

```text
%APPDATA%\Zen\profiles.ini
%APPDATA%\Zen\installs.ini
```

ZenSync points Zen directly at:

```text
%USERPROFILE%\zensync-data\profile
```

## macOS

Requirements:

- Node.js
- Git
- GitHub access to the private profile repo

Commands:

```bash
cd ~/zen-sync
npm install
npm link
zensync setup
```

Zen profile config lives under:

```text
~/Library/Application Support/zen/profiles.ini
~/Library/Application Support/zen/installs.ini
```

## Linux

Requirements:

- Node.js
- Git
- systemd user services for startup (`systemctl --user`)
- GitHub access to the private profile repo

Commands:

```bash
cd ~/zen-sync
npm install
npm link
zensync setup
```

Zen profile locations detected by ZenSync:

```text
~/.zen
~/.var/app/app.zen_browser.zen/zen
~/.var/app/io.github.zen_browser.zen/.zen
~/.var/app/io.github.zen_browser.zen/zen
```

## If the profile-data repo was compacted/rebased

Only do this while Zen Browser is closed. Because older clones may have sensitive files tracked, first make a local-only backup, then reset, then restore those local files so they stay on the machine but are no longer tracked by Git.

```bash
cd ~/zensync-data
BACKUP="$HOME/.zensync-local-only-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"
for p in \
  profile/key4.db profile/cert9.db profile/logins.json profile/logins.db profile/logins-backup.json \
  profile/cookies.sqlite profile/places.sqlite profile/favicons.sqlite profile/formhistory.sqlite \
  profile/storage profile/storage.sqlite profile/webappsstore.sqlite profile/autofill-profiles.json; do
  [ -e "$p" ] && mkdir -p "$BACKUP/$(dirname "$p")" && cp -a "$p" "$BACKUP/$p"
done

git fetch origin
git reset --hard origin/main

# Restore local-only sensitive data; .gitignore keeps it out of Git from now on.
cp -a "$BACKUP"/profile/* profile/ 2>/dev/null || true
zensync setup
```

## Safety policy

The profile-data repo should stay private. ZenSync excludes:

```text
cookies.sqlite
places.sqlite
favicons.sqlite
formhistory.sqlite
autofill-profiles.json
storage/
key4.db
logins.json
logins.db
logins-backup.json
cert9.db
cache2/
gmp/
```

ZenSync includes closed-browser session files so tabs/workspaces can restore on the next machine:

```text
sessionstore.jsonlz4
sessionCheckpoints.json
sessionstore-backups/
zen-sessions.jsonlz4
zen-sessions-backup/
```
