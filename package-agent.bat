@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM ============================================================
REM  Talos - build the production deployment package (AGENT)
REM
REM    package-agent.bat
REM
REM  Output:
REM    dist\talos-agent-<version>\                unpacked package
REM    dist\talos-agent-<version>-win.zip         for Windows machines
REM    dist\talos-agent-<version>-linux.tar.gz    for CentOS machines
REM
REM  One package covers both platforms:
REM    scripts\        Windows  (install/start/stop/status/upgrade/uninstall)
REM    scripts-linux\  Linux    (same set, crontab keepalive)
REM
REM  Build the jar first:  client\build-package.bat
REM  This script supersedes it for release packaging - it keeps the
REM  identical Windows layout and adds the Linux scripts on top.
REM
REM  Keep this file pure ASCII.
REM ============================================================

echo [Talos] ============================================
echo [Talos]  Talos Agent - packaging for production
echo [Talos] ============================================

REM ---------- 1/7 version ----------
set "VER="
for /f "delims=" %%v in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\talos-pack.ps1" -Task pomver -Path "%~dp0client\pom.xml" 2^>nul') do set "VER=%%v"
if not defined VER (
  echo [Talos] ERROR: cannot read the version from client\pom.xml
  exit /b 1
)

REM ---------- 2/7 the built jar ----------
if not exist "client\target\talos-agent.jar" (
  echo [Talos] ERROR: client\target\talos-agent.jar not found.
  echo [Talos]        Build it first:  client\build-package.bat
  exit /b 1
)
for %%s in ("client\target\talos-agent.jar") do set "JARSIZE=%%~zs"
echo [Talos] version : %VER%
echo [Talos] jar     : client\target\talos-agent.jar  (!JARSIZE! bytes)

REM ---------- 3/7 linux scripts present? ----------
set "LSH=0"
for /f %%c in ('dir /b "client\deploy\scripts-linux\*.sh" 2^>nul ^| find /c /v ""') do set "LSH=%%c"
if !LSH! LSS 6 (
  echo [Talos] ERROR: expected 6+ .sh files in client\deploy\scripts-linux, found !LSH!
  exit /b 1
)
if not exist "client\deploy\README.txt" (
  echo [Talos] ERROR: client\deploy\README.txt is missing.
  exit /b 1
)

REM ---------- 4/7 assemble ----------
set "PKGROOT=%CD%\dist\talos-agent-%VER%"
set "ZIPBALL=%CD%\dist\talos-agent-%VER%-win.zip"
set "TARBALL=%CD%\dist\talos-agent-%VER%-linux.tar.gz"

if not exist "dist" mkdir "dist"
if exist "%PKGROOT%" rmdir /s /q "%PKGROOT%"

echo [Talos] 4/7 assembling dist\talos-agent-%VER% ...
mkdir "%PKGROOT%"                    || goto :fail
mkdir "%PKGROOT%\conf"               || goto :fail
mkdir "%PKGROOT%\scripts"            || goto :fail
mkdir "%PKGROOT%\scripts-linux"      || goto :fail
mkdir "%PKGROOT%\logs"               || goto :fail
mkdir "%PKGROOT%\upgrade"            || goto :fail

copy /y "client\target\talos-agent.jar" "%PKGROOT%\talos-agent.jar" >nul || goto :fail
copy /y "client\conf\agent.yml"         "%PKGROOT%\conf\agent.yml"  >nul || goto :fail
copy /y "client\setup.bat"              "%PKGROOT%\setup.bat"       >nul || goto :fail
copy /y "client\deploy\README.txt"      "%PKGROOT%\README.txt"      >nul || goto :fail

xcopy /e /i /y /q "client\scripts" "%PKGROOT%\scripts\" >nul
if errorlevel 1 goto :fail
xcopy /e /i /y /q "client\deploy\scripts-linux" "%PKGROOT%\scripts-linux\" >nul
if errorlevel 1 goto :fail

REM ---------- 5/7 VERSION.txt ----------
for /f "delims=" %%h in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\talos-pack.ps1" -Task hash -Path "%~dp0client\target\talos-agent.jar" 2^>nul') do set "SHA=%%h"
for /f "delims=" %%t in ('powershell -NoProfile -Command "(Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')" 2^>nul') do set "NOW=%%t"
set "COMMIT="
for /f "delims=" %%c in ('git rev-parse --short HEAD 2^>nul') do set "COMMIT=%%c"

> "%PKGROOT%\VERSION.txt" echo Talos Agent %VER%
>> "%PKGROOT%\VERSION.txt" echo built      : %NOW%
>> "%PKGROOT%\VERSION.txt" echo jar        : talos-agent.jar
>> "%PKGROOT%\VERSION.txt" echo jar bytes  : %JARSIZE%
>> "%PKGROOT%\VERSION.txt" echo jar sha256 : %SHA%
if defined COMMIT (
  >> "%PKGROOT%\VERSION.txt" echo source     : %COMMIT%
)
>> "%PKGROOT%\VERSION.txt" echo windows    : scripts\       install with setup.bat
>> "%PKGROOT%\VERSION.txt" echo linux      : scripts-linux\ install.sh
>> "%PKGROOT%\VERSION.txt" echo server dir : appears in the console release dir

REM ---------- normalise line endings ----------
REM sh/yml/txt -> LF (Linux), bat -> CRLF (cmd.exe). The Windows
REM scripts ship with LF endings in the repo, which cmd.exe mostly
REM tolerates but can mis-parse inside ( ) blocks; fix it here.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\talos-pack.ps1" -Task eol -Root "%PKGROOT%"
if errorlevel 1 echo [Talos] WARNING: line-ending normalisation failed - scripts may carry wrong endings.

REM ---------- 6/7 archive ----------
echo [Talos] 6/7 archiving ...
set "ZIPOK="
set "TAROK="

powershell -NoProfile -Command "Compress-Archive -Path 'dist\talos-agent-%VER%\*' -DestinationPath 'dist\talos-agent-%VER%-win.zip' -Force"
if not errorlevel 1 set "ZIPOK=%ZIPBALL%"
if not defined ZIPOK echo [Talos] WARNING: building the Windows zip failed.

where tar >nul 2>&1
if not errorlevel 1 (
  tar -czf "%TARBALL%" -C "dist" "talos-agent-%VER%"
  if not errorlevel 1 set "TAROK=%TARBALL%"
) else (
  echo [Talos] WARNING: tar.exe not found, no Linux archive produced.
)
if not defined TAROK if not defined ZIPOK (
  echo [Talos] ERROR: no archive was produced.
  goto :fail
)

REM ---------- 7/7 report ----------
REM  NOTE: never put a bare ")" inside an echo that sits in a ( ) block -
REM  cmd reads it as the end of the block and truncates the line.
echo [Talos] ============================================
echo [Talos]  Package ready
echo [Talos]    unpacked : %PKGROOT%
if defined ZIPOK (
  for %%s in ("%ZIPOK%") do echo [Talos]    windows  : %ZIPOK%  %%~zs bytes
)
if defined TAROK (
  for %%s in ("%TAROK%") do echo [Talos]    linux    : %TAROK%  %%~zs bytes
)
echo [Talos]    jar sha256: %SHA%
echo [Talos]
echo [Talos]  Hand out:
echo [Talos]    Windows : unzip, then run  setup.bat
echo [Talos]              or  scripts\install.bat --server HOST:9443 --token TOKEN
echo [Talos]    CentOS  : tar -xzf talos-agent-%VER%-linux.tar.gz -C /opt/applications/talos-agent --strip-components=1
echo [Talos]              cd /opt/applications/talos-agent ^&^& chmod +x scripts-linux/*.sh
echo [Talos]              scripts-linux/install.sh --server HOST:9443 --token TOKEN
echo [Talos]
echo [Talos]  For silent agent upgrades, copy talos-agent.jar into the
echo [Talos]  server package's releases/ directory.
echo [Talos] ============================================
exit /b 0

:fail
echo [Talos] ERROR: packaging failed.
exit /b 1
