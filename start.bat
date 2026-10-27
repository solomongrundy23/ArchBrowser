@echo off
setlocal
cd /d "%~dp0"

set "ELECTRON=node_modules\electron\dist\electron.exe"
if exist "%ELECTRON%" (
  start "" "%ELECTRON%" "%CD%"
  exit /b 0
)

rem Если исходники без node_modules — сначала запускаем распакованную сборку
rem (не требует места в %TEMP%), затем portable.
if exist "dist\win-unpacked\ArchBrowser.exe" (
  start "" "dist\win-unpacked\ArchBrowser.exe"
  exit /b 0
)
for %%F in ("dist\ArchBrowser-*-portable.exe") do (
  if exist "%%~fF" (
    start "" "%%~fF"
    exit /b 0
  )
)

echo Electron не найден, и portable-сборка отсутствует.
echo.
echo Установите зависимости:  npm install
echo Либо скачайте готовый ArchBrowser-*-portable.exe в папку dist.
echo.
echo Если браузер не запускается, причина записывается в:
echo   %%APPDATA%%\ArchBrowser\startup.log
pause
exit /b 1
