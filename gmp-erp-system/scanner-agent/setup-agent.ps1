# B21 Scanner Agent — максимально автоматизированная установка автозапуска.
# Регистрирует задачу планировщика Windows: старт при входе пользователя,
# скрыто, без ограничения времени, с авто-перезапуском при сбое; затем сразу
# запускает агент. Идемпотентно (повторный запуск просто обновляет задачу).
#
# Цель запуска выбирается автоматически:
#   1) dist\b21-scanner-agent.exe  (если собран — Python на станции НЕ нужен)
#   2) pythonw.exe + agent.py      (запуск из исходника, без окна консоли)

$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$taskName = 'B21 Scanner Agent'

# --- 1. Определяем, чем запускать ------------------------------------------
$exe = Join-Path $dir 'dist\b21-scanner-agent.exe'
if (Test-Path $exe) {
    $cmd = $exe
    $args = ''
    Write-Host "Цель: standalone .exe → $exe"
} else {
    $pyw = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
    if (-not $pyw) {
        foreach ($p in @("$env:LOCALAPPDATA\Programs\Python\Python314\pythonw.exe",
                          "$env:LOCALAPPDATA\Programs\Python\Python312\pythonw.exe",
                          "$env:LOCALAPPDATA\Programs\Python\Python311\pythonw.exe")) {
            if (Test-Path $p) { $pyw = $p; break }
        }
    }
    if (-not $pyw) {
        Write-Host '[!] Не найден pythonw и не собран .exe.' -ForegroundColor Red
        Write-Host '    Вариант А: установите Python 3.10+ (с галочкой Add to PATH).'
        Write-Host '    Вариант Б: соберите .exe командой build-exe.bat и повторите.'
        exit 1
    }
    $cmd = $pyw
    $args = "`"$dir\agent.py`""
    Write-Host "Цель: $pyw + agent.py"
}

# --- 2. Регистрируем задачу планировщика -----------------------------------
$action = if ($args) {
    New-ScheduledTaskAction -Execute $cmd -Argument $args -WorkingDirectory $dir
} else {
    New-ScheduledTaskAction -Execute $cmd -WorkingDirectory $dir
}
$trigger  = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999 `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Description 'Локальный мост браузер ↔ сканер (WIA) для B21 ERP' `
    -Force | Out-Null

Write-Host "[OK] Задача '$taskName' зарегистрирована (старт при входе, авто-перезапуск)."

# --- 3. Запускаем прямо сейчас ---------------------------------------------
try {
    Start-ScheduledTask -TaskName $taskName
    Start-Sleep -Seconds 2
    $ok = $false
    try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8765/status' -UseBasicParsing -TimeoutSec 3; $ok = $r.StatusCode -eq 200 } catch {}
    if ($ok) { Write-Host '[OK] Агент запущен и отвечает на http://127.0.0.1:8765' -ForegroundColor Green }
    else { Write-Host '[i] Агент запускается… обновите страницу B21 через несколько секунд.' }
} catch {
    Write-Host "[i] Не удалось стартовать сейчас: $($_.Exception.Message). Стартует при следующем входе."
}
Write-Host ''
Write-Host 'Готово. Агент будет запускаться сам при каждом включении/входе в Windows.'
