@echo off
title StudyHive Backend Server
color 0A
echo.
echo ========================================
echo   STUDYHIVE BACKEND SERVER
echo   Starting on port 8000...
echo ========================================
echo.
echo IMPORTANT: Keep this window open!
echo The server must stay running.
echo.
echo After you see "Server is now listening"
echo Test it at: http://localhost:8000/api/health
echo.
echo ========================================
echo.

cd /d "%~dp0"

REM Install dependencies if needed
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    echo.
)

echo Starting server...
echo.

npm start

echo.
echo Server stopped. Press any key to exit...
pause >nul
