@echo off
REM Удаляет ярлык автозапуска B21 Scanner Agent из папки "Автозагрузка".
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = [Environment]::GetFolderPath('Startup') + '\B21 Scanner Agent.lnk';" ^
  "if (Test-Path $p) { Remove-Item $p -Force; Write-Host '[OK] Автозапуск отключён.' } else { Write-Host 'Ярлык автозапуска не найден.' }"
pause
