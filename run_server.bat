@echo off
chcp 65001 > nul
cd /d "%~dp0"
title ArtBridge Server

if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" backend\server.py --open
) else (
  py -3 --version >nul 2>nul
  if not errorlevel 1 (
    py -3 backend\server.py --open
  ) else (
    python backend\server.py --open
  )
)

echo.
pause
