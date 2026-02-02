#!/bin/bash

# Define paths
SCRIPT_PATH="$HOME/ZenSync/scripts/zen-sync-mac.sh"
APP_NAME="Zen Sync"
APP_PATH="$HOME/Applications/$APP_NAME.app"

echo "Creating $APP_NAME.app..."

# Compile AppleScript to Application
# The script simply runs the shell script.
osacompile -o "$APP_PATH" -e "do shell script \"$SCRIPT_PATH\""

# Try to copy the icon from Zen Browser if available
ZEN_ICON="/Applications/Zen Browser.app/Contents/Resources/app.icns"
DEST_ICON="$APP_PATH/Contents/Resources/applet.icns"

if [ -f "$ZEN_ICON" ]; then
    echo "Copying icon from Zen Browser..."
    cp "$ZEN_ICON" "$DEST_ICON"
    # Touch the app to refresh icon cache
    touch "$APP_PATH"
else
    # Try alternate name
    ZEN_ICON="/Applications/Zen.app/Contents/Resources/app.icns"
    if [ -f "$ZEN_ICON" ]; then
        echo "Copying icon from Zen Browser..."
        cp "$ZEN_ICON" "$DEST_ICON"
        touch "$APP_PATH"
    else
        echo "⚠️  Could not find Zen Browser icon. You can set it manually."
    fi
fi

echo "✅ App created at: $APP_PATH"
echo "You can now drag 'Zen Sync' from your Applications folder to your Dock!"
