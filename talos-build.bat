@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM ===== resolve maven (use PATH, else fall back to known location) =====
set "MVN=mvn"
where mvn >nul 2>&1 || (
  if exist "D:\develop\tool\apache-maven-3.9.9\bin\mvn.cmd" (
    set "MVN=D:\develop\tool\apache-maven-3.9.9\bin\mvn.cmd"
  )
)
where java >nul 2>&1 || (
  echo [Talos] ERROR: java not found on PATH. Install JDK 17+ and retry.
  exit /b 1
)
where node >nul 2>&1 || (
  echo [Talos] ERROR: node/npm not found on PATH. Install Node 18+ and retry.
  exit /b 1
)

echo [Talos] ============================================
echo [Talos] 1/4 Building frontend (vite build)...
echo [Talos] ============================================
cd web
if not exist node_modules (
  echo [Talos] node_modules missing, running npm install...
  call npm install --no-audit --no-fund
)
call npm run build
if errorlevel 1 (
  echo [Talos] ERROR: frontend build failed.
  exit /b 1
)
cd ..

echo [Talos] ============================================
echo [Talos] 2/4 Injecting frontend static assets into server jar sources
echo [Talos] ============================================
call :inject_static >nul 2>&1
if not exist server\src\main\resources\static\index.html (
  echo [Talos] WARNING: static/index.html missing, retrying copy...
  call :inject_static >nul 2>&1
)
if not exist server\src\main\resources\static\index.html (
  echo [Talos] ERROR: failed to inject web/dist into server static dir.
  exit /b 1
)
echo [Talos] Copied web/dist -^> server/src/main/resources/static

echo [Talos] ============================================
echo [Talos] 3/4 Packaging server (Spring Boot fat jar + embedded SPA)
echo [Talos] ============================================
cd server
REM clean is required: maven does not remove stale assets left in target/classes
call "%MVN%" -q -DskipTests -Dfile.encoding=UTF-8 clean package
if errorlevel 1 (
  echo [Talos] ERROR: server packaging failed.
  exit /b 1
)
cd ..

echo [Talos] ============================================
echo [Talos] 4/4 Packaging client agent fat jar
echo [Talos] ============================================
cd client
call "%MVN%" -q -DskipTests -Dfile.encoding=UTF-8 clean package
if errorlevel 1 (
  echo [Talos] ERROR: client packaging failed.
  exit /b 1
)
cd ..

echo [Talos] ============================================
echo [Talos] Build complete.
echo [Talos]   server : server\target\talos-server-*.jar   (serves SPA at http://localhost:8080/)
echo [Talos]   client : client\target\talos-agent.jar     (java -jar to run agent daemon)
echo [Talos] Run talos.bat to start dev servers.
echo [Talos] ============================================
endlocal
exit /b 0

:inject_static
if exist server\src\main\resources\static rmdir /s /q server\src\main\resources\static
mkdir server\src\main\resources\static
robocopy web\dist server\src\main\resources\static /E /IS /NFL /NDL /NJH /NJS /NC /NS
exit /b 0
