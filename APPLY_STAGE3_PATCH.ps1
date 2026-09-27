param([string]$RepoPath = ".")
$ErrorActionPreference = "Stop"

$index = Join-Path $RepoPath "index.html"
if (-not (Test-Path $index)) {
  Write-Host ""
  Write-Host "index.html was not found." -ForegroundColor Yellow
  Write-Host "Place this patch folder inside the ROOT of your corpus repository" -ForegroundColor Yellow
  Write-Host "and run APPLY_STAGE3_PATCH.bat again." -ForegroundColor Yellow
  Read-Host "Press Enter to close"
  exit 1
}

$cssSource = Join-Path $PSScriptRoot "stage3-three-panel.css"
$jsSource  = Join-Path $PSScriptRoot "stage3-three-panel.js"
$cssDest   = Join-Path $RepoPath "stage3-three-panel.css"
$jsDest    = Join-Path $RepoPath "stage3-three-panel.js"

Copy-Item $cssSource $cssDest -Force
Copy-Item $jsSource  $jsDest  -Force

$backup = Join-Path $RepoPath "index.html.before-stage3-three-panel.bak"
if (-not (Test-Path $backup)) { Copy-Item $index $backup }

$html = Get-Content -Raw -Encoding UTF8 $index

if ($html -notmatch 'stage3-three-panel\.css') {
  $html = $html -replace '</head>', "  <link rel=`"stylesheet`" href=`"stage3-three-panel.css`" />`r`n</head>"
}

if ($html -notmatch 'stage3-three-panel\.js') {
  $html = $html -replace '</body>', "  <script src=`"stage3-three-panel.js`"></script>`r`n</body>"
}

Set-Content -Path $index -Value $html -Encoding UTF8

Write-Host ""
Write-Host "SUCCESS: Stage 3 three-panel UI patch installed." -ForegroundColor Green
Write-Host ""
Write-Host "Files to upload to GitHub repository root:"
Write-Host "  1. index.html"
Write-Host "  2. stage3-three-panel.css"
Write-Host "  3. stage3-three-panel.js"
Write-Host ""
Write-Host "This patch is additive and does NOT replace app.js."
Write-Host "A backup of index.html was created."
Write-Host ""
Read-Host "Press Enter to close"