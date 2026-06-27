@echo off
REM ===========================================================================
REM  LendersHub Agent - BUILD ANDROID APK (size-optimized, for direct sideload)
REM
REM  Builds a sideloadable APK via EAS. ABIs are limited to arm64-v8a +
REM  armeabi-v7a (set in eas.json / gradle.properties) so the emulator-only
REM  x86/x86_64 native libs are dropped -> much smaller download.
REM
REM  Usage:  build-apk [profile] [action]
REM    profile : preview (default) | development | production | arm64
REM    action  : build (default) | verify <path-to.apk> | list
REM
REM  Examples:
REM    build-apk                       build the preview APK (recommended)
REM    build-apk arm64                 build arm64-only APK (smallest; no 32-bit)
REM    build-apk production            build the AAB for Play Store (later)
REM    build-apk verify app.apk        list the ABIs packed inside an APK
REM    build-apk list                  list recent EAS builds + download links
REM ===========================================================================
setlocal EnableExtensions
cd /d "%~dp0"

set "PROFILE=%~1"
set "ACTION=%~2"
if "%PROFILE%"=="" set "PROFILE=preview"

REM --- verify ABIs of an existing APK -----------------------------------------
if /i "%PROFILE%"=="verify" (
  set "APKPATH=%~2"
  if "%APKPATH%"=="" ( echo Usage: build-apk verify ^<path-to.apk^> & exit /b 1 )
  echo Inspecting native libs inside "%APKPATH%" ...
  REM tar is built into Windows 10+ and can list entries in the apk (a zip)
  tar -tf "%APKPATH%" | findstr /R "lib/.*\.so"
  echo.
  echo Expect only  lib/arm64-v8a/  and  lib/armeabi-v7a/  ^(no x86^).
  exit /b 0
)

REM --- list recent EAS builds -------------------------------------------------
if /i "%PROFILE%"=="list" (
  echo Recent Android builds:
  call npx eas-cli build:list --platform android --limit 5
  exit /b %errorlevel%
)

echo ============================================================
echo  Building Android APK  (profile: %PROFILE%)
echo ============================================================
echo.

REM --- sanity: dependencies installed? ---------------------------------------
if not exist "node_modules" (
  echo [setup] Installing npm dependencies ^(first run^)...
  call npm install || goto :error
)

REM --- pick the build command -------------------------------------------------
if /i "%PROFILE%"=="arm64" (
  echo [build] arm64-v8a only - smallest APK, will NOT install on 32-bit phones.
  set "PROFILE=preview-arm64"
)

echo [build] Starting EAS build for profile "%PROFILE%"...
echo         ^(EAS runs in the cloud; a download link is printed when done.^)
call npx eas-cli build --platform android --profile %PROFILE%
if errorlevel 1 goto :error

:postbuild
echo.
echo ============================================================
echo  DONE.
echo   - Download the .apk from the EAS link above, or run:
echo       build-apk list
echo   - Verify the ABIs after download:
echo       build-apk verify path\to\app.apk
echo   - Send the .apk to agents to sideload (enable "Install
echo     unknown apps" on their device).
echo ============================================================
exit /b 0

:error
echo.
echo ERROR: build failed. Check the output above.
echo   - Logged in to EAS?   npx eas-cli login
echo   - Project linked?     npx eas-cli init
exit /b 1
