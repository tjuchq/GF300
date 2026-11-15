@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
set "GIT_PAGER=cat"
set "PAGER=cat"
title 同步到 GitHub - GF300
cd /d "%~dp0"

set "API_PUSH=D:/workbuddyspace/qita/工具/01-三百首游戏/push_api.py"

echo ==========================================
echo    同步到 GitHub   tjuchq/GF300
echo ==========================================
echo.

rem ---------- 0. 找 git ----------
git --version >nul 2>&1
if errorlevel 1 (
  set "GITDIR="
  if exist "C:/Program Files/Git/cmd/git.exe" set "GITDIR=C:/Program Files\Git\cmd"
  if not defined GITDIR if exist "C:/Program Files (x86)/Git/cmd/git.exe" set "GITDIR=C:/Program Files (x86)\Git\cmd"
  if not defined GITDIR if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" set "GITDIR=%LOCALAPPDATA%\Programs\Git\cmd"
  if not defined GITDIR if exist "D:/workbuddy/resources/vendor/PortableGit/cmd/git.exe" set "GITDIR=D:/workbuddy/resources/vendor/PortableGit/cmd"
  if not defined GITDIR if exist "D:/workbuddy/resources/vendor/PortableGit/mingw64/bin/git.exe" set "GITDIR=D:/workbuddy/resources/vendor/PortableGit/mingw64/bin"
  if not defined GITDIR (
    echo [FAIL] 找不到 git.exe
    echo        请安装 Git for Windows，或把 git 加进 PATH
    goto fail
  )
  set "PATH=!GITDIR!;!PATH!"
  echo 使用 git：!GITDIR!
)

rem ---------- 0b. 找 python ----------
set "PY="
python -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY=python"
if not defined PY if exist "D:/python38/python/python.exe" set "PY=D:/python38/python/python.exe"

rem ---------- 1. 确认是仓库 ----------
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo.
  echo [FAIL] 当前目录不是 git 仓库：
  echo        %CD%
  goto fail
)
for /f %%i in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%i"
for /f %%i in ('git config --get remote.origin.url') do set "REMOTE_URL=%%i"

rem ---------- 2. 拉线上引用，失败不致命 ----------
echo 检查线上状态 ...
git fetch origin %BRANCH% >nul 2>&1
if errorlevel 1 echo   fetch 失败，按本地记录的线上状态判断

set "CHANGES=0"
for /f "delims=" %%i in ('git status --porcelain') do set /a CHANGES+=1

set "CONTENT_DIFF=0"
git diff --quiet origin/%BRANCH% HEAD >nul 2>&1
if errorlevel 1 set "CONTENT_DIFF=1"

echo.
echo 仓库：!REMOTE_URL!
echo 分支：%BRANCH%
if "%CHANGES%"=="0" (echo 未提交改动：无) else (echo 未提交改动：%CHANGES% 个)
if "%CONTENT_DIFF%"=="0" (echo 与线上内容：一致) else (echo 与线上内容：有差异)
echo.

if "%CHANGES%"=="0" if "%CONTENT_DIFF%"=="0" (
  echo [OK] 线上已是最新，无需同步。
  goto done
)

if not "%CONTENT_DIFF%"=="0" (
  echo 与线上不同的文件：
  if defined PY (
    "%PY%" "%API_PUSH%" "%CD%" --list diff
  ) else (
    git --no-pager diff --name-status origin/%BRANCH% HEAD
  )
  echo.
)
if not "%CHANGES%"=="0" (
  echo 待提交的文件：
  if defined PY (
    "%PY%" "%API_PUSH%" "%CD%" --list status
  ) else (
    git status --short
  )
  echo.
)

if "%~1"=="--check" (
  echo [CHECK] 只检查不推送。去掉 --check 再运行即可同步。
  goto done
)

rem ---------- 3. 提交 ----------
if not "%CHANGES%"=="0" (
  set "MSG=%~1"
  if "!MSG!"=="" set "MSG=一键同步"
  echo 按任意键提交并同步到线上，要取消请直接关窗口 ...
  pause >nul
  git add -A
  git commit -q -m "!MSG!"
  if errorlevel 1 (
    echo [FAIL] 提交失败，请看上面的 git 输出。
    goto fail
  )
  echo [OK] 已提交：!MSG!
  echo.
)

rem ---------- 4. 推送 ----------
set "FF=0"
git merge-base --is-ancestor origin/%BRANCH% HEAD >nul 2>&1
if not errorlevel 1 set "FF=1"

set "PUSHED=0"
if "%FF%"=="1" (
  echo 推送到 GitHub ...
  git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 push origin %BRANCH%
  if not errorlevel 1 set "PUSHED=1"
) else (
  echo 本地与线上历史已分叉，跳过 git push。
)

if "%PUSHED%"=="0" (
  echo.
  echo 改用 GitHub API 推送 ...
  if not defined PY (
    echo [FAIL] 找不到 python，无法走 API 推送。
    goto fail
  )
  if not exist "%API_PUSH%" (
    echo [FAIL] 找不到推送脚本：
    echo        %API_PUSH%
    goto fail
  )
  "%PY%" "%API_PUSH%" "%CD%" --align
  if errorlevel 1 (
    echo [FAIL] API 推送失败，检查网络与 GitHub 登录状态。
    goto fail
  )
)

rem ---------- 5. 核对内容 ----------
echo.
echo 核对线上内容 ...
git fetch origin %BRANCH% >nul 2>&1
git diff --quiet origin/%BRANCH% HEAD >nul 2>&1
if errorlevel 1 (
  echo [WARN] 线上内容与本地仍有差异，请再运行一次。
  goto fail
)

echo [OK] 同步完成，线上内容与本地一致。
echo.
echo GitHub Pages 约 60-90 秒后生效，浏览器请按 Ctrl+Shift+R 强刷。
goto done

:fail
echo.
pause
exit /b 1

:done
echo.
pause
exit /b 0
