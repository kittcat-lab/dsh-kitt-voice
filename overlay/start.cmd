@echo off
REM Start the companion window.
REM
REM Electron is not bundled with this plugin: the harness is a web application
REM and most people will never want a desktop window at all. So this looks for
REM an Electron you already have, and says what to do when there is none,
REM rather than downloading two hundred megabytes on your behalf.

setlocal
cd /d "%~dp0"

if defined DSH_KITT_ELECTRON (
  "%DSH_KITT_ELECTRON%" . && goto :eof
)

if exist "node_modules\electron\dist\electron.exe" (
  "node_modules\electron\dist\electron.exe" . && goto :eof
)

where npx >nul 2>&1 && (
  npx --no-install electron . && goto :eof
)

echo.
echo   The companion window needs Electron, and none was found.
echo.
echo   Either install it here:      npm install
echo   or point at one you have:    set DSH_KITT_ELECTRON=C:\path\to\electron.exe
echo.
exit /b 1
