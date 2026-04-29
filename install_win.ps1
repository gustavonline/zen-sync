# ZenSync Windows installer/updater
$ErrorActionPreference = "Stop"

$RepoDir = Join-Path $HOME "zen-sync"
$RepoUrl = "https://github.com/gustavonline/zen-sync.git"

Write-Host "ZenSync Windows setup" -ForegroundColor Cyan

if (-not (Test-Path $RepoDir)) {
    git clone $RepoUrl $RepoDir
}

Set-Location $RepoDir
git pull --rebase
npm install

# Avoid npm-link junction issues on some Windows installs by writing tiny command shims.
$NpmPrefix = (npm config get prefix).Trim()
$Cli = Join-Path $RepoDir "src\cli.js"

Set-Content -Path (Join-Path $NpmPrefix "zensync.cmd") -Value @"
@ECHO OFF
node "$Cli" %*
"@ -Encoding ASCII

Set-Content -Path (Join-Path $NpmPrefix "zensync.ps1") -Value @"
& node "$Cli" @args
"@ -Encoding UTF8

Write-Host "ZenSync command installed." -ForegroundColor Green
Write-Host "Now running setup/startup/start..." -ForegroundColor Cyan

node $Cli setup
node $Cli startup
node $Cli start
node $Cli status
