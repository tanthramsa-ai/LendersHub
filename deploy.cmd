@echo off
REM ===========================================================================
REM  LendersHub - DEPLOY
REM  1) pull latest code from git
REM  2) validate every compose file
REM  3) build all images
REM  4) run each service separately, in order, waiting for health
REM  5) validate the running stack
REM
REM  Run from the repo root:   deploy.cmd
REM ===========================================================================
REM NOTE: delayed expansion is intentionally OFF so "!" in secrets/passwords
REM (e.g. the seed password) is treated literally.
setlocal EnableExtensions
cd /d "%~dp0"

echo ============================================================
echo  LendersHub DEPLOY  (pull -^> validate -^> build -^> run)
echo ============================================================

echo.
echo [1/6] Pulling latest code from git...
git pull --ff-only
if errorlevel 1 (
  echo ERROR: git pull failed ^(uncommitted changes or non-fast-forward^).
  echo        Commit/stash local changes or resolve the branch, then retry.
  goto :error
)

echo.
echo [2/6] Ensuring shared network "lendershub-net"...
docker network inspect lendershub-net >nul 2>&1
if errorlevel 1 docker network create lendershub-net >nul || goto :error

echo.
echo [3/6] Validating compose files...
for %%S in (db redis backend frontend) do (
  docker compose -f docker-compose.%%S.yml config -q || (echo   INVALID: docker-compose.%%S.yml & goto :error)
  echo   docker-compose.%%S.yml  OK
)

echo.
echo [4/6] Building images...
for %%S in (db redis backend frontend) do (
  echo   building %%S ...
  docker compose -f docker-compose.%%S.yml build || goto :error
)

echo.
echo [5/6] Starting services in order ^(db -^> redis -^> backend -^> frontend^)...
docker compose -f docker-compose.db.yml    up -d || goto :error
docker compose -f docker-compose.redis.yml up -d || goto :error
call :wait_health lendershub-postgres
call :wait_health lendershub-redis
docker compose -f docker-compose.backend.yml up -d || goto :error
call :wait_http http://localhost:4001 backend
echo   seeding super-admin ^(idempotent^)...
docker compose -f docker-compose.backend.yml exec -T backend node dist/seed.js
docker compose -f docker-compose.frontend.yml up -d || goto :error
call :wait_http http://localhost:3000/super-admin/login frontend

echo.
echo [6/6] Validating running stack...
docker compose ls
echo.
curl -s -o nul -w "   backend  super-admin login -> HTTP %%{http_code}\n" -X POST http://localhost:4001/api/v1/super-admin/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@lendershub.com\",\"password\":\"Admin@LH2024!\"}"
curl -s -o nul -w "   frontend /super-admin/login    -> HTTP %%{http_code}\n" http://localhost:3000/super-admin/login

echo.
echo ============================================================
echo  DONE.  Frontend http://localhost:3000   Backend http://localhost:4001
echo ============================================================
exit /b 0

REM --- wait until a container reports healthy ----------------------------------
:wait_health
echo   waiting for %1 to become healthy...
for /l %%i in (1,1,30) do (
  for /f "delims=" %%H in ('docker inspect --format "{{.State.Health.Status}}" %1 2^>nul') do if "%%H"=="healthy" goto :eof
  %SystemRoot%\System32\ping.exe -n 3 127.0.0.1 >nul
)
echo   WARNING: %1 not healthy yet; continuing.
goto :eof

REM --- wait until an HTTP endpoint responds ------------------------------------
:wait_http
echo   waiting for %2 at %1 ...
for /l %%i in (1,1,45) do (
  curl -s -o nul %1 && goto :eof
  %SystemRoot%\System32\ping.exe -n 3 127.0.0.1 >nul
)
echo   WARNING: %2 not responding yet; continuing.
goto :eof

:error
echo.
echo ERROR: deploy failed. See the output above.
exit /b 1
