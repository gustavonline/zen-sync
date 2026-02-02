#!/bin/bash

# Configuration
REPO_DIR="$HOME/ZenSync"
# Interval to check for updates when Zen is NOT running (seconds)
POLL_INTERVAL=60

cd "$REPO_DIR" || exit

echo "Starting Zen Background Watcher..."

# State tracking
WAS_RUNNING=false

while true; do
    # Check if Zen is running
    # We use pgrep. Note: Process name might be 'zen' or 'Zen'.
    if pgrep -x "zen" > /dev/null || pgrep -x "Zen" > /dev/null; then
        if [ "$WAS_RUNNING" = "false" ]; then
            echo "$(date): Zen Browser STARTED. Pausing updates."
            WAS_RUNNING=true
        fi
        # While running, we just sleep. We DO NOT touch git.
        sleep 5
    else
        # Zen is NOT running.
        
        if [ "$WAS_RUNNING" = "true" ]; then
            echo "$(date): Zen Browser CLOSED. Initiating Sync..."
            
            # Wait a moment for locks to release
            sleep 2
            
            # 1. Add and Commit
            git add .
            if ! git diff-index --quiet HEAD --; then
                git commit -m "Auto-Sync: $(date '+%Y-%m-%d %H:%M:%S')"
                
                # 2. Push
                echo "Pushing changes..."
                if git push; then
                    echo "✅ Push successful."
                    # Optional: Notify user
                    osascript -e 'display notification "Profile synced to cloud." with title "Zen Sync"'
                else
                    echo "❌ Push failed."
                    osascript -e 'display notification "Sync failed. Check network." with title "Zen Sync"'
                fi
            else
                echo "No changes to push."
            fi
            
            WAS_RUNNING=false
        fi
        
        # Idle Loop: Pull updates periodically
        # We assume if the user hasn't opened Zen yet, it's safe to update the profile.
        echo "$(date): Idle. Checking for updates..."
        git pull --rebase --autostash > /dev/null 2>&1
        
        # Sleep until next poll
        sleep $POLL_INTERVAL
    fi
done
