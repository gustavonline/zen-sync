# ZenSync macOS setup guide

For the canonical cross-platform guide, see [`setup.md`](setup.md).

## Install/update

```bash
cd ~/zen-sync 2>/dev/null || git clone https://github.com/gustavonline/zen-sync.git ~/zen-sync && cd ~/zen-sync
git pull --rebase
npm install
npm link
zensync --version
```

## First setup on a Mac

Open Zen once, close it, then run:

```bash
zensync setup
zensync status
```

For an existing profile repo, choose **Clone existing repo** and use:

```text
https://github.com/gustavonline/zen-profile-data.git
```

## Daily rule

Do not keep Zen open on multiple machines. Close Zen on one machine before opening it on another. ZenSync pushes a `Final Sync (Closed)` commit on close, creates `Live Checkpoint` commits while open as a fallback, and pulls while Zen is closed.

## Troubleshooting

```bash
zensync logs -n 50
zensync restart
```

If the profile-data repo was compacted/rebased, use the safe reset recipe in [`setup.md`](setup.md) or ask an agent to do it. It backs up local-only cookies/password databases before resetting the Git repo.
