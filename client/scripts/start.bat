@echo off
REM ============================================================
REM  Talos Agent - one-click start (idempotent)
REM
REM    scripts\start.bat
REM
REM  Starts the agent minimized in the background. If an agent is
REM  already running, it does nothing (single instance is enforced
REM  by the file lock logs\.talos-agent.lock).
REM  Keep this file pure ASCII.
REM ============================================================
setlocal
cd /d "%~dp0\.."

if not exist conf\agent.yml (
  echo [Talos] conf\agent.yml not found.
  echo [Talos] Run scripts\install.bat first, then start again.
  exit /b 1
)
if not exist logs mkdir logs

powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'java.exe' -and $_.CommandLine -like '*talos-agent.jar*' }; if ($p) { exit 10 } else { exit 11 }"
if %errorlevel%==10 (
  echo [Talos] agent is already running. Nothing to do.
  echo [Talos] Run scripts\status.bat to inspect, scripts\stop.bat to stop.
  exit /b 0
)

echo [Talos] starting agent in background ...
REM Start-Process instead of "start": this script may itself be called from a
REM console-less parent (RMM / installer), where "start" can fail silently.
powershell -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','\"%CD%\scripts\run-agent.bat\"' -WindowStyle Hidden"
ping -n 6 127.0.0.1 >nul

powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'java.exe' -and $_.CommandLine -like '*talos-agent.jar*' }; if ($p) { foreach ($x in $p) { Write-Host ('[Talos] started, PID ' + $x.ProcessId) } } else { Write-Host '[Talos] process not found yet - check logs\agent.log' }"
exit /b 0
