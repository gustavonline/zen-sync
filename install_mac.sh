#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$HOME/zen-sync"
REPO_URL="https://github.com/gustavonline/zen-sync.git"

echo "ZenSync macOS setup"

if [ ! -d "$REPO_DIR" ]; then
  git clone "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"
git pull --rebase
npm install
npm link

zensync setup
zensync startup
zensync start
zensync status
