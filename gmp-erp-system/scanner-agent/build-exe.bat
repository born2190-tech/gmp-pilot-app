@echo off
REM ===========================================================================
REM Сборка автономного b21-scanner-agent.exe (без окна консоли).
REM После сборки на рабочих станциях Python НЕ нужен: копируете папку
REM scanner-agent (с dist\b21-scanner-agent.exe) и запускаете setup-agent.bat.
REM Делается ОДИН раз на машине разработчика/сборки.
REM ===========================================================================
setlocal
cd /d "%~dp0"

where py >nul 2>nul && (set "PY=py") || (set "PY=python")

echo [1/3] Виртуальное окружение и зависимости...
%PY% -m venv .venv || (echo [!] Нет Python 3.10+ & pause & exit /b 1)
call .venv\Scripts\activate
python -m pip install --upgrade pip >nul
pip install -r requirements.txt pyinstaller || (echo [!] Ошибка установки зависимостей & pause & exit /b 1)

echo [2/3] Сборка .exe (windowed, onefile)...
pyinstaller --onefile --noconsole --name b21-scanner-agent ^
  --hidden-import win32com --hidden-import win32com.client ^
  agent.py || (echo [!] Ошибка сборки & pause & exit /b 1)

echo [3/3] Готово: %~dp0dist\b21-scanner-agent.exe
echo Теперь запустите setup-agent.bat (он подхватит .exe автоматически).
echo.
pause
