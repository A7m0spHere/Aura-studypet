$ErrorActionPreference = "Continue"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$logDir = Join-Path $root "logs"
$logPath = Join-Path $logDir "tauri-dev.log"
$exePath = Join-Path $root "src-tauri\target\debug\aura.exe"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
if (Test-Path -LiteralPath $logPath) {
  Remove-Item -LiteralPath $logPath -Force
}

Set-Location -LiteralPath $root
cmd.exe /c "npm run build 2>&1" | Tee-Object -FilePath $logPath
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Push-Location -LiteralPath (Join-Path $root "src-tauri")
cmd.exe /c "cargo build 2>&1" | Tee-Object -FilePath $logPath -Append
$cargoExitCode = $LASTEXITCODE
Pop-Location
if ($cargoExitCode -ne 0) {
  exit $cargoExitCode
}

$process = Start-Process `
  -FilePath $exePath `
  -WorkingDirectory (Split-Path -Parent $exePath) `
  -PassThru

Start-Sleep -Seconds 3

Write-Host "Aura app started. PID: $($process.Id)"
Write-Host "Log: $logPath"
Get-Process |
  Where-Object { $_.ProcessName -eq "aura" } |
  Select-Object ProcessName, Id, MainWindowHandle, MainWindowTitle
