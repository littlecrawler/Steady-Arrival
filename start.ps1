param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$appUrl = 'http://127.0.0.1:8765'
try {
    $status = Invoke-RestMethod -Uri "$appUrl/api/health" -TimeoutSec 2
    if ($status.app -eq 'steady-arrival') {
        if (-not $NoBrowser) { Start-Process $appUrl }
        exit
    }
} catch {}
$nodeCommand = Get-Command node -ErrorAction Stop
$runtimeFolder = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Force -Path $runtimeFolder | Out-Null
$serverPath = Join-Path $projectRoot 'server.mjs'
$appProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList @('"' + $serverPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeFolder 'server.log') -RedirectStandardError (Join-Path $runtimeFolder 'server-error.log')
$appProcess.Id | Set-Content -LiteralPath (Join-Path $runtimeFolder 'server.pid')
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 300
    try {
        $status = Invoke-RestMethod -Uri "$appUrl/api/health" -TimeoutSec 1
        if ($status.app -eq 'steady-arrival') {
            if (-not $NoBrowser) { Start-Process $appUrl }
            exit
        }
    } catch {}
    if ($appProcess.HasExited) { break }
}
Write-Host 'Unable to start the app. See .runtime/server-error.log.'
exit 1
