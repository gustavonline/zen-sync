<#
.SYNOPSIS
Syncs Zen Browser Profile on Windows.

.DESCRIPTION
1. Pulls latest changes from Git.
2. Launches Zen Browser.
3. Waits for Zen to close.
4. Commits and Pushes changes.
#>

$RepoDir = "$HOME\ZenSync"
$ZenExe = "zen.exe" # Ensure this is in your PATH or provide full path
# Common install path for Zen on Windows might be in AppData usually, or a portable folder.
# User will need to adjust $ZenPath if it's not in PATH.

Write-Host "🔄 Checking for updates..." -ForegroundColor Cyan
Set-Location $RepoDir
git pull --rebase --autostash

Write-Host "🚀 Launching Zen Browser..." -ForegroundColor Green
# Start-Process with -Wait ensures the script pauses until Zen closes
$Process = Start-Process "zen" -PassThru -Wait

Write-Host "🔒 Zen Browser closed. Syncing..." -ForegroundColor Cyan

git add .
$Date = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
git commit -m "Sync: $Date (Windows)"
git push

Write-Host "✅ Sync Complete!" -ForegroundColor Green
Start-Sleep -Seconds 3
