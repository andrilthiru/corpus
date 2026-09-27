@echo off
setlocal
cd /d "%~dp0"

if exist "style.css.before-wide-ui.bak" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0UNDO_UI_FIX.ps1" -RepoPath "."
  exit /b
)

if exist "..\style.css.before-wide-ui.bak" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0UNDO_UI_FIX.ps1" -RepoPath ".."
  exit /b
)

echo.
echo Backup not found.
echo.
pause
