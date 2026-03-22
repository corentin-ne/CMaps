@echo off
echo ==============================================
echo CMaps Reset Script
echo ==============================================
echo WARNING: This will delete your current database!
echo Please ensure your server (run.bat) is STOPPED before continuing.
echo Press Ctrl+C to abort, or any key to continue.
pause >nul

echo.
echo [1/3] Deleting database...
if exist "data\cmaps.db" (
    del "data\cmaps.db"
    
    REM Check if the file still exists to confirm deletion success
    if exist "data\cmaps.db" (
        echo.
        echo [ERROR] Could not delete data\cmaps.db.
        echo The file is locked and being used by another process.
        echo Please close the running server console window and try again.
        echo.
        pause
        exit /b 1
    ) else (
        echo Database deleted successfully.
    )
) else (
    echo Database not found. Skipping deletion.
)

echo.
echo [2/3] Verifying environment and dependencies...

if not exist ".venv\Scripts\python.exe" (
    echo.
    echo [ERROR] Virtual environment not found in .venv\
    echo Please run setup.bat first to initialize the environment.
    echo.
    pause
    exit /b 1
)

echo Activating virtual environment...
call .venv\Scripts\activate.bat

echo Installing/Upgrading missing dependencies...
REM We install dependencies to ensure everything in requirements.txt is present
"%~dp0.venv\Scripts\python.exe" -m pip install -r requirements.txt -q

if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] Quiet install failed, attempting verbose install...
    "%~dp0.venv\Scripts\python.exe" -m pip install -r requirements.txt
)

echo.
echo [3/3] Running database setup...
"%~dp0.venv\Scripts\python.exe" setup_data.py

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] setup_data.py encountered an issue. Please review the trace above.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo Reset complete! You can now start the server with run.bat.
pause