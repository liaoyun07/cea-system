param(
    [Parameter(Mandatory=$true)][string]$JavaHome,
    [string]$MavenCommand='mvn.cmd'
)
. (Join-Path $PSScriptRoot 'common.ps1')
& (Join-Path $taskRepository 'scripts/verify.ps1') -JavaHome $JavaHome -MavenCommand $MavenCommand
Push-Location (Join-Path $taskRepository 'frontend')
try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'Frontend unit tests failed' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
} finally { Pop-Location }
foreach ($taskRole in @('backend','frontend')) {
    & docker build -f (Join-Path $PSScriptRoot "$taskRole.Dockerfile") -t "cea/${taskRole}:local" $taskRepository
    if ($LASTEXITCODE -ne 0) { throw "CEA $taskRole build failed" }
}
