param(
    [string]$RepoPath = "."
)

$ErrorActionPreference = "Stop"

$style = Join-Path $RepoPath "style.css"

if (-not (Test-Path $style)) {
    Write-Host ""
    Write-Host "style.css was not found in this folder." -ForegroundColor Yellow
    Write-Host "Put this patch folder inside the ROOT of your corpus repository" -ForegroundColor Yellow
    Write-Host "(the same folder that contains index.html, app.js and style.css)," -ForegroundColor Yellow
    Write-Host "then run APPLY_UI_FIX.bat again." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

$marker = "THEMOZHI CORPUS — WIDE WORKSPACE PATCH"
$content = Get-Content -Raw -Encoding UTF8 $style

if ($content.Contains($marker)) {
    Write-Host ""
    Write-Host "The wide-workspace UI patch is already installed." -ForegroundColor Green
    Write-Host "No additional changes were made."
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 0
}

$backup = Join-Path $RepoPath "style.css.before-wide-ui.bak"
if (-not (Test-Path $backup)) {
    Copy-Item $style $backup
}

$css = @'

/* =========================================================
   THEMOZHI CORPUS — WIDE WORKSPACE PATCH
   Added for processing / transcription / annotation workspace
   ========================================================= */

main.container {
  max-width: 1560px !important;
  width: min(calc(100% - 32px), 1560px);
}

/* Processing screen: give the source document more room */
.processing-grid {
  grid-template-columns:
    minmax(0, 1.15fr)
    minmax(400px, 0.85fr) !important;
  gap: 22px !important;
}

/* Transcription / page review screen */
.review-page-grid {
  grid-template-columns:
    minmax(0, 1.25fr)
    minmax(400px, 0.75fr) !important;
  gap: 22px !important;
}

/* Make previews tall enough to work with comfortably */
.source-preview img,
.source-preview iframe,
.page-preview img,
.page-preview iframe {
  max-width: 100% !important;
  height: clamp(520px, 68vh, 780px) !important;
  object-fit: contain;
}

/* Avoid grid children forcing the workspace wider than the page */
.processing-grid > *,
.review-page-grid > * {
  min-width: 0;
}

/* Keep the workflow usable on smaller screens */
@media (max-width: 1050px) {
  main.container {
    width: min(calc(100% - 24px), 1560px);
  }

  .processing-grid,
  .review-page-grid {
    grid-template-columns: 1fr !important;
  }

  .source-preview img,
  .source-preview iframe,
  .page-preview img,
  .page-preview iframe {
    height: auto !important;
    max-height: 70vh;
  }
}
/* END THEMOZHI CORPUS — WIDE WORKSPACE PATCH */
'@

Add-Content -Path $style -Value "`r`n$css`r`n" -Encoding UTF8

Write-Host ""
Write-Host "SUCCESS: style.css has been updated." -ForegroundColor Green
Write-Host ""
Write-Host "Backup created as: style.css.before-wide-ui.bak"
Write-Host "Upload the UPDATED style.css to the ROOT of your GitHub corpus repository."
Write-Host "Replace the existing style.css when GitHub asks."
Write-Host ""
Read-Host "Press Enter to close"
