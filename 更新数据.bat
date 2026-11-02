@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
python "tools\update.py" %*
if errorlevel 1 goto fail
echo.
echo [OK] data\cards.js rebuilt. Refresh index.html.
echo.
pause
exit /b 0
:fail
echo.
echo [FAIL] see the message above.
echo   1) make sure lark-cli is installed and logged in
echo   2) or export the two tables to NDJSON, then run:
echo      python tools\update.py --songs songs.ndjson --parses parses.ndjson
echo.
pause
exit /b 1
