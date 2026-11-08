@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================================
echo   Запуск симулятора энергоблока ВВЭР-1000
echo   Интерфейс откроется в браузере: http://localhost:8000
echo ========================================================
timeout /t 1 >nul
start "" http://localhost:8000
python run.py
pause
