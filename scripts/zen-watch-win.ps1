# Background Watcher for Windows
# Run this script at startup to automatically sync Zen Browser

$RepoDir = "$HOME\ZenSync"
$ZenProcessName = "zen"
$PollInterval = 60 # Seconds

Set-Location $RepoDir

$WasRunning = $false

Write-Host "Starting Zen Background Watcher..." -ForegroundColor Cyan

while ($true) {
    $Zen = Get-Process $ZenProcessName -ErrorAction SilentlyContinue
    
    if ($Zen) {
        if (-not $WasRunning) {
            Write-Host "$(Get-Date): Zen STARTED. Sync Paused." -ForegroundColor Yellow
            $WasRunning = $true
        }
        Start-Sleep -Seconds 5
    }
    else {
        if ($WasRunning) {
            Write-Host "$(Get-Date): Zen CLOSED. Syncing..." -ForegroundColor Green
            Start-Sleep -Seconds 2
            
            git add .
            # Check if changes exist
            $Status = git status --porcelain
            if ($Status) {
                $Date = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
                git commit -m "Auto-Sync: $Date (Windows)"
                git push
                Write-Host "✅ Pushed to GitHub." -ForegroundColor Green
            } else {
                Write-Host "No changes to sync."
            }
            
            $WasRunning = $false
        }
        
        # Idle: Pull updates
        # Write-Host "." -NoNewline
        git pull --rebase --autostash *>$null 2>&1
        
        Start-Sleep -Seconds $PollInterval
    }
}
