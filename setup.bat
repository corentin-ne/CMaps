@echo off
echo ==============================================
echo CMaps Setup Script
echo ==============================================

if not exist ".venv" (
    echo [1/3] Creating virtual environment...
    python -m venv .venv
) else (
    echo [1/3] Virtual environment already exists.
)

echo [2/3] Installing/Upgrading requirements...
call .venv\Scripts\activate.bat
pip install -r requirements.txt

echo [3/3] Setting up database...
python setup_data.py

echo.
echo Setup complete! You can now run the app with run.bat.
pause
