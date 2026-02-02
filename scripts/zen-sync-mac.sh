#!/bin/bash

# ==========================================
# Zen Browser Sync Script (macOS)
# ==========================================

REPO_DIR="$HOME/ZenSync"
ZEN_APP_NAME="Zen" 

# 1. Sync Process: Pull Updates
echo "🔄 Checking for updates from GitHub..."
cd "$REPO_DIR" || exit
git pull --rebase --autostash
if [ $? -eq 0 ]; then
    echo "✅ Profile updated."
else
    echo "⚠️  Git pull failed or no network. Launching anyway..."
fi

# 2. Launch Zen Browser
echo "🚀 Launching Zen Browser..."
# We run open. We use a loop to wait because 'open -W' can be flaky with browsers.
open -a "$ZEN_APP_NAME"

# Give it a moment to start
sleep 5

# 3. Monitor Process
echo "👀 Watching Zen Browser..."
while pgrep -x "zen" > /dev/null; do
    sleep 2
done

# 4. Sync Process: Push Updates
echo "🔒 Zen Browser closed. Syncing changes..."
cd "$REPO_DIR" || exit

# Add changes
git add .

# Check if there are changes to commit
if git diff-index --quiet HEAD --; then
    echo "No changes to sync."
else
    git commit -m "Sync: $(date '+%Y-%m-%d %H:%M:%S') (macOS)"
    git push
    echo "✅ Changes pushed to GitHub."
fi

# Notification (Optional, standard macOS notification)
osascript -e 'display notification "Zen Profile Synced successfully" with title "Zen Sync"'
