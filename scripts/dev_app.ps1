$ErrorActionPreference = "Continue"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$logDir = Join-Path $root "logs"
$logPath = Join-Path $logDir "tauri-dev.log"
$exePath = Join-Path $root "src-tauri\target\debug\aura.exe"
$devUrl = "http://127.0.0.1:1420"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
if (Test-Path -LiteralPath $logPath) {
  Remove-Item -LiteralPath $logPath -Force
}

function Test-DevServer {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $devUrl -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Wait-DevServer {
  param([int]$TimeoutSeconds = 20)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-DevServer) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
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

if (Test-DevServer) {
  "Vite dev server already ready: $devUrl" | Tee-Object -FilePath $logPath -Append
} else {
  "Starting Vite dev server: $devUrl" | Tee-Object -FilePath $logPath -Append
  Start-Process `
    -FilePath "C:\Program Files\nodejs\npm.cmd" `
    -ArgumentList "run", "dev" `
    -WorkingDirectory $root `
    -WindowStyle Hidden | Out-Null

  if (Wait-DevServer -TimeoutSeconds 25) {
    "Vite dev server ready: $devUrl" | Tee-Object -FilePath $logPath -Append
  } else {
    "Vite dev server failed to start within 25 seconds: $devUrl" | Tee-Object -FilePath $logPath -Append
    exit 1
  }
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
