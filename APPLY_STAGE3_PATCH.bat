@echo off
setlocal
cd /d "%~dp0"

if exist "index.html" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0APPLY_STAGE3_PATCH.ps1" -RepoPath "."
  exit /b
)

if exist "..\index.html" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0APPLY_STAGE3_PATCH.ps1" -RepoPath ".."
  exit /b
)

echo.
echo Could not find index.html.
echo Put this patch folder inside your extracted corpus repository folder,
echo beside index.html, app.js and style.css.
echo Then run APPLY_STAGE3_PATCH.bat again.
echo.
pause