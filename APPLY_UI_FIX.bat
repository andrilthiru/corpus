@echo off
setlocal
cd /d "%~dp0"

REM If this patch is inside its own folder, first try parent folder for style.css.
if exist "style.css" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0APPLY_UI_FIX.ps1" -RepoPath "."
  exit /b
)

if exist "..\style.css" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0APPLY_UI_FIX.ps1" -RepoPath ".."
  exit /b
)

echo.
echo Could not find style.css.
echo.
echo Put this patch folder inside your corpus repository folder.
echo It should sit next to index.html, app.js and style.css.
echo Then double-click APPLY_UI_FIX.bat again.
echo.
pause
