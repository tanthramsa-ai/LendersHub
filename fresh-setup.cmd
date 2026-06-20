@echo off
REM ===========================================================================
REM  LendersHub - FRESH SETUP
REM  Wipes ALL data (Postgres + Redis volumes), rebuilds every image from
REM  scratch with no cache, starts the stack, and seeds the super-admin user.
REM
REM  Use this for a clean slate. ALL EXISTING DATA IS DELETED.
REM ===========================================================================
setlocal EnableExtensions
cd /d "%~dp0"

echo ===========================================================================
echo  LendersHub - FRESH SETUP  (this DELETES all database data)
echo ===========================================================================
echo.
set /p CONFIRM=Type Y and press Enter to wipe data and rebuild:
if /i not "%CONFIRM%"=="Y" (
  echo Aborted. Nothing changed.
  exit /b 1
)

echo.
echo [1/5] Stopping stack and removing volumes (Postgres + Redis)...
docker compose down -v
if errorlevel 1 goto :error

echo.
echo [2/5] Removing local build artifacts...
if exist "backend\dist"    rmdir /s /q "backend\dist"
if exist "frontend\.next"  rmdir /s /q "frontend\.next"
del /q "backend\*.tsbuildinfo"  2>nul
del /q "frontend\*.tsbuildinfo" 2>nul

echo.
echo [3/5] Building images from scratch (no cache - this takes a few minutes)...
docker compose build --no-cache
if errorlevel 1 goto :error

echo.
echo [4/5] Starting stack (backend auto-applies Prisma migrations on boot)...
docker compose up -d
if errorlevel 1 goto :error

echo.
echo [5/5] Waiting for backend, then seeding the super-admin user...
call :wait_backend
docker compose exec -T backend node dist/seed.js
if errorlevel 1 goto :error

echo.
echo ===========================================================================
echo  DONE. Open http://localhost:3000/super-admin/login
echo    Email:    admin@lendershub.com
echo    Password: Admin@LH2024!
echo ===========================================================================
exit /b 0

:wait_backend
echo     Waiting for backend on http://localhost:4001 ...
for /l %%i in (1,1,45) do (
  curl -s -o nul http://localhost:4001 && goto :eof
  timeout /t 2 >nul
)
echo     WARNING: backend not responding yet; attempting seed anyway.
goto :eof

:error
echo.
echo ERROR: a step failed. Check the output above (try: docker compose logs).
exit /b 1
