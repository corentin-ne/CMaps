@echo off
echo ==============================================
echo CMaps Run Script
echo ==============================================

echo Activating virtual environment...
call .venv\Scripts\activate.bat

echo Starting server...
echo The app will be available at:
echo - Localhost: http://localhost:8000
echo - Network IP: http://(your-local-ip):8000
echo.
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
