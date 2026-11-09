@echo off
rem SPDX-License-Identifier: AGPL-3.0-or-later
setlocal
if not exist "%~dp0dist\index.html" goto missing
if not exist "%~dp0node_modules\electron\dist\electron.exe" goto missing
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0." %*
exit /b
:missing
echo The desktop preview needs its local build and Electron.
echo Open CONTRIBUTING.md in this folder for setup steps.
pause
