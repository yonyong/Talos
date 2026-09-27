@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM ============================================================
REM  Talos - build the production deployment package (SERVER)
REM
REM    package-server.bat
REM
REM  Output:
REM    dist\talos-server-<version>\               unpacked package
REM    dist\talos-server-<version>-linux.tar.gz   ship this to CentOS
REM
REM  The package targets Linux: bin\*.sh and config\*.yml. This script
REM  only ASSEMBLES and ARCHIVES - build the jar first:
REM
REM    talos-build.bat     frontend + static injection + mvn package
REM
REM  Keep this file pure ASCII: non-ASCII bytes shift cmd.exe's file
REM  offset after a codepage switch and corrupt command parsing.
REM ============================================================

echo [Talos] ============================================
echo [Talos]  Talos Server - packaging for production
echo [Talos] ============================================

REM ---------- 1/6 version ----------
set "VER="
for /f "delims=" %%v in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\talos-pack.ps1" -Task pomver -Path "%~dp0server\pom.xml" 2^>nul') do set "VER=%%v"
if not defined VER (
  echo [Talos] ERROR: cannot read the version from server\pom.xml
  exit /b 1
)

REM ---------- 2/6 locate the built jar ----------
set "JAR="
for /f "delims=" %%f in ('dir /b server\target\talos-server-*.jar 2^>nul ^| findstr /v /c:"original"') do set "JAR=%%f"
if not defined JAR (
  echo [Talos] ERROR: no server\target\talos-server-*.jar found.
  echo [Talos]        Build it first:  talos-build.bat
  exit /b 1
)

set "JARVER=%JAR:.jar=%"
set "JARVER=%JARVER:talos-server-=%"
for %%s in ("server\target\%JAR%") do set "JARSIZE=%%~zs"

echo [Talos] version : %VER%  (from pom.xml)
echo [Talos] jar     : server\target\%JAR%   (!JARSIZE! bytes)
if /i not "%VER%"=="%JARVER%" (
  echo [Talos] NOTE    : pom says %VER% but the jar is %JARVER%
  echo [Talos]           the package is named after the jar.
)

REM ---------- 3/6 is the frontend really inside the jar? ----------
where jar >nul 2>&1
if errorlevel 1 (
  echo [Talos] spa     : jar tool not on PATH, check skipped
) else (
  set "HASSPA="
  for /f "delims=" %%x in ('jar tf "server\target\%JAR%" 2^>nul ^| findstr /c:"static/index.html"') do set "HASSPA=1"
  if defined HASSPA (
    echo [Talos] spa     : embedded static/index.html present
  ) else (
    echo [Talos] WARNING : the jar has no embedded frontend.
    echo [Talos]           The console would answer "No static resource".
    echo [Talos]           Run talos-build.bat to rebuild it with the SPA.
  )
)

REM ---------- 4/6 assemble the package tree ----------
set "PKGROOT=%CD%\dist\talos-server-%JARVER%"
set "TARBALL=%CD%\dist\talos-server-%JARVER%-linux.tar.gz"
set "ZIPBALL=%CD%\dist\talos-server-%JARVER%-linux.zip"

if not exist "dist" mkdir "dist"
if exist "%PKGROOT%" rmdir /s /q "%PKGROOT%"

echo [Talos] 4/6 assembling dist\talos-server-%JARVER% ...
mkdir "%PKGROOT%"                                     || goto :fail
mkdir "%PKGROOT%\app"                                 || goto :fail
mkdir "%PKGROOT%\app\backup"                          || goto :fail
mkdir "%PKGROOT%\bin"                                 || goto :fail
mkdir "%PKGROOT%\config"                              || goto :fail
mkdir "%PKGROOT%\data"                                || goto :fail
mkdir "%PKGROOT%\data\docs"                           || goto :fail
mkdir "%PKGROOT%\logs"                                || goto :fail
mkdir "%PKGROOT%\run"                                 || goto :fail
mkdir "%PKGROOT%\releases"                            || goto :fail
mkdir "%PKGROOT%\nginx"                               || goto :fail

copy /y "server\target\%JAR%" "%PKGROOT%\app\%JAR%" >nul   || goto :fail
xcopy /e /i /y /q "server\deploy\bin" "%PKGROOT%\bin\" >nul
if errorlevel 1 goto :fail
xcopy /e /i /y /q "server\deploy\config" "%PKGROOT%\config\" >nul
if errorlevel 1 goto :fail
xcopy /e /i /y /q "server\deploy\nginx" "%PKGROOT%\nginx\" >nul
if errorlevel 1 goto :fail
copy /y "server\deploy\README.txt" "%PKGROOT%\README.txt" >nul || goto :fail

REM ---------- 5/6 VERSION.txt ----------
for /f "delims=" %%h in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\talos-pack.ps1" -Task hash -Path "%~dp0server\target\%JAR%" 2^>nul') do set "SHA=%%h"
for /f "delims=" %%t in ('powershell -NoProfile -Command "(Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')" 2^>nul') do set "NOW=%%t"
set "COMMIT="
for /f "delims=" %%c in ('git rev-parse --short HEAD 2^>nul') do set "COMMIT=%%c"

> "%PKGROOT%\VERSION.txt" echo Talos Server %JARVER%
>> "%PKGROOT%\VERSION.txt" echo built      : %NOW%
>> "%PKGROOT%\VERSION.txt" echo package    : talos-server-%JARVER%-linux.tar.gz
>> "%PKGROOT%\VERSION.txt" echo jar        : app\%JAR%
>> "%PKGROOT%\VERSION.txt" echo jar bytes  : %JARSIZE%
>> "%PKGROOT%\VERSION.txt" echo jar sha256 : %SHA%
if defined COMMIT (
  >> "%PKGROOT%\VERSION.txt" echo source     : %COMMIT%
)
>> "%PKGROOT%\VERSION.txt" echo target dir : /opt/applications/talos
>> "%PKGROOT%\VERSION.txt" echo docs       : README.txt

REM ---------- normalise line endings before archiving ----------
REM sh/yml/txt -> LF (Linux), bat/ps1 -> CRLF (cmd.exe)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\talos-pack.ps1" -Task eol -Root "%PKGROOT%"
if errorlevel 1 echo [Talos] WARNING: line-ending normalisation failed - check bin\*.sh on the target host.

REM ---------- 6/6 archive ----------
echo [Talos] 6/6 archiving ...
set "ARCHIVED="
where tar >nul 2>&1
if not errorlevel 1 (
  tar -czf "%TARBALL%" -C "dist" "talos-server-%JARVER%"
  if not errorlevel 1 set "ARCHIVED=%TARBALL%"
)
if not defined ARCHIVED (
  echo [Talos] NOTE    : tar.exe unavailable or failed, falling back to .zip
  powershell -NoProfile -Command "Compress-Archive -Path 'dist\talos-server-%JARVER%\*' -DestinationPath 'dist\talos-server-%JARVER%-linux.zip' -Force"
  if not errorlevel 1 set "ARCHIVED=%ZIPBALL%"
)
if not defined ARCHIVED (
  echo [Talos] ERROR: archiving failed.
  goto :fail
)

set "APK=%ARCHIVED%"
set "APKSHA="
for /f "delims=" %%h in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\talos-pack.ps1" -Task hash -Path "%APK%" 2^>nul') do set "APKSHA=%%h"
for %%s in ("%APK%") do set "APKSIZE=%%~zs"

echo [Talos] ============================================
echo [Talos]  Package ready
echo [Talos]    unpacked : %PKGROOT%
echo [Talos]    archive  : %APK%
echo [Talos]    size     : %APKSIZE% bytes
echo [Talos]    sha256   : %APKSHA%
echo [Talos]
echo [Talos]  Deploy on CentOS:
echo [Talos]    mkdir -p /opt/applications/talos
echo [Talos]    tar -xzf talos-server-%JARVER%-linux.tar.gz -C /opt/applications/talos --strip-components=1
echo [Talos]    chmod +x /opt/applications/talos/bin/*.sh
echo [Talos]    cd /opt/applications/talos ^&^& bin/deploy.sh
echo [Talos]  Full instructions: README.txt inside the package.
echo [Talos] ============================================
exit /b 0

:fail
echo [Talos] ERROR: packaging failed.
exit /b 1
