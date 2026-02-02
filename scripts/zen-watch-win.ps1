# ==========================================
# Zen Sync Watcher (Windows) - v2.0
# ==========================================

$RepoDir = "$HOME\ZenSync"
$LogFile = "$RepoDir\zen-sync.log"
$MaxLogSize = 500KB
$PollInterval = 30 # Check every 30 seconds

Set-Location $RepoDir

function Write-Log {
    Param ($Message)
    $TimeStamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LogFile -Value "$TimeStamp: $Message"
}

function Rotate-Log {
    if (Test-Path $LogFile) {
        $FileItem = Get-Item $LogFile
        if ($FileItem.Length -gt $MaxLogSize) {
            Remove-Item $LogFile
            Write-Log "Log cleared (limit reached)."
        }
    }
}

Write-Log "Watcher started."
$WasRunning = $false

while ($true) {
    Rotate-Log
    
    $Zen = Get-Process "zen" -ErrorAction SilentlyContinue
    
    if ($Zen) {
        if (-not $WasRunning) {
            Write-Log "Zen Browser STARTED. Sync paused."
            $WasRunning = $true
        }
        Start-Sleep -Seconds 5
    }
    else {
        if ($WasRunning) {
            Write-Log "Zen Browser CLOSED. Syncing..."
            Start-Sleep -Seconds 2
            
            git add .
            $Status = git status --porcelain
            if ($Status) {
                $Date = Get-Date -Format "yyyy-MM-dd HH:mm"
                git commit -m "Auto-Sync: $Date (Windows)" | Out-Null
                
                # Capture Push Output
                $Push = git push 2>&1
                if ($LASTEXITCODE -eq 0) {
                    Write-Log "[SUCCESS] Push successful."
                    # Optional: Add BurntToast notification here if installed
                } else {
                    Write-Log "[ERROR] Push failed: $Push"
                }
            } else {
                Write-Log "No local changes to push."
            }
            $WasRunning = $false
        }
        
        # Idle: Pull updates
        git pull --rebase --autostash *>$null 2>&1
        
        Start-Sleep -Seconds $PollInterval
    }
}
