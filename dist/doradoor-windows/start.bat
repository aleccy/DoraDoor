@echo off
chcp 65001 >nul 2>&1
title DoraDoor

echo ======================================
echo   DoraDoor - AI Gateway
echo ======================================
echo.

if not exist config.yaml (
    echo ERROR: config.yaml not found
    echo Please copy config.yaml to this directory and configure it
    pause
    exit /b 1
)

echo Starting DoraDoor on port 3001...
echo.
echo Admin: http://localhost:3001/admin
echo Health: http://localhost:3001/health
echo.
echo Press Ctrl+C to stop
echo.

doradoor.exe -config config.yaml
pause
