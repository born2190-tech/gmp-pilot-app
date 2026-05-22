@echo off
REM B21 Scanner Agent — запуск на рабочей станции (АРМ).
REM Требуется Python 3.10+ и установленные зависимости (см. README.md).
cd /d "%~dp0"
python agent.py
pause
