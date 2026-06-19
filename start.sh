#!/usr/bin/env bash
set -uo pipefail

# ============================================================
#  DBwiki Management Script
#  Usage: ./start.sh [start|stop|restart|status|logs|help]
# ============================================================

cd "$(dirname "$0")"

SERVER_PORT=3000
CLIENT_PORT=5173
LOG_DIR="$(pwd)/logs"
PID_DIR="$(pwd)/.pids"
SERVER_PID_FILE="$PID_DIR/server.pid"
CLIENT_PID_FILE="$PID_DIR/client.pid"
SERVER_LOG="$LOG_DIR/server.log"
CLIENT_LOG="$LOG_DIR/client.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ============================================================
#  Helpers
# ============================================================

check_node() {
    if ! command -v node &>/dev/null; then
        echo -e "${RED}[ERROR] Node.js not found. Install Node.js 18+ first.${NC}"
        echo "        https://nodejs.org/"
        return 1
    fi
    return 0
}

ensure_deps() {
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}[INFO]${NC} Installing dependencies..."
        npm install --silent
        echo -e "${GREEN}[OK]${NC} Dependencies installed."
    fi
}

ensure_dirs() {
    mkdir -p "$LOG_DIR" "$PID_DIR"
}

is_running() {
    local pid_file="$1"
    if [ -f "$pid_file" ]; then
        local pid
        pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
        rm -f "$pid_file"
    fi
    return 1
}

force_kill() {
    local pid="$1"
    if [ -z "$pid" ]; then return 0; fi
    # On Windows (Git Bash / MSYS), use taskkill for reliable kill
    if command -v taskkill &>/dev/null && [[ "$(uname -s 2>/dev/null)" == MINGW* || "$(uname -s 2>/dev/null)" == MSYS* || -n "$WINDIR" ]]; then
        taskkill //F //PID "$pid" >/dev/null 2>&1 || true
    else
        kill -9 "$pid" 2>/dev/null || true
    fi
}

get_port_pid() {
    local port="$1"
    # Try netstat first (works on Windows/Git Bash and most Linux)
    local pid
    pid=$(netstat -ano 2>/dev/null | grep ":${port} " | grep "LISTENING" | head -1 | awk '{print $5}')
    if [ -n "$pid" ] && [ "$pid" != "0" ]; then
        echo "$pid"
        return 0
    fi
    # Fallback to lsof
    if command -v lsof &>/dev/null; then
        pid=$(lsof -ti :"$port" 2>/dev/null | head -1)
        if [ -n "$pid" ]; then echo "$pid"; return 0; fi
    fi
    # Fallback to ss
    if command -v ss &>/dev/null; then
        pid=$(ss -tlnp "sport = :$port" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)
        if [ -n "$pid" ]; then echo "$pid"; return 0; fi
    fi
    echo ""
    return 1
}

wait_for_port() {
    local port="$1"
    local timeout="$2"
    local elapsed=0
    while [ $elapsed -lt $timeout ]; do
        local pid
        pid=$(get_port_pid "$port")
        if [ -n "$pid" ]; then
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done
    return 1
}

# ============================================================
#  Commands
# ============================================================

do_start() {
    echo ""
    echo -e "  ${BOLD}---- Starting DBwiki ----${NC}"
    echo ""

    check_node || { echo ""; read -rp "Press Enter to exit..."; exit 1; }
    ensure_deps
    ensure_dirs

    # Check if already running
    if is_running "$SERVER_PID_FILE"; then
        echo -e "${YELLOW}[WARN]${NC} Backend already running (PID $(cat "$SERVER_PID_FILE"))."
        echo "       Use './start.sh restart' to restart."
        echo ""
        return 1
    fi

    # Start backend
    echo -e "  [1/2] Starting backend (port $SERVER_PORT)..."
    mkdir -p "$LOG_DIR"
    npx tsx server/src/index.ts >> "$SERVER_LOG" 2>&1 &
    local server_pid=$!
    echo "$server_pid" > "$SERVER_PID_FILE"

    if wait_for_port "$SERVER_PORT" 20; then
        echo -e "        ${GREEN}OK${NC}  PID $server_pid  |  Log: logs/server.log"
    else
        echo -e "        ${RED}FAIL${NC}  Backend did not start within 20s."
        echo "        Check logs: $SERVER_LOG"
        rm -f "$SERVER_PID_FILE"
        return 1
    fi

    # Start frontend
    echo -e "  [2/2] Starting frontend (port $CLIENT_PORT)..."
    npx vite client/ --host 0.0.0.0 --port "$CLIENT_PORT" >> "$CLIENT_LOG" 2>&1 &
    local client_pid=$!
    echo "$client_pid" > "$CLIENT_PID_FILE"

    if wait_for_port "$CLIENT_PORT" 20; then
        echo -e "        ${GREEN}OK${NC}  PID $client_pid  |  Log: logs/client.log"
    else
        echo -e "        ${YELLOW}WARN${NC}  Frontend may not have started. Check: $CLIENT_LOG"
    fi

    echo ""
    echo -e "  ${BOLD}============================================${NC}"
    echo -e "   Backend:   ${CYAN}http://localhost:$SERVER_PORT${NC}"
    echo -e "   Frontend:  ${CYAN}http://localhost:$CLIENT_PORT${NC}"
    echo -e "   Account:   ${YELLOW}admin / admin123${NC}"
    echo -e "  ${BOLD}============================================${NC}"
    echo -e "   Logs:    ${DIM}./start.sh logs${NC}"
    echo -e "   Stop:    ${DIM}./start.sh stop${NC}"
    echo -e "   Status:  ${DIM}./start.sh status${NC}"
    echo -e "  ${BOLD}============================================${NC}"
    echo ""
}

do_stop() {
    echo ""
    echo -e "  ${BOLD}---- Stopping DBwiki ----${NC}"
    echo ""
    local stopped=0

    # Stop server
    if is_running "$SERVER_PID_FILE"; then
        local pid
        pid=$(cat "$SERVER_PID_FILE")
        echo -e "  ${RED}[STOP]${NC} Backend (PID $pid)..."
        kill "$pid" 2>/dev/null || true
        sleep 2
        # Force kill if still running
        if kill -0 "$pid" 2>/dev/null; then
            force_kill "$pid"
        fi
        rm -f "$SERVER_PID_FILE"
        echo -e "        Stopped."
        stopped=1
    else
        echo -e "  ${DIM}[INFO] Backend: not running.${NC}"
    fi

    # Stop client
    if is_running "$CLIENT_PID_FILE"; then
        local pid
        pid=$(cat "$CLIENT_PID_FILE")
        echo -e "  ${RED}[STOP]${NC} Frontend (PID $pid)..."
        kill "$pid" 2>/dev/null || true
        sleep 2
        if kill -0 "$pid" 2>/dev/null; then
            force_kill "$pid"
        fi
        rm -f "$CLIENT_PID_FILE"
        echo -e "        Stopped."
        stopped=1
    else
        echo -e "  ${DIM}[INFO] Frontend: not running.${NC}"
    fi

    # Also clean up by port (fallback for orphaned processes)
    sleep 1
    for port in $SERVER_PORT $CLIENT_PORT; do
        local orphan
        orphan=$(get_port_pid "$port")
        if [ -n "$orphan" ]; then
            echo -e "  ${YELLOW}[CLEAN]${NC} Killing orphaned process on port $port (PID $orphan)..."
            force_kill "$orphan"
        fi
    done

    if [ $stopped -eq 1 ]; then
        echo ""
        echo -e "  ${GREEN}[OK] All DBwiki processes stopped.${NC}"
    fi
    echo ""
}

do_restart() {
    do_stop
    sleep 1
    do_start
}

do_status() {
    echo ""
    echo -e "  ${BOLD}---- DBwiki Status ----${NC}"
    echo ""

    # Server
    if is_running "$SERVER_PID_FILE"; then
        local pid
        pid=$(cat "$SERVER_PID_FILE")
        echo -e "   Backend  (:$SERVER_PORT):  ${GREEN}RUNNING${NC}  (PID $pid)"
    else
        local orphan
        orphan=$(get_port_pid "$SERVER_PORT")
        if [ -n "$orphan" ]; then
            echo -e "   Backend  (:$SERVER_PORT):  ${YELLOW}ORPHAN${NC}   (PID $orphan, no pid file)"
        else
            echo -e "   Backend  (:$SERVER_PORT):  ${RED}STOPPED${NC}"
        fi
    fi

    # Client
    if is_running "$CLIENT_PID_FILE"; then
        local pid
        pid=$(cat "$CLIENT_PID_FILE")
        echo -e "   Frontend (:$CLIENT_PORT):  ${GREEN}RUNNING${NC}  (PID $pid)"
    else
        local orphan
        orphan=$(get_port_pid "$CLIENT_PORT")
        if [ -n "$orphan" ]; then
            echo -e "   Frontend (:$CLIENT_PORT):  ${YELLOW}ORPHAN${NC}   (PID $orphan, no pid file)"
        else
            echo -e "   Frontend (:$CLIENT_PORT):  ${RED}STOPPED${NC}"
        fi
    fi

    echo ""

    # Log sizes
    if [ -f "$SERVER_LOG" ]; then
        local size
        size=$(du -h "$SERVER_LOG" 2>/dev/null | cut -f1)
        echo -e "   Server log:  ${DIM}$SERVER_LOG ($size)${NC}"
    fi
    if [ -f "$CLIENT_LOG" ]; then
        local size
        size=$(du -h "$CLIENT_LOG" 2>/dev/null | cut -f1)
        echo -e "   Client log:  ${DIM}$CLIENT_LOG ($size)${NC}"
    fi
    echo ""
}

do_logs() {
    local target="${1:-server}"
    local log_file lines

    if [ "$target" = "client" ]; then
        log_file="$CLIENT_LOG"
        echo ""
        echo -e "  ${BOLD}---- Client Log (last 50 lines) ----${NC}"
    else
        log_file="$SERVER_LOG"
        echo ""
        echo -e "  ${BOLD}---- Server Log (last 50 lines) ----${NC}"
    fi

    echo -e "  ${DIM}Use './start.sh logs server' or './start.sh logs client'${NC}"
    echo -e "  ${DIM}Use './start.sh logs -f server' to follow in real-time${NC}"
    echo "  -------------------------------------------"

    if [ ! -f "$log_file" ]; then
        echo -e "  ${YELLOW}[INFO] No log file found. Start the server first.${NC}"
        echo ""
        return 0
    fi

    # Check for -f flag
    if [ "${1:-}" = "-f" ]; then
        target="${2:-server}"
        if [ "$target" = "client" ]; then
            log_file="$CLIENT_LOG"
        else
            log_file="$SERVER_LOG"
        fi
        tail -f "$log_file"
    else
        tail -50 "$log_file"
    fi

    echo "  -------------------------------------------"
    echo ""
}

do_help() {
    echo ""
    echo -e "  ${BOLD}DBwiki Management Script${NC}"
    echo ""
    echo -e "  Usage: ${CYAN}./start.sh <command>${NC}"
    echo ""
    echo "  Commands:"
    echo -e "    ${GREEN}start${NC}     Start backend and frontend servers"
    echo -e "    ${RED}stop${NC}      Stop all running servers"
    echo -e "    ${YELLOW}restart${NC}   Restart all servers"
    echo -e "    status    Show running status and port info"
    echo -e "    logs      Show recent server logs"
    echo -e "              ./start.sh logs [server|client]"
    echo -e "              ./start.sh logs -f [server|client]  (follow)"
    echo -e "    help      Show this help message"
    echo ""
    echo "  If no command is given, an interactive menu is shown."
    echo ""
}

show_menu() {
    clear 2>/dev/null || true
    echo ""
    echo -e "  ${BOLD}============================================${NC}"
    echo -e "  ${BOLD}  DBwiki - Data Dictionary Management${NC}"
    echo -e "  ${BOLD}============================================${NC}"
    echo ""

    check_node || { echo ""; read -rp "Press Enter to exit..."; exit 1; }

    echo ""
    do_status 2>/dev/null || true

    echo "    [1] Start    [2] Stop      [3] Restart"
    echo "    [4] Status   [5] Logs      [6] Exit"
    echo ""
    read -rp "  Select (1-6): " choice
    case "$choice" in
        1) do_start ;;
        2) do_stop ;;
        3) do_restart ;;
        4) do_status ;;
        5) do_logs ;;
        6) exit 0 ;;
        *) echo -e "${RED}[ERROR] Invalid selection.${NC}" ;;
    esac
}

# ============================================================
#  Main Router
# ============================================================

case "${1:-}" in
    start)   do_start ;;
    stop)    do_stop ;;
    restart) do_restart ;;
    status)  do_status ;;
    logs)    shift; do_logs "$@" ;;
    help|-h|--help) do_help ;;
    "")      show_menu ;;
    *)
        echo -e "${RED}[ERROR] Unknown command: $1${NC}"
        do_help
        ;;
esac
