@echo off
REM ===========================================================================
REM  LendersHub - CREATE / RESET A FIELD-AGENT LOGIN (for the mobile app)
REM
REM  Inserts a COLLECTOR user into a tenant schema with a bcrypt password.
REM  Requires the database to be reachable (docker compose up db -d).
REM
REM  Usage:  create-agent [subdomain] [phone] [password] [role] [first] [last]
REM    (no args)                      list available tenants
REM    create-agent acme 9000000001   create COLLECTOR with default password
REM    create-agent acme 9000000001 Agent@123 LOAN_OFFICER Ravi Kumar
REM ===========================================================================
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "node_modules\pg" (
  echo [setup] Installing backend dependencies ^(first run^)...
  call npm install || goto :error
)

node scripts\create-agent.js %*
if errorlevel 1 goto :error
exit /b 0

:error
echo.
echo ERROR: could not create the agent login.
echo   - Is the database up?   docker compose up db -d
echo   - Does a tenant exist?  run with no args to list tenants
exit /b 1
