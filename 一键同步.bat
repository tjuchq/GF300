@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 同步到 GitHub · GF300
cd /d "%~dp0"

set API_PUSH=D:/workbuddyspace/qita/工具/01-三百首游戏/push_api.py

echo ==========================================
echo    同步到 GitHub · tjuchq/GF300
echo ==========================================
echo.

:: ---------- 0. 找 git（双击时的 PATH 可能没有它） ----------
git --version >nul 2>&1
if errorlevel 1 (
  set GITDIR=
  if exist "C:/Program Files/Git/cmd/git.exe" set "GITDIR=C:/Program Files\Git\cmd"
  if not defined GITDIR if exist "C:/Program Files (x86)/Git/cmd/git.exe" set "GITDIR=C:/Program Files (x86)\Git\cmd"
  if not defined GITDIR if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" set "GITDIR=%LOCALAPPDATA%\Programs\Git\cmd"
  if not defined GITDIR if exist "D:/workbuddy/resources/vendor/PortableGit/cmd/git.exe" set "GITDIR=D:/workbuddy/resources/vendor/PortableGit/cmd"
  if not defined GITDIR if exist "D:/workbuddy/resources/vendor/PortableGit/mingw64/bin/git.exe" set "GITDIR=D:/workbuddy/resources/vendor/PortableGit/mingw64/bin"
  if not defined GITDIR (
    echo [FAIL] 系统里找不到 git.exe
    echo        请安装 Git for Windows，或把 git 加入 PATH
    goto fail
  )
  set "PATH=!GITDIR!;!PATH!"
  if exist "!GITDIR!\..\mingw64\bin\git.exe" set "PATH=!GITDIR!\..\mingw64\bin;!PATH!"
  echo 使用 git：!GITDIR!
)
git --version

:: ---------- 1. 确认是仓库 ----------
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo.
  echo [FAIL] 当前目录不是 git 仓库：
  echo        %CD%
  goto fail
)
for /f %%i in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%i
for /f %%i in ('git config --get remote.origin.url') do set REMOTE_URL=%%i

:: ---------- 2. 看有没有要同步的 ----------
set CHANGES=0
for /f "delims=" %%i in ('git status --porcelain') do set /a CHANGES+=1
set AHEAD=0
for /f %%i in ('git rev-list --count origin/%BRANCH%..HEAD 2^>nul') do set AHEAD=%%i
git rev-parse --verify origin/%BRANCH% >nul 2>&1
if errorlevel 1 set AHEAD=999

echo.
echo 仓库：!REMOTE_URL!
echo 分支：%BRANCH%   待提交：%CHANGES% 个   未推送提交：%AHEAD% 个
echo.

if "%CHANGES%"=="0" if "%AHEAD%"=="0" (
  echo [OK] 没有要同步的内容，本地与线上一致。
  goto done
)

if not "%CHANGES%"=="0" (
  echo 待提交的文件：
  git status --short
  echo.
)
if not "%AHEAD%"=="0" (
  echo 尚未推送的提交：
  git log --oneline -5 origin/%BRANCH%..HEAD
  echo.
)

if "%1"=="--check" (
  echo [CHECK] 只检查不推送。去掉 --check 再运行即可同步。
  exit /b 0
)

:: ---------- 3. 提交 ----------
if not "%CHANGES%"=="0" (
  set MSG=%*
  if "!MSG!"=="" (
    set D=
    set T=
    for /f "tokens=1-3 delims=/. " %%a in ("%DATE:/=.%") do set D=%%a%%b%%c
    for /f "tokens=1-3 delims=:. " %%a in ("%TIME%") do set T=%%a%%b%%c
    set T=!T: =!
    set MSG=同步 !D!_!T!
  )
  echo 即将把以上改动提交并同步到线上。
  echo 按任意键继续，要取消请按 Ctrl+C ...
  pause >nul
  git add -A
  git commit -q -m "!MSG!"
  if errorlevel 1 (
    echo [FAIL] 提交失败，请查看上面的 git 输出。
    goto fail
  )
  echo [OK] 已提交：!MSG!
  echo.
)

:: ---------- 4. 推送（先直连，失败走 API） ----------
echo 推送到 GitHub ...
git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 push origin %BRANCH%
if errorlevel 1 (
  echo.
  echo 直连推送失败（代理 502 很常见），改用 GitHub API 推送 ...
  if not exist "%API_PUSH%" (
    echo [FAIL] 找不到推送脚本：
    echo        %API_PUSH%
    goto fail
  )
  python "%API_PUSH%" "%CD%"
  if errorlevel 1 (
    echo [FAIL] API 推送也失败了，检查网络与 GitHub 登录状态。
    goto fail
  )
)

:: ---------- 5. 核对 ----------
git fetch origin %BRANCH% >nul 2>&1
set L=
set R=
for /f %%i in ('git rev-parse HEAD') do set L=%%i
for /f %%i in ('git rev-parse origin/%BRANCH% 2^>nul') do set R=%%i

echo.
if /i "!L!"=="!R!" (
  echo [OK] 同步完成。本地 = 线上 = !L:~0,8!
  echo.
  echo GitHub Pages 约 60-90 秒后生效，浏览器请按 Ctrl+Shift+R 强刷。
) else (
  echo [WARN] 线上 !R:~0,8!  与本地 !L:~0,8! 不一致，请重新运行一次。
)
goto done

:fail
echo.
pause
exit /b 1

:done
echo.
pause
exit /b 0
