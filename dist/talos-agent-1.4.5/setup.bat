@echo off
REM ============================================================
REM  Talos Agent - one-click setup (double-click me)
REM
REM    setup.bat --server HOST:9443 --token TOKEN --id CLIENT_ID
REM    setup.bat                          (existing conf\agent.yml is
REM                                        reused as-is; prompts only
REM                                        on first-time install)
REM
REM  Generates conf\agent.yml, registers the keepalive scheduled
REM  task and starts the agent. Equivalent to scripts\install.bat.
REM  Keep this file pure ASCII.
REM ============================================================
setlocal
cd /d "%~dp0"

if not "%~1"=="" (
  call "%~dp0scripts\install.bat" %*
  exit /b %errorlevel%
)

if exist "%~dp0conf\agent.yml" (
  echo ============================================
  echo  Talos Agent - one-click setup
  echo ============================================
  echo.
  echo  Existing conf\agent.yml detected - reusing its settings.
  echo  Pass --server HOST:9443 --token TOKEN --id ID to override,
  echo  or delete conf\agent.yml to run first-time setup again.
  echo.
  call "%~dp0scripts\install.bat"
  echo.
  echo [Talos] Press any key to close this window.
  pause >nul
  exit /b %errorlevel%
)

echo ============================================
echo  Talos Agent - one-click setup
echo ============================================
echo.
echo  Press Enter to accept a default value.
echo  Tip: pass arguments to skip the prompts entirely, e.g.
echo       setup.bat --server talos.yonyong.dev:9443 --token abc --id my-pc
echo.

set "SRV=localhost:9443"
set "TOK="
set "CID="

set /p "SRV=Server address [localhost:9443]: "
set /p "TOK=Enrollment token (optional): "
set /p "CID=Client id [this hostname]: "

echo.
call "%~dp0scripts\install.bat" --server "%SRV%" --token "%TOK%" --id "%CID%"
echo.
echo [Talos] Press any key to close this window.
pause >nul
exit /b 0
