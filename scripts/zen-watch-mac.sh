#!/bin/bash

# ==========================================
# Zen Sync Watcher (macOS) - v2.0
# ==========================================

REPO_DIR="$HOME/ZenSync"
LOG_FILE="/tmp/zen-sync.log"
MAX_LOG_SIZE=524288 # 512KB
POLL_INTERVAL=5    # Check every 5 seconds

# Ensure we are in the right place
cd "$REPO_DIR" || exit 1

# --- Helper Functions ---

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S'): $1" >> "$LOG_FILE"
}

notify() {
    osascript -e "display notification \"$1\" with title \"Zen Sync\""
}

rotate_log() {
    if [ -f "$LOG_FILE" ]; then
        SIZE=$(stat -f%z "$LOG_FILE")
        if [ "$SIZE" -gt "$MAX_LOG_SIZE" ]; then
            mv "$LOG_FILE" "$LOG_FILE.old"
            log "Log rotated."
        fi
    fi
}

# --- Main Loop ---

log "Watcher started."
WAS_RUNNING=false

while true; do
    # Rotate logs if needed
    rotate_log

    # Check if Zen is running (case insensitive search)
    if pgrep -x "zen" > /dev/null || pgrep -x "Zen" > /dev/null; then
        if [ "$WAS_RUNNING" = "false" ]; then
            log "Zen Browser STARTED. Sync paused."
            WAS_RUNNING=true
        fi
        sleep 1
    else
        # Zen is NOT running
        if [ "$WAS_RUNNING" = "true" ]; then
            log "Zen Browser CLOSED. Syncing..."
            sleep 1 # Wait for file locks
            
            # 1. Commit Local Changes
            git add .
            if ! git diff-index --quiet HEAD --; then
                git commit -m "Auto-Sync: $(date '+%Y-%m-%d %H:%M')" >> "$LOG_FILE" 2>&1
                
                # 2. Push to Cloud
                if git push >> "$LOG_FILE" 2>&1; then
                    log "✅ Push successful."
                    notify "Profile synced to cloud."
                else
                    log "❌ Push failed."
                    notify "Sync failed. Check logs."
                fi
            else
                log "No local changes to push."
            fi
            
            WAS_RUNNING=false
        fi
        
        # Idle: Pull updates from Cloud
        # We use a quiet pull to avoid log spam, capturing error only if it fails
        if ! git pull --rebase --autostash > /dev/null 2>&1; then
            # If pull fails, log it but don't spam notifications
            log "⚠️ Pull failed (network issue or conflict)."
        fi
        
        sleep $POLL_INTERVAL
    fi
done
