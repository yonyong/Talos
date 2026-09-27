@echo off
REM ============================================================
REM  Talos Agent - one-click upgrade to the server's release
REM
REM    scripts\upgrade.bat
REM
REM  Asks the server (GET /api/agent/release) which version is
REM  current, downloads it, verifies SHA256, then stops the agent,
REM  replaces the jar and starts it again.
REM
REM  The agent can also upgrade itself silently: the server pushes a
REM  COMMAND UPGRADE over the reverse connection and the agent runs
REM  this same replacement flow in the background.
REM  Keep this file pure ASCII.
REM ============================================================
setlocal
cd /d "%~dp0\.."

set "ADDR="
set "HTTPPORT="
if exist conf\agent.yml (
  for /f "tokens=1,2" %%a in ('findstr /r /c:"^ *addr:" conf\agent.yml') do set "ADDR=%%b"
  for /f "tokens=1,2" %%a in ('findstr /r /c:"^ *httpPort:" conf\agent.yml') do set "HTTPPORT=%%b"
)
if "%ADDR%"=="" set "ADDR=localhost"
if "%HTTPPORT%"=="" set "HTTPPORT=8080"
set "BASE=http://%ADDR%:%HTTPPORT%"

if not exist upgrade mkdir upgrade
set "META=%TEMP%\talos-release.json"

echo ============================================
echo  Talos Agent upgrade
echo  server : %BASE%
echo ============================================

echo [Talos] 1/4 checking current release ...
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri '%BASE%/api/agent/release' -TimeoutSec 15 | ConvertTo-Json -Compress | Set-Content -Encoding ASCII '%META%' } catch { Write-Host ('[Talos] ERROR: cannot reach server - ' + $_.Exception.Message); exit 1 }"
if errorlevel 1 exit /b 1

set "TAVAIL="
set "TVER="
set "TSHA="
set "TURL="
for /f "usebackq tokens=1,* delims==" %%a in (`powershell -NoProfile -Command "$r = Get-Content '%META%' | ConvertFrom-Json; if ($r.available) { 'TAVAIL=1'; 'TVER=' + $r.version; 'TSHA=' + $r.sha256; 'TURL=' + $r.downloadUrl } else { 'TAVAIL=0' }"`) do set "%%a=%%b"

if not "%TAVAIL%"=="1" (
  echo [Talos] ERROR: the server has no agent release package.
  echo [Talos] Build one with client\build-package.bat and put the jar in the release dir.
  exit /b 1
)
echo [Talos]     latest version: %TVER%

set "DL=%TURL%"
echo %TURL% | findstr /b /i "http" >nul
if errorlevel 1 set "DL=%BASE%%TURL%"
set "NEWJAR=upgrade\talos-agent-%TVER%.jar"

echo [Talos] 2/4 downloading %DL% ...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri '%DL%' -OutFile '%NEWJAR%' -TimeoutSec 300 } catch { Write-Host ('[Talos] ERROR: download failed - ' + $_.Exception.Message); exit 1 }"
if errorlevel 1 exit /b 1

echo [Talos] 3/4 verifying SHA256 ...
set "ACT="
for /f %%h in ('powershell -NoProfile -Command "(Get-FileHash -Algorithm SHA256 '%NEWJAR%').Hash.ToLower()"') do set "ACT=%%h"
if /i not "%ACT%"=="%TSHA%" (
  echo [Talos] ERROR: checksum mismatch, refusing to install.
  echo [Talos]   expected %TSHA%
  echo [Talos]   actual   %ACT%
  del /f /q "%NEWJAR%" >nul 2>&1
  exit /b 1
)
echo [Talos]     checksum OK

echo [Talos] 4/4 stopping, replacing and restarting ...
REM this script runs in a real console, so the applier may safely detach
call "%~dp0stop.bat"
call "%~dp0apply-upgrade.bat" "%NEWJAR%" 0 --detach

echo [Talos] done. Verify with scripts\status.bat
exit /b %errorlevel%
