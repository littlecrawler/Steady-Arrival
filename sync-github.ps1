$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
try {
    $origin = & git remote get-url origin
    if ($LASTEXITCODE -ne 0 -or $origin -notmatch '^(git@github\.com:|https://github\.com/)littlecrawler/Steady-Arrival(\.git)?$') { throw 'Unexpected repository. Check the origin before publishing.' }
    $branch = & git branch --show-current
    if ($branch -ne 'main') { throw 'Switch to main before publishing progress.' }
    & git rev-parse --verify --quiet HEAD | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'First publish is not set up. Follow the initial upload steps in README.md first.' }
    & node scripts/export-public.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Export failed. Your local records are unchanged.' }
    & git add -- public/progress.json
    if ($LASTEXITCODE -ne 0) { throw 'Could not stage the public snapshot.' }
    & git diff --cached --quiet -- public/progress.json
    if ($LASTEXITCODE -eq 1) {
        & git commit --only -m 'Update public progress snapshot' -- public/progress.json
        if ($LASTEXITCODE -ne 0) { throw 'Could not commit the public snapshot.' }
    } elseif ($LASTEXITCODE -ne 0) { throw 'Could not inspect the snapshot change.' }
    & git -c 'core.sshCommand=ssh -o BatchMode=yes -o ConnectTimeout=15' push origin main
    if ($LASTEXITCODE -ne 0) { throw 'Push did not finish. The snapshot and your local records are still saved; retry later.' }
    Write-Host 'Published progress to GitHub. The public page will update after deployment.'
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
