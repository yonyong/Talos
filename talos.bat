@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM ============================================================
REM  Talos one-click launcher
REM
REM    talos.bat            same as "start"
REM    talos.bat start      stop any previous instance, then start
REM    talos.bat stop       stop server + web, free 8080 / 9443 / 5173
REM    talos.bat status     show what currently holds the ports
REM
REM  start is idempotent: it ALWAYS stops a previous instance first.
REM  Otherwise the old JVM keeps holding 8080/9443 and Tomcat dies with
REM  "Web server failed to start. Port 8080 was already in use."
REM  So a manual "stop" before "start" is no longer necessary.
REM
REM  NOTE: keep this file pure ASCII. Non-ASCII bytes shift cmd.exe's
REM  file offset after a codepage switch and corrupt command parsing.
REM ============================================================

set "HTTP_PORT=8080"
set "GRPC_PORT=9443"
set "WEB_PORT=5173"

REM ===== locate the built server jar (exclude any 'original-' shaded leftovers) =====
set "SERVER_JAR="
for /f "delims=" %%f in ('dir /b server\target\talos-server-*.jar 2^>nul ^| findstr /v "original"') do set "SERVER_JAR=%%f"

if /i "%1"=="stop"    goto :stop
if /i "%1"=="start"   goto :start
if /i "%1"=="restart" goto :start
if /i "%1"=="status"  goto :status
if "%1"==""           goto :start
echo Usage: talos.bat [start^|stop^|status]
exit /b 1

REM ------------------------------------------------------------
:start
  where java >nul 2>&1 || (
    echo [Talos] ERROR: java not found on PATH. Install JDK 17+ and retry.
    exit /b 1
  )
  if not defined SERVER_JAR (
    echo [Talos] ERROR: server jar not found at server/target/talos-server-*.jar
    echo [Talos] Run talos-build.bat first to build the server jar.
    exit /b 1
  )

  REM ===== 1/3 free the ports: stop a previous instance =====
  echo [Talos] Checking for a previous instance...
  call :stop_all
  call :wait_ports_free
  if errorlevel 1 (
    echo [Talos] ERROR: the ports listed above are still held.
    echo [Talos] Free them manually, then run talos.bat start again.
    exit /b 1
  )

  REM ===== 2/3 start backend + frontend dev server =====
  REM Avoid ambient SERVER__PORT (injected by some dev tooling) overriding our port.
  REM Command-line args win over env vars, so ports are fixed regardless of environment.
  set "SERVER__PORT="
  echo [Talos] Starting backend: java -jar server/target/%SERVER_JAR% --server.port=%HTTP_PORT% --grpc.server.port=%GRPC_PORT%
  start "Talos-Server" cmd /c "java -jar server/target/%SERVER_JAR% --server.port=%HTTP_PORT% --grpc.server.port=%GRPC_PORT% & pause"

  echo [Talos] Starting frontend dev server (npm run dev)...
  start "Talos-Web" cmd /c "cd web && npm run dev & pause"

  REM ===== 3/3 wait until the backend really accepts connections =====
  echo [Talos] Waiting for backend on port %HTTP_PORT% ...
  call :wait_port_up %HTTP_PORT%
  if errorlevel 1 (
    echo [Talos] WARNING: backend not listening after 30s.
    echo [Talos] Check the "Talos-Server" console window for the startup error.
  ) else (
    echo [Talos] Backend is up.
  )

  echo [Talos] ============================================
  echo [Talos] Started.
  echo [Talos]   Backend  : http://localhost:%HTTP_PORT%/   (SPA + /api, gRPC %GRPC_PORT%)
  echo [Talos]   Frontend : http://localhost:%WEB_PORT%/   (vite dev, proxies /api)
  echo [Talos] To stop:   talos.bat stop
  echo [Talos] ============================================
  goto :eof

REM ------------------------------------------------------------
:stop
  echo [Talos] Stopping Talos...
  call :stop_all
  call :wait_ports_free
  if errorlevel 1 (
    echo [Talos] WARNING: some ports are still held - see the list above.
  ) else (
    echo [Talos] Stopped. Ports %HTTP_PORT% / %GRPC_PORT% / %WEB_PORT% are free.
  )
  goto :eof

REM ------------------------------------------------------------
:status
  if defined SERVER_JAR (echo [Talos] jar   : server\target\%SERVER_JAR%) else (echo [Talos] jar   : not built)
  echo [Talos] ports : %HTTP_PORT% http / %GRPC_PORT% grpc / %WEB_PORT% web
  call :list_ports
  echo [Talos] (nothing listed above means Talos is not listening)
  curl -s -o nul --noproxy "*" -w "[Talos] HTTP / -> %%{http_code}\n" http://localhost:%HTTP_PORT%/ 2>nul
  goto :eof

REM ============================================================
REM  helpers
REM ============================================================

REM ----- stop server + web: by listening port, then by console window title -----
:stop_all
  call :killport %HTTP_PORT%
  call :killport %GRPC_PORT%
  call :killport %WEB_PORT%
  taskkill /F /FI "WINDOWTITLE eq Talos-Server" >nul 2>&1
  taskkill /F /FI "WINDOWTITLE eq Talos-Web"    >nul 2>&1
  goto :eof

REM ----- kill whatever LISTENS on a TCP port (java.exe / node.exe only) -----
REM   Only listening sockets are matched (foreign addr ":0"), so outbound
REM   clients that merely connect to the same port are never touched. The
REM   bracketed IPv6 twin of each listener is dropped, so one line per PID.
:killport
  set "port=%~1"
  for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr /c:":%port% " ^| findstr "LISTENING" ^| findstr /c:":0 " ^| findstr /v /c:"["') do (
    set "img=?"
    for /f "tokens=1 delims=," %%n in ('tasklist /FI "PID eq %%a" /FO CSV /NH 2^>nul') do set "img=%%~n"
    if /i "!img!"=="java.exe" (
      echo [Talos]   port %port% - PID %%a !img! : stopping
      taskkill /F /PID %%a >nul 2>&1
    ) else (
      if /i "!img!"=="node.exe" (
        echo [Talos]   port %port% - PID %%a !img! : stopping
        taskkill /F /PID %%a >nul 2>&1
      ) else (
        echo [Talos]   port %port% - PID %%a !img! : SKIPPED, not java/node
      )
    )
  )
  goto :eof

REM ----- print who currently holds the ports -----
:list_ports
  for %%p in (%HTTP_PORT% %GRPC_PORT% %WEB_PORT%) do (
    for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr /c:":%%p " ^| findstr "LISTENING" ^| findstr /c:":0 " ^| findstr /v /c:"["') do (
      for /f "tokens=1 delims=," %%n in ('tasklist /FI "PID eq %%a" /FO CSV /NH 2^>nul') do echo [Talos]   port %%p - PID %%a : %%~n
    )
  )
  goto :eof

REM ----- wait until HTTP/GRPC/WEB ports are all free (max 10s) -----
:wait_ports_free
  set /a _n=0
:wait_free_loop
  set "_busy="
  for %%p in (%HTTP_PORT% %GRPC_PORT% %WEB_PORT%) do (
    for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr /c:":%%p " ^| findstr "LISTENING" ^| findstr /c:":0 " ^| findstr /v /c:"["') do set "_busy=1"
  )
  if not defined _busy exit /b 0
  set /a _n+=1
  if !_n! geq 10 (
    echo [Talos] WARNING: ports still busy after 10s:
    call :list_ports
    exit /b 1
  )
  ping -n 2 127.0.0.1 >nul
  goto :wait_free_loop

REM ----- wait until a single port is listening (max 30s) -----
:wait_port_up
  set /a _u=0
:wait_up_loop
  set "_up="
  for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr /c:":%~1 " ^| findstr "LISTENING" ^| findstr /c:":0 " ^| findstr /v /c:"["') do set "_up=1"
  if defined _up exit /b 0
  set /a _u+=1
  if !_u! geq 30 exit /b 1
  ping -n 2 127.0.0.1 >nul
  goto :wait_up_loop
