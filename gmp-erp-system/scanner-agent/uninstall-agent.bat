@echo off
REM Снятие автозапуска B21 Scanner Agent: удаляет задачу планировщика и
REM (на всякий случай) старый ярлык автозагрузки. Останавливает агент.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Stop-ScheduledTask -TaskName 'B21 Scanner Agent' -ErrorAction SilentlyContinue;" ^
  "Unregister-ScheduledTask -TaskName 'B21 Scanner Agent' -Confirm:$false -ErrorAction SilentlyContinue;" ^
  "$lnk=[Environment]::GetFolderPath('Startup')+'\B21 Scanner Agent.lnk'; if(Test-Path $lnk){Remove-Item $lnk -Force};" ^
  "Write-Host '[OK] Автозапуск агента снят.'"
echo.
pause
