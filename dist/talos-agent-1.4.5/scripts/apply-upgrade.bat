@echo off
REM ============================================================
REM  Talos Agent upgrade applier (Windows)
REM
REM    scripts\apply-upgrade.bat <staged-jar> <old-pid> [--detach]
REM
REM  Spawned by the running agent right before it exits: a JVM holds its
REM  own jar open, so it cannot replace itself and needs an outside hand.
REM
REM  Flow:
REM    0. wait for the old agent process to really exit
REM    1. back up the current jar
REM    2. retry copying the staged jar over talos-agent.jar until the old
REM       process releases the file (up to 90 seconds)
REM    3. drop the instance lock
REM    4. start the agent
REM
REM  Step 4 runs in the foreground by default: this script is normally
REM  launched WITHOUT a console, where "start" fails silently. With a real
REM  console (scripts\upgrade.bat) pass --detach to return to the prompt.
REM
REM  Whatever happens, the script still tries to leave an agent running -
REM  a failed copy leaves the old jar intact, so restarting it is safe.
REM  Output is appended to logs\upgrade.log by the caller.
REM  Keep this file pure ASCII.
REM ============================================================

set "STAGED=%~1"
set "OLDPID=%~2"
set "MODE=%~3"
cd /d "%~dp0.."

if "%STAGED%"=="" goto usage
if not exist "%STAGED%" (
  echo [Talos] ERROR: staged jar not found: %STAGED%
  exit /b 1
)
if not exist logs mkdir logs
if not exist upgrade mkdir upgrade

echo [Talos] ============================================
echo [Talos]  Applying agent upgrade
echo [Talos]  from : %STAGED%
echo [Talos]  to   : %CD%\talos-agent.jar
echo [Talos]  note : old pid %OLDPID%
echo [Talos] ============================================

REM ---- 0. wait until the old agent is really gone ----------------------
REM The old agent holds two things the new one needs: talos-agent.jar, and the
REM handle on logs\agent.log it inherited from the redirect of the cmd that
REM launched it. Swapping or starting while it is still alive makes cmd fail
REM with "file is being used by another process" and leaves the machine with
REM NO agent at all - the worst possible outcome for an unattended upgrade.
REM OLDPID=0 means the caller had nothing to wait for (scripts\upgrade.bat).
if "%OLDPID%"=="" goto nowait
if "%OLDPID%"=="0" goto nowait

set /a WAITED=0
:waitold
tasklist /FI "PID eq %OLDPID%" 2>nul | find "%OLDPID%" >nul
if errorlevel 1 goto oldgone
set /a WAITED+=1
if %WAITED% GEQ 60 goto oldstuck
ping -n 2 127.0.0.1 >nul
goto waitold

:oldstuck
echo [Talos] WARNING: old pid %OLDPID% still alive after 60s, continuing anyway
goto nowait

:oldgone
echo [Talos] old pid %OLDPID% exited (%WAITED%s), safe to swap

:nowait

if exist talos-agent.jar (
  copy /y talos-agent.jar "upgrade\backup-talos-agent.jar" >nul 2>&1
  echo [Talos] previous jar backed up to upgrade\backup-talos-agent.jar
)

set /a TRIES=0
:retry
copy /y "%STAGED%" talos-agent.jar >nul 2>&1
if not errorlevel 1 goto copied
set /a TRIES+=1
if %TRIES% GEQ 90 goto failed
echo [Talos] jar still locked (attempt %TRIES%), retrying ...
ping -n 2 127.0.0.1 >nul
goto retry

:copied
echo [Talos] jar replaced (attempts: %TRIES%)
del /f /q "%STAGED%" >nul 2>&1
goto restart

:failed
echo [Talos] WARNING: could not replace talos-agent.jar after 90s.
echo [Talos] Keeping the current version running. Staged package: %STAGED%
echo [Talos] Recover later with: scripts\stop.bat then scripts\upgrade.bat
goto restart

:restart
del /f /q "logs\.talos-agent.lock" >nul 2>&1
echo [Talos] starting agent ...
REM Not waiting for logs\agent.log here on purpose: that handle can stay taken
REM long after the old process is gone (the redirect outlives the JVM), and a
REM wait loop would just stall the upgrade. run-agent.bat probes the file
REM itself and falls back to a per-session log when it is taken.

if /i "%MODE%"=="--detach" (
  start "TalosAgent" /min cmd /c "scripts\run-agent.bat"
  echo [Talos] detached start requested, this script is done
  exit /b 0
)

REM Foreground: the agent becomes a child of this script, so it survives the
REM caller (the old agent process) exiting. This script then simply stays
REM resident for as long as the agent runs.
call "%~dp0run-agent.bat"
echo [Talos] agent exited with code %errorlevel%
exit /b 0

:usage
echo Usage: scripts\apply-upgrade.bat ^<staged-jar^> ^<old-pid^> [--detach]
exit /b 0
