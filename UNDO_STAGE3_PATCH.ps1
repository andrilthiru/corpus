param([string]$RepoPath = ".")
$ErrorActionPreference = "Stop"

$index  = Join-Path $RepoPath "index.html"
$backup = Join-Path $RepoPath "index.html.before-stage3-three-panel.bak"

if (Test-Path $backup) {
  Copy-Item $backup $index -Force
}

$css = Join-Path $RepoPath "stage3-three-panel.css"
$js  = Join-Path $RepoPath "stage3-three-panel.js"
if (Test-Path $css) { Remove-Item $css -Force }
if (Test-Path $js)  { Remove-Item $js -Force }

Write-Host ""
Write-Host "Stage 3 UI patch removed." -ForegroundColor Green
Read-Host "Press Enter to close"