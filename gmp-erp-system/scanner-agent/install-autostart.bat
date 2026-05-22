@echo off
REM ---------------------------------------------------------------------------
REM B21 Scanner Agent - настройка автозапуска при входе в Windows.
REM Создаёт ярлык в папке "Автозагрузка" текущего пользователя, который
REM запускает агент БЕЗ окна консоли (pythonw / pyw) при каждом логине.
REM Запускать один раз. Для отключения - uninstall-autostart.bat.
REM ---------------------------------------------------------------------------
setlocal
set "AGENT_DIR=%~dp0"

REM Ищем оконно-безголовый запускатель Python (pyw), иначе pythonw из установки.
set "PYW="
for /f "delims=" %%i in ('where pyw 2^>nul') do set "PYW=%%i"
if "%PYW%"=="" if exist "%LOCALAPPDATA%\Programs\Python\Python314\pythonw.exe" set "PYW=%LOCALAPPDATA%\Programs\Python\Python314\pythonw.exe"
if "%PYW%"=="" if exist "%LOCALAPPDATA%\Programs\Python\Python312\pythonw.exe" set "PYW=%LOCALAPPDATA%\Programs\Python\Python312\pythonw.exe"

if "%PYW%"=="" (
  echo [!] Не найден pythonw/pyw. Установите Python 3.10+ и повторите.
  pause
  exit /b 1
)

echo Запускатель: %PYW%
echo Папка агента: %AGENT_DIR%

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$lnk = $ws.CreateShortcut([Environment]::GetFolderPath('Startup') + '\B21 Scanner Agent.lnk');" ^
  "$lnk.TargetPath = '%PYW%';" ^
  "$lnk.Arguments = '\"%AGENT_DIR%agent.py\"';" ^
  "$lnk.WorkingDirectory = '%AGENT_DIR%';" ^
  "$lnk.WindowStyle = 7;" ^
  "$lnk.Description = 'B21 Scanner Agent';" ^
  "$lnk.Save()"

echo.
echo [OK] Автозапуск настроен. Агент стартует при следующем входе в Windows.
echo      Чтобы запустить прямо сейчас без перезагрузки - выполните:
echo          start "" "%PYW%" "%AGENT_DIR%agent.py"
echo.
pause
