@echo off
setlocal
cd /d "%~dp0"

if exist "index.html.before-stage3-three-panel.bak" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0UNDO_STAGE3_PATCH.ps1" -RepoPath "."
  exit /b
)

if exist "..\index.html.before-stage3-three-panel.bak" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0UNDO_STAGE3_PATCH.ps1" -RepoPath ".."
  exit /b
)

echo.
echo Backup not found.
echo.
pause