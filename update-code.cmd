@echo off
REM ===========================================================================
REM  LendersHub - UPDATE CODE (keeps existing data)
REM  Rebuilds the images with your current code and restarts the stack WITHOUT
REM  touching the Postgres / Redis volumes. New Prisma migrations are applied
REM  automatically when the backend boots (npx prisma migrate deploy).
REM
REM  Use this after changing code. YOUR DATABASE DATA IS PRESERVED.
REM ===========================================================================
setlocal EnableExtensions
cd /d "%~dp0"

echo ===========================================================================
echo  LendersHub - UPDATE CODE  (data is preserved)
echo ===========================================================================
echo.

echo [1/2] Rebuilding images with current code...
docker compose build
if errorlevel 1 goto :error

echo.
echo [2/2] Recreating containers (volumes kept; migrations auto-apply)...
docker compose up -d --build
if errorlevel 1 goto :error

echo.
echo ===========================================================================
echo  DONE. Existing data preserved.
echo    Frontend: http://localhost:3000
echo    Backend:  http://localhost:4001
echo ===========================================================================
exit /b 0

:error
echo.
echo ERROR: a step failed. Check the output above (try: docker compose logs).
exit /b 1
