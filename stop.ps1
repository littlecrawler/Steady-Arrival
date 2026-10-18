$pidFile = Join-Path $PSScriptRoot '.runtime\server.pid'
if (Test-Path -LiteralPath $pidFile) {
    $appPid = [int](Get-Content -LiteralPath $pidFile)
    $appProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$appPid" -ErrorAction SilentlyContinue
    $expectedScript = Join-Path $PSScriptRoot 'server.mjs'
    if ($appProcess -and $appProcess.Name -eq 'node.exe' -and $appProcess.CommandLine.Contains($expectedScript)) {
        Stop-Process -Id $appPid
    }
    Remove-Item -LiteralPath $pidFile
}
