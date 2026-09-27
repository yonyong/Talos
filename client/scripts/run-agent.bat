@echo off
REM ============================================================
REM  Talos Agent keeper
REM  Triggered by scheduled task TalosAgentWatchdog every 5 minutes,
REM  and by scripts\start.bat for a manual start.
REM  Single-instance is enforced inside the JVM via logs\.talos-agent.lock,
REM  so a repeated trigger just starts and exits when an agent is running.
REM  Keep this file pure ASCII.
REM ============================================================
cd /d "%~dp0\.."

if not exist logs mkdir logs

REM Pick a log file we can actually write to.
REM The previous agent keeps logs\agent.log open through the redirect of the cmd
REM that launched it. Right after a silent upgrade that handle can still exist,
REM and a failing redirect aborts this whole script - the machine would be left
REM with NO agent, silently. Probe first and fall back to a per-session log;
REM AgentLogTail reads the newest agent*.log, so the console still follows it.
REM
REM The probe is a rename: cmd's own redirect failure does NOT set errorlevel
REM (verified), but ren on a file held by another process reliably does.
set "LOG=logs\agent.log"
if not exist "%LOG%" goto logready
ren "%LOG%" "%LOG%.probe" 2>nul
if errorlevel 1 goto loglocked
ren "%LOG%.probe" "%LOG%" 2>nul
goto logready

:loglocked
set "LOG=logs\agent-%RANDOM%%RANDOM%.log"
goto logready

:logready

if not exist conf\agent.yml (
  echo [Talos] conf\agent.yml not found. Run scripts\install.bat first.>> "%LOG%"
  exit /b 1
)

REM Startup problems must land in the log: this script is normally launched
REM without a console (spawned by the upgrade applier or by Task Scheduler),
REM so anything printed to the console would disappear without a trace.
where java >nul 2>&1
if errorlevel 1 (
  echo [Talos] ERROR: java not found on PATH, cannot start the agent. Install JRE 17+.>> "%LOG%"
  exit /b 1
)
if not exist talos-agent.jar (
  echo [Talos] ERROR: talos-agent.jar missing, cannot start the agent.>> "%LOG%"
  exit /b 1
)

if /i not "%LOG%"=="logs\agent.log" echo [Talos] WARNING: logs\agent.log is locked, this session logs to %LOG%.>> "%LOG%"

REM -Dfile.encoding / sun.std* : force UTF-8 so the log stays readable
REM regardless of the OS codepage (a GBK log read as UTF-8 shows mojibake).
java -Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8 ^
     -jar talos-agent.jar >> "%LOG%" 2>&1

echo [Talos] agent process exited with code %errorlevel%>> "%LOG%"
