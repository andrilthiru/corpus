param(
    [string]$RepoPath = "."
)

$ErrorActionPreference = "Stop"
$style = Join-Path $RepoPath "style.css"
$backup = Join-Path $RepoPath "style.css.before-wide-ui.bak"

if (-not (Test-Path $backup)) {
    Write-Host ""
    Write-Host "No backup file was found. Nothing was restored." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

Copy-Item $backup $style -Force
Write-Host ""
Write-Host "Original style.css restored." -ForegroundColor Green
Write-Host ""
Read-Host "Press Enter to close"
