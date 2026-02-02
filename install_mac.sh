#!/bin/bash

# ==========================================
# Zen Sync - macOS Installer
# ==========================================

ZEN_SYNC_DIR="$HOME/ZenSync"
ZEN_PROFILE_PATH="$HOME/Library/Application Support/zen/Profiles"
PLIST_DEST="$HOME/Library/LaunchAgents/com.gustav.zen-sync.plist"

echo "🍎 Zen Sync Setup (macOS)"
echo "--------------------------"

# 1. Profile Setup
# Find the active profile (ending in .Default (release))
PROFILE_DIR=$(find "$ZEN_PROFILE_PATH" -maxdepth 1 -name "*.Default (release)" | head -n 1)

if [ -z "$PROFILE_DIR" ]; then
    echo "❌ Could not find a default Zen profile."
    exit 1
fi

PROFILE_NAME=$(basename "$PROFILE_DIR")
echo "Found Profile: $PROFILE_NAME"

# Check if already linked
if [ -L "$PROFILE_DIR" ]; then
    echo "✅ Profile is already linked to ZenSync."
else
    echo "📦 Backing up and linking profile..."
    mv "$PROFILE_DIR" "$ZEN_PROFILE_PATH/backup_$PROFILE_NAME"
    ln -s "$ZEN_SYNC_DIR/profile" "$PROFILE_DIR"
    echo "✅ Profile linked!"
fi

# 2. Install Background Watcher
echo "⚙️ Installing Background Service..."

# Create Plist
cat > "$PLIST_DEST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.gustav.zen-sync</string>
    <key>ProgramArguments</key>
    <array>
        <string>$ZEN_SYNC_DIR/scripts/zen-watch-mac.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/zen-sync.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/zen-sync.err</string>
</dict>
</plist>
EOF

# Reload Service
launchctl unload "$PLIST_DEST" 2>/dev/null
launchctl load "$PLIST_DEST"

echo "✅ Background service started!"
echo ""
echo "🎉 Installation Complete!"
echo "You can now simply open Zen Browser. Sync happens automatically."
