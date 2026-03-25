# ZenSync macOS setup guide

This guide is for setting up a **new Mac** for ZenSync development + daily use.

---

## 1) Prerequisites

Install core tools:

```bash
xcode-select --install
```

If you use Homebrew:

```bash
brew install git node gh
```

Verify:

```bash
git --version
node -v
npm -v
gh --version
```

---

## 2) Clone ZenSync and link local CLI

```bash
mkdir -p ~/dev
cd ~/dev
git clone https://github.com/gustavonline/zen-sync.git
cd zen-sync
npm install
npm link
zensync --version
```

`npm link` makes the `zensync` command use your local source code.

---

## 3) Authenticate GitHub CLI

```bash
gh auth login
gh auth status
```

---

## 4) Connect your existing profile data repo

Run setup wizard:

```bash
zensync setup
```

Recommended choices:
- Storage location: `~/zensync-data`
- Setup path: **Clone existing repo**
- Repo URL: your profile repo URL (example: `https://github.com/gustavonline/zen-profile-data.git`)

---

## 5) Enable background sync

Optional: set Auto-Sync interval in minutes (e.g. `1`):

```bash
zensync config
```

Enable startup + start watcher:

```bash
zensync startup
zensync start
zensync status
zensync logs -n 50
```

---

## 6) Keep Mac updated when ZenSync repo changes

When you pull new changes from `zen-sync`:

```bash
cd ~/dev/zen-sync
git pull origin main
npm install
npm link
zensync restart
```

---

## 7) Quick troubleshooting

### A) `MERGE_AUTOSTASH` errors

```bash
zensync stop
rm -f ~/zensync-data/.git/MERGE_AUTOSTASH
git -C ~/zensync-data status
zensync start
```

### B) Network / DNS pull failures

Usually temporary internet/DNS issues. Retry:

```bash
zensync restart
zensync logs -n 80
```

### C) Verify which CLI is active

```bash
which zensync
npm list -g --depth=0 | grep zensync
```
