@echo off
setlocal
cd /d "%~dp0\.."

REM ============================================================
REM  Talos Agent uninstaller (Windows)
REM    1. remove the TalosAgentWatchdog scheduled task
REM    2. stop any running agent JVM
REM  Config (conf\agent.yml), logs and downloaded upgrade
REM  packages are kept - delete them manually for a full wipe.
REM  Keep this file pure ASCII.
REM ============================================================

echo [Talos] removing scheduled task TalosAgentWatchdog ...
schtasks /delete /tn "TalosAgentWatchdog" /f >nul 2>&1
if errorlevel 1 (
  echo [Talos]      task not found or access denied. Run as Administrator.
) else (
  echo [Talos]      scheduled task removed.
)

call "%~dp0stop.bat"

echo [Talos] Done. conf\, logs\ and upgrade\ were left in place.
exit /b 0
