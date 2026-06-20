@echo off
REM ===========================================================================
REM  LendersHub - run each service SEPARATELY
REM
REM  Usage:  svc <service> [action]
REM    service : db | redis | backend | frontend
REM    action  : up (default) | down | build | restart | logs | ps
REM
REM  Examples:
REM    svc db                 start Postgres
REM    svc redis              start Redis
REM    svc backend            build + start the API
REM    svc frontend           build + start the web UI
REM    svc backend logs       follow backend logs
REM    svc frontend down      stop only the frontend
REM
REM  Start order for a full bring-up:  db  ->  redis  ->  backend  ->  frontend
REM ===========================================================================
setlocal EnableExtensions
cd /d "%~dp0"

set "SVC=%~1"
set "ACT=%~2"
if "%SVC%"=="" goto :usage
if "%ACT%"=="" set "ACT=up"

set "FILE=docker-compose.%SVC%.yml"
if not exist "%FILE%" (
  echo Unknown service "%SVC%".  Use: db ^| redis ^| backend ^| frontend
  exit /b 1
)

REM --- ensure the shared network exists (idempotent) ---
docker network inspect lendershub-net >nul 2>&1
if errorlevel 1 (
  echo Creating shared network "lendershub-net"...
  docker network create lendershub-net >nul || goto :error
)

if /i "%ACT%"=="up"      ( docker compose -f "%FILE%" up -d --build & goto :done )
if /i "%ACT%"=="down"    ( docker compose -f "%FILE%" down & goto :done )
if /i "%ACT%"=="build"   ( docker compose -f "%FILE%" build & goto :done )
if /i "%ACT%"=="restart" ( docker compose -f "%FILE%" up -d --build --force-recreate & goto :done )
if /i "%ACT%"=="logs"    ( docker compose -f "%FILE%" logs -f & goto :done )
if /i "%ACT%"=="ps"      ( docker compose -f "%FILE%" ps & goto :done )

echo Unknown action "%ACT%".  Use: up ^| down ^| build ^| restart ^| logs ^| ps
exit /b 1

:done
if errorlevel 1 goto :error
exit /b 0

:usage
echo Usage: svc ^<db^|redis^|backend^|frontend^> [up^|down^|build^|restart^|logs^|ps]
exit /b 1

:error
echo.
echo ERROR: command failed. See output above.
exit /b 1
