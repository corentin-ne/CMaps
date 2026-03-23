@echo off
echo ==============================================
echo CMaps Run Script
echo ==============================================

echo Activating virtual environment...
call .venv\Scripts\activate.bat

REM Detect local IP address
set LOCAL_IP=
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4 Address"') do (
    if not defined LOCAL_IP (
        for /f "tokens=*" %%b in ("%%a") do set LOCAL_IP=%%b
    )
)
if not defined LOCAL_IP set LOCAL_IP=127.0.0.1

echo.
echo Starting server...
echo The app will be available at:
echo   - Local:   http://localhost:8000
echo   - Network: http://%LOCAL_IP%:8000
echo.
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
