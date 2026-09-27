@echo off
setlocal enabledelayedexpansion

rem ============================================================
rem  Talos console screenshot batch
rem  Captures every console page into .\shots\ so UI changes can
rem  be reviewed without opening a browser by hand.
rem
rem  Prereq: the server must be running on the base URL (default
rem          8080). Start it with talos.bat start, or directly:
rem          java -jar server\target\talos-server-1.4.3.jar
rem
rem  Usage:
rem    talos-shots.bat                        capture all pages
rem    talos-shots.bat --only dashboard,roles capture selected pages
rem    talos-shots.bat --base http://localhost:8080 --out-dir shots
rem
rem  ASCII keys: dashboard issues admission workflow monitor clients
rem              agents logs docs kb users roles
rem
rem  NOTE: keep this file pure ASCII. Non-ASCII bytes shift cmd.exe's
rem  file offset after a codepage switch and corrupt command parsing.
rem ============================================================

chcp 65001 >nul
cd /d "%~dp0"

set "NODE_EXE="
if exist "C:\Users\yd236\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" (
  set "NODE_EXE=C:\Users\yd236\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
) else (
  for /f "delims=" %%i in ('where node 2^>nul') do (
    if not defined NODE_EXE set "NODE_EXE=%%i"
  )
)
if not defined NODE_EXE (
  echo [Talos] ERROR: node.exe not found. Install Node.js 18+ first.
  exit /b 1
)

set "NODE_PATH=C:\Users\yd236\.workbuddy\binaries\node\workspace\node_modules"
set "NO_PROXY=*"
set "no_proxy=*"
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "http_proxy="
set "https_proxy="

echo [Talos] ============================================
echo [Talos] Capturing Talos console screenshots
echo [Talos] ============================================
"%NODE_EXE%" tools\capture-console.mjs %*
set "RC=%ERRORLEVEL%"

if "%RC%"=="0" (
  echo [Talos] Done. Screenshots in: shots
) else (
  echo [Talos] Finished with failures, exit=%RC%
)
endlocal & exit /b %RC%
