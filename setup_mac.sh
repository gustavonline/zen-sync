#!/bin/bash

# Configuration
ZEN_PROFILE_PATH="/Users/gustavanderson/Library/Application Support/zen/Profiles/tu4ykm93.Default (release)"
SYNC_DIR="$HOME/ZenSync"
DEST_PROFILE="$SYNC_DIR/profile"

echo "========================================"
echo "   Zen Browser Sync Setup (macOS)"
echo "========================================"

# 1. Check if Zen is running
if pgrep -x "zen" > /dev/null; then
    echo "❌ Zen Browser is currently running!"
    echo "Please close Zen Browser completely and run this script again."
    exit 1
fi

# 2. Check if git repo is initialized
if [ ! -d "$SYNC_DIR/.git" ]; then
    echo "Initializing Git repository..."
    cd "$SYNC_DIR"
    git init
    echo "Please add your remote origin now or later using:"
    echo "git remote add origin <your-github-repo-url>"
else
    echo "✅ Git repository already initialized."
fi

# 3. Move Profile
if [ -d "$ZEN_PROFILE_PATH" ] && [ ! -L "$ZEN_PROFILE_PATH" ]; then
    echo "📦 Moving current profile to Sync folder..."
    mv "$ZEN_PROFILE_PATH" "$DEST_PROFILE"
    
    echo "🔗 Creating Symlink..."
    ln -s "$DEST_PROFILE" "$ZEN_PROFILE_PATH"
    
    echo "✅ Profile moved and linked!"
elif [ -L "$ZEN_PROFILE_PATH" ]; then
    echo "✅ Profile is already a symlink. Skipping move."
else
    echo "❌ Could not find original profile at: $ZEN_PROFILE_PATH"
    exit 1
fi

echo ""
echo "🎉 Setup Complete!"
echo "Next Steps:"
echo "1. Run: cd ~/ZenSync && git remote add origin <YOUR_REPO_URL>"
echo "2. Run: ~/ZenSync/scripts/zen-sync-mac.sh to start Zen for the first time."
