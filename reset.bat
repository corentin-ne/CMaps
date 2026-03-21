@echo off
echo ==============================================
echo CMaps Reset Script
echo ==============================================
echo WARNING: This will delete your current database!
echo Press Ctrl+C to abort, or any key to continue.
pause

echo.
echo Deleting database...
if exist "data\cmaps.db" (
    del "data\cmaps.db"
    echo Database deleted.
) else (
    echo Database not found.
)

echo.
echo Re-running setup...
call .venv\Scripts\activate.bat
python setup_data.py

echo.
echo Reset complete!
pause
