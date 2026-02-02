# Windows Setup Script for Zen Sync
# Run this via PowerShell

$ErrorActionPreference = "Stop"

# 1. Configuration
$ZenSyncDir = "$HOME\ZenSync"
$ProfileRepo = "$ZenSyncDir\profile"
$ZenDataDir = "$env:APPDATA\Zen\Profiles"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   Zen Browser Sync Setup (Windows)" -ForegroundColor Cyan
Write-Host "========================================"

# 2. Check for Zen Browser Process
$Running = Get-Process "zen" -ErrorAction SilentlyContinue
if ($Running) {
    Write-Host "❌ Zen Browser is currently running!" -ForegroundColor Red
    Write-Host "Please close Zen Browser completely and run this script again."
    Exit
}

# 3. Verify Repo exists
if (-not (Test-Path "$ProfileRepo")) {
    Write-Host "❌ Could not find the synced profile folder at: $ProfileRepo" -ForegroundColor Red
    Write-Host "Did you clone the repository to $HOME\ZenSync ?"
    Exit
}

# 4. Find the existing Windows Profile ID automatically
if (-not (Test-Path $ZenDataDir)) {
    Write-Host "❌ Could not find Zen Data directory at: $ZenDataDir" -ForegroundColor Red
    Exit
}

# Get all profile folders that are not already a junction/reparse point
$Profiles = Get-ChildItem -Path $ZenDataDir -Directory | Where-Object { $_.LinkType -ne "Junction" }

if ($Profiles.Count -eq 0) {
    # Check if we already did it (look for Junctions)
    $Junctions = Get-ChildItem -Path $ZenDataDir -Directory | Where-Object { $_.LinkType -eq "Junction" }
    if ($Junctions.Count -gt 0) {
        Write-Host "✅ It looks like you already have a synced profile linked!" -ForegroundColor Green
        Write-Host "Found Junction: $($Junctions[0].Name)"
        Exit
    }
    Write-Host "❌ No standard profile folders found to link." -ForegroundColor Red
    Exit
}

# Pick the first one (usually there is only one default)
$TargetProfile = $Profiles[0]
Write-Host "🔍 Found local Windows profile: $($TargetProfile.Name)" -ForegroundColor Yellow

# 5. Backup and Link
$BackupName = "backup_$($TargetProfile.Name)"
$BackupPath = Join-Path -Path $ZenDataDir -ChildPath $BackupName
$LinkPath = $TargetProfile.FullName

Write-Host "📦 Backing up existing profile to: $BackupName"
Rename-Item -Path $LinkPath -NewName $BackupName

Write-Host "🔗 Creating Link to Synced Profile..."
New-Item -ItemType Junction -Path $LinkPath -Target $ProfileRepo | Out-Null

Write-Host ""
Write-Host "🎉 Success! Windows setup is complete." -ForegroundColor Green
Write-Host "You can now run '$ZenSyncDir\scripts\zen-sync-win.ps1' to start Zen."
