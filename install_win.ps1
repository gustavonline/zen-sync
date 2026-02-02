# ==========================================
# Zen Sync - Windows Installer
# ==========================================

$ErrorActionPreference = "Stop"
$ZenSyncDir = "$HOME\ZenSync"
$ZenProfilePath = "$env:APPDATA\Zen\Profiles"
$StartupFolder = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
$ShortcutPath = "$StartupFolder\ZenSync.lnk"

Write-Host "🪟 Zen Sync Setup (Windows)" -ForegroundColor Cyan
Write-Host "----------------------------"

# 1. Profile Linking
if (Test-Path $ZenProfilePath) {
    # Find default profile
    $Profiles = Get-ChildItem -Path $ZenProfilePath -Directory | Where-Object { $_.LinkType -ne "Junction" -and $_.Name -match "Default \(release\)" }
    
    if ($Profiles.Count -gt 0) {
        $Target = $Profiles[0]
        Write-Host "Found Profile: $($Target.Name)"
        
        $Backup = "backup_$($Target.Name)"
        Write-Host "📦 Backing up and linking..."
        
        Rename-Item -Path $Target.FullName -NewName $Backup
        New-Item -ItemType Junction -Path $Target.FullName -Target "$ZenSyncDir\profile" | Out-Null
        Write-Host "✅ Profile linked!" -ForegroundColor Green
    } else {
        # Check if already done
        $Junctions = Get-ChildItem -Path $ZenProfilePath -Directory | Where-Object { $_.LinkType -eq "Junction" }
        if ($Junctions) {
            Write-Host "✅ Profile is already linked." -ForegroundColor Green
        } else {
            Write-Host "⚠️ No suitable profile found to link." -ForegroundColor Yellow
        }
    }
}

# 2. Install Background Watcher (Startup Shortcut)
Write-Host "⚙️ Installing Startup Task..."

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
# We use wscript to run the VBS wrapper which runs PowerShell hidden
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = """$ZenSyncDir\scripts\start-watcher-win.vbs"""
$Shortcut.WorkingDirectory = "$ZenSyncDir"
$Shortcut.Description = "Zen Browser Background Sync"
$Shortcut.Save()

Write-Host "✅ Startup task created!" -ForegroundColor Green
Write-Host ""
Write-Host "🎉 Installation Complete!"
Write-Host "Run the 'ZenSync' shortcut in your Startup folder once to start it now,"
Write-Host "or just restart your computer."
