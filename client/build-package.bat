@echo off
setlocal
cd /d "%~dp0"

REM ============================================================
REM  Talos Agent - build a distributable package
REM
REM    client\build-package.bat [--skip-build]
REM
REM  Output:
REM    client\target\talos-agent.jar                     shaded fat jar
REM    client\dist\talos-agent-<version>\                unpacked package
REM    client\dist\talos-agent-<version>-win.zip         zip to hand out
REM
REM  The server serves the release straight from client\target
REM  (talos.agent.release-dir), so silent upgrades pick up the new
REM  version as soon as this script finishes.
REM  Keep this file pure ASCII.
REM ============================================================

set "MVN=%TALOS_MVN%"
if "%MVN%"=="" set "MVN=mvn"
where %MVN% >nul 2>&1
if errorlevel 1 (
  if exist "D:\develop\tool\apache-maven-3.9.9\bin\mvn.cmd" (
    set "MVN=D:\develop\tool\apache-maven-3.9.9\bin\mvn.cmd"
  ) else (
    echo [Talos] ERROR: maven not found. Set TALOS_MVN to your mvn path.
    exit /b 1
  )
)

for /f %%v in ('powershell -NoProfile -Command "([xml](Get-Content 'pom.xml')).project.version"') do set "VER=%%v"
if "%VER%"=="" (
  echo [Talos] ERROR: cannot read version from pom.xml
  exit /b 1
)

echo [Talos] ============================================
echo [Talos]  Building Talos Agent %VER%
echo [Talos] ============================================

if /i "%~1"=="--skip-build" goto assemble

echo [Talos] mvn clean package ...
call "%MVN%" -B -DskipTests -Dfile.encoding=UTF-8 clean package
if errorlevel 1 (
  echo [Talos] ERROR: build failed.
  exit /b 1
)

:assemble
if not exist target\talos-agent.jar (
  echo [Talos] ERROR: target\talos-agent.jar not found. Run without --skip-build.
  exit /b 1
)

set "DIST=dist\talos-agent-%VER%"
echo [Talos] assembling %DIST% ...
if exist "%DIST%" rmdir /s /q "%DIST%"
mkdir "%DIST%"
if not exist "%DIST%\logs" mkdir "%DIST%\logs"
if not exist "%DIST%\conf" mkdir "%DIST%\conf"
if not exist "%DIST%\scripts" mkdir "%DIST%\scripts"

copy /y target\talos-agent.jar "%DIST%\talos-agent.jar" >nul
xcopy /e /i /y conf\* "%DIST%\conf\" >nul
xcopy /e /i /y scripts\* "%DIST%\scripts\" >nul
copy /y setup.bat "%DIST%\setup.bat" >nul

> "%DIST%\README.txt" echo Talos Agent %VER%
>> "%DIST%\README.txt" echo.
>> "%DIST%\README.txt" echo 1. Copy this folder to the target machine, e.g. C:\Talos
>> "%DIST%\README.txt" echo 2. Double-click setup.bat  (or run: scripts\install.bat --server HOST:9443 --token TOKEN)
>> "%DIST%\README.txt" echo 3. It writes conf\agent.yml, registers the keepalive task and starts the agent.
>> "%DIST%\README.txt" echo.
>> "%DIST%\README.txt" echo Other commands:
>> "%DIST%\README.txt" echo   scripts\start.bat     start the agent
>> "%DIST%\README.txt" echo   scripts\stop.bat      stop the agent
>> "%DIST%\README.txt" echo   scripts\status.bat    show status and recent logs
>> "%DIST%\README.txt" echo   scripts\upgrade.bat   upgrade to the server's current release
>> "%DIST%\README.txt" echo   scripts\uninstall.bat remove the keepalive task and stop the agent
>> "%DIST%\README.txt" echo.
>> "%DIST%\README.txt" echo Requirements: JRE 17 or newer on PATH.

echo [Talos] zipping ...
powershell -NoProfile -Command "Compress-Archive -Path 'dist\talos-agent-%VER%\*' -DestinationPath 'dist\talos-agent-%VER%-win.zip' -Force"

echo [Talos] ============================================
echo [Talos]  Package ready
echo [Talos]    unpacked : %CD%\%DIST%
echo [Talos]    zip      : %CD%\dist\talos-agent-%VER%-win.zip
echo [Talos]    served   : client\target\talos-agent.jar  (version %VER%)
echo [Talos]  Console download page and silent upgrade both read this version.
echo [Talos] ============================================
exit /b 0
