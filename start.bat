@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "LOG_DIR=%~dp0logs"
set "PID_DIR=%~dp0.pids"
set "SERVER_PORT=3000"
set "CLIENT_PORT=5173"

:: Route to command
if "%~1"=="" goto :menu
if /i "%~1"=="start"   goto :do_start
if /i "%~1"=="stop"    goto :do_stop
if /i "%~1"=="restart" goto :do_restart
if /i "%~1"=="status"  goto :do_status
if /i "%~1"=="logs"    goto :do_logs
if /i "%~1"=="help"    goto :do_help
echo [ERROR] Unknown command: %~1
goto :do_help

:: ============================================================
:menu
:: ============================================================
title DBwiki Manager
cls
echo.
echo  ============================================
echo    DBwiki - Data Dictionary Management
echo  ============================================
echo.
call :check_node
if %errorlevel% neq 0 ( pause & exit /b 1 )
echo.
call :show_status_line
echo.
echo   [1] Start    [2] Stop      [3] Restart
echo   [4] Status   [5] Logs      [6] Exit
echo.
set "choice="
set /p "choice=  Select (1-6): "
if "%choice%"=="1" goto :do_start
if "%choice%"=="2" goto :do_stop
if "%choice%"=="3" goto :do_restart
if "%choice%"=="4" goto :do_status
if "%choice%"=="5" goto :do_logs
if "%choice%"=="6" exit /b 0
echo [ERROR] Invalid selection.
goto :menu

:: ============================================================
:do_help
:: ============================================================
echo.
echo  Usage: start.bat ^<command^>
echo.
echo  Commands:
echo    start    Start backend and frontend servers
echo    stop     Stop all running servers
echo    restart  Restart all servers
echo    status   Show running status and port info
echo    logs     Show recent server logs (tail)
echo    help     Show this help message
echo.
echo  If no command given, an interactive menu is shown.
echo.
exit /b 0

:: ============================================================
:do_start
:: ============================================================
echo.
echo  ---- Starting DBwiki ----
echo.

call :check_node
if %errorlevel% neq 0 ( pause & exit /b 1 )
call :ensure_deps
call :ensure_dirs

:: Check if already running
call :get_pid %SERVER_PORT%
if !ERRORLEVEL! equ 0 (
    echo [WARN] Backend already running on port %SERVER_PORT%.
    echo        Use "start.bat restart" to restart.
    echo.
    pause
    exit /b 1
)

:: Start backend in background
echo [1/2] Starting backend (port %SERVER_PORT%)...
if not exist "%LOG_DIR%\server.log" type nul > "%LOG_DIR%\server.log"
start "DBwiki-Server" /min cmd /c "cd /d "%~dp0" && npx tsx server/src/index.ts >> "%LOG_DIR%\server.log" 2>&1"

:: Wait for backend to be ready
call :wait_for_port %SERVER_PORT% 15
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Backend failed to start within 15s. Check logs: %LOG_DIR%\server.log
    pause
    exit /b 1
)
call :get_pid %SERVER_PORT%
echo       Backend PID: !PID! ^| Log: logs\server.log

:: Start frontend in background
echo [2/2] Starting frontend (port %CLIENT_PORT%)...
if not exist "%LOG_DIR%\client.log" type nul > "%LOG_DIR%\client.log"
start "DBwiki-Client" /min cmd /c "cd /d "%~dp0" && npx vite client/ --host 0.0.0.0 --port %CLIENT_PORT% >> "%LOG_DIR%\client.log" 2>&1"

:: Wait for frontend
call :wait_for_port %CLIENT_PORT% 15
if %ERRORLEVEL% neq 0 (
    echo [WARN] Frontend may not have started. Check logs: %LOG_DIR%\client.log
) else (
    call :get_pid %CLIENT_PORT%
    echo       Frontend PID: !PID! ^| Log: logs\client.log
)

echo.
echo  ============================================
echo   Backend:   http://localhost:%SERVER_PORT%
echo   Frontend:  http://localhost:%CLIENT_PORT%
echo   Account:   admin / admin123
echo  ============================================
echo   Logs:   start.bat logs
echo   Stop:   start.bat stop
echo  ============================================
echo.
exit /b 0

:: ============================================================
:do_stop
:: ============================================================
echo.
echo  ---- Stopping DBwiki ----
echo.
set "stopped=0"

call :kill_port %SERVER_PORT% "Backend"
if !ERRORLEVEL! equ 0 set "stopped=1"

call :kill_port %CLIENT_PORT% "Frontend"
if !ERRORLEVEL! equ 0 set "stopped=1"

if "!stopped!"=="0" (
    echo [INFO] No DBwiki processes found running.
) else (
    echo.
    echo [OK] All DBwiki processes stopped.
)
echo.
exit /b 0

:: ============================================================
:do_restart
:: ============================================================
call :do_stop
ping 127.0.0.1 -n 3 >nul
call :do_start
exit /b 0

:: ============================================================
:do_status
:: ============================================================
cls
echo.
echo  ---- DBwiki Status ----
echo.
call :show_status_line
echo.

:: Show log file sizes
if exist "%LOG_DIR%\server.log" (
    for %%A in ("%LOG_DIR%\server.log") do echo   Server log:  %%~zA bytes
)
if exist "%LOG_DIR%\client.log" (
    for %%A in ("%LOG_DIR%\client.log") do echo   Client log:  %%~zA bytes
)
echo.
exit /b 0

:: ============================================================
:do_logs
:: ============================================================
echo.
echo  ---- DBwiki Logs ----
echo.

if "%~2"=="client" (
    set "log_file=%LOG_DIR%\client.log"
    set "log_label=Client"
) else if "%~2"=="server" (
    set "log_file=%LOG_DIR%\server.log"
    set "log_label=Server"
) else (
    set "log_file=%LOG_DIR%\server.log"
    set "log_label=Server"
)

if not exist "!log_file!" (
    echo [INFO] No log file found: !log_file!
    echo        Start the server first: start.bat start
    echo.
    exit /b 0
)

echo  Showing last 50 lines of !log_label! log:
echo  (Use "start.bat logs server" or "start.bat logs client" to switch)
echo  -------------------------------------------
powershell -Command "Get-Content '%log_file%' -Tail 50"
echo  -------------------------------------------
echo.
exit /b 0

:: ============================================================
::  Helper Functions
:: ============================================================

:check_node
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install Node.js 18+ first.
    echo         https://nodejs.org/
    exit /b 1
)
exit /b 0

:ensure_deps
if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    call npm install --silent
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed.
        exit /b 1
    )
    echo [OK] Dependencies installed.
)
exit /b 0

:ensure_dirs
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
if not exist "%PID_DIR%" mkdir "%PID_DIR%"
exit /b 0

:: Get PID listening on a given port, sets PID var, ERRORLEVEL 0=found 1=not found
:get_pid
set "PID="
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%~1 " ^| findstr "LISTENING"') do (
    set "PID=%%a"
)
if defined PID ( exit /b 0 ) else ( exit /b 1 )

:: Kill process on a port
:kill_port
call :get_pid %~1
if %ERRORLEVEL% neq 0 (
    echo [INFO] %~2 [port %~1]: not running.
    exit /b 1
)
echo [STOP] %~2 [port %~1]: killing PID !PID!...
taskkill /F /PID !PID! >nul 2>&1
if %errorlevel% equ 0 (
    echo       Killed.
    exit /b 0
) else (
    echo       [WARN] Failed to kill PID !PID!.
    exit /b 1
)

:: Wait for a port to become available (args: port, timeout_seconds)
:wait_for_port
set /a "remain=%~2"
:wait_loop
if %remain% leq 0 exit /b 1
call :get_pid %~1
if %ERRORLEVEL% equ 0 exit /b 0
ping 127.0.0.1 -n 2 >nul
set /a "remain-=1"
goto :wait_loop

:: Show compact status line for both services
:show_status_line
call :get_pid %SERVER_PORT%
if %ERRORLEVEL% equ 0 (
    echo   Backend  [:%SERVER_PORT%]:  RUNNING  [PID !PID!]
) else (
    echo   Backend  [:%SERVER_PORT%]:  STOPPED
)
call :get_pid %CLIENT_PORT%
if !ERRORLEVEL! equ 0 (
    echo   Frontend [:%CLIENT_PORT%]:  RUNNING  [PID !PID!]
) else (
    echo   Frontend [:%CLIENT_PORT%]:  STOPPED
)
exit /b 0
