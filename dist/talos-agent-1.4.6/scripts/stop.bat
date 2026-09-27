@echo off
REM ============================================================
REM  Talos Agent - one-click stop
REM
REM    scripts\stop.bat
REM
REM  Stops every agent JVM started from this install directory.
REM  The scheduled task TalosAgentWatchdog would restart it within
REM  5 minutes; run scripts\uninstall.bat if you want it to stay down.
REM  Keep this file pure ASCII.
REM ============================================================
setlocal
cd /d "%~dp0\.."

echo [Talos] stopping agent ...
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'java.exe' -and $_.CommandLine -like '*talos-agent.jar*' }; if (-not $p) { Write-Host '[Talos] agent is not running'; exit 0 }; foreach ($x in $p) { Write-Host ('[Talos] stopping PID ' + $x.ProcessId); Stop-Process -Id $x.ProcessId -Force }; Start-Sleep -Seconds 1; Write-Host '[Talos] stopped'"

if exist "logs\.talos-agent.lock" del /f /q "logs\.talos-agent.lock" >nul 2>&1
echo [Talos] done.
exit /b 0
