@echo off
REM ============================================================
REM  Talos Agent - one-click status
REM
REM    scripts\status.bat
REM
REM  Shows install dir, server config, process state, jar version
REM  and the last lines of logs\agent.log.
REM  Keep this file pure ASCII.
REM ============================================================
setlocal
cd /d "%~dp0\.."

set "ADDR="
set "PORT="
set "HTTPPORT="
set "CID="
if exist conf\agent.yml (
  for /f "tokens=1,2" %%a in ('findstr /r /c:"^ *addr:" conf\agent.yml') do set "ADDR=%%b"
  for /f "tokens=1,2" %%a in ('findstr /r /c:"^ *port:" conf\agent.yml') do set "PORT=%%b"
  for /f "tokens=1,2" %%a in ('findstr /r /c:"^ *httpPort:" conf\agent.yml') do set "HTTPPORT=%%b"
  for /f "tokens=1,2" %%a in ('findstr /r /c:"^ *id:" conf\agent.yml') do set "CID=%%b"
)

echo ============================================
echo  Talos Agent status
echo ============================================
echo  install dir : %CD%
echo  client id   : %CID%
echo  server grpc : %ADDR%:%PORT%
echo  server http : %ADDR%:%HTTPPORT%

if not exist talos-agent.jar (
  echo  agent jar   : MISSING - run scripts\install.bat
  exit /b 1
)

for %%f in (talos-agent.jar) do echo  agent jar   : %%~zf bytes, %%~~tf

powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'java.exe' -and $_.CommandLine -like '*talos-agent.jar*' }; if ($p) { foreach ($x in $p) { Write-Host ('  process     : RUNNING, PID ' + $x.ProcessId) } } else { Write-Host '  process     : NOT RUNNING' }"

schtasks /query /tn "TalosAgentWatchdog" >nul 2>&1
if errorlevel 1 (
  echo  watchdog    : not registered
) else (
  echo  watchdog    : registered ^(every 5 minutes^)
)

echo --------------------------------------------
echo  last log lines ^(newest logs\agent*.log^):
echo --------------------------------------------
powershell -NoProfile -Command "$f = Get-ChildItem 'logs\agent*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if ($f) { Write-Host ('  log file    : logs\' + $f.Name); Get-Content $f.FullName -Tail 15 } else { Write-Host '  (no log yet)' }"
echo ============================================
exit /b 0
