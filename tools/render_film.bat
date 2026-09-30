@echo off
chcp 65001 >nul
rem Double-click to render every shot of this film (each folder under shots\ that has a scenes.js).
rem Needs Node.js and Chrome or Edge. Extra arguments are passed to render.mjs (e.g. --style=pixel).
cd /d "%~dp0"
set "STUDIO=%~dp0studio"
if not exist "%STUDIO%\tools\node_modules" (
  echo First run: installing render dependencies...
  pushd "%STUDIO%\tools"
  call npm install
  popd
)
node "%STUDIO%\tools\render.mjs" --batch="%~dp0shots" --all %*
echo.
echo Done. Log: shots\*\out\render_log.txt
pause
