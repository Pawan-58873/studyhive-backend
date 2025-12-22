@echo off
echo ========================================
echo   STUDYHIVE BACKEND SERVER
echo ========================================
echo.
echo Starting backend server on port 8000...
echo.
echo IMPORTANT: Keep this window open!
echo The server must stay running for the app to work.
echo.
echo ========================================
echo.

cd /d "%~dp0"

REM Check if node_modules exists
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    echo.
)

REM Check if .env exists
if not exist ".env" (
    echo WARNING: .env file not found!
    echo.
    echo Please create a .env file with:
    echo   PORT=8000
    echo   CLIENT_ORIGIN=http://localhost:5173
    echo   HUGGINGFACE_API_KEY=hf_your_token_here
    echo.
    echo Press any key to continue anyway...
    pause >nul
)

echo Starting server...
echo.

npm start

pause
