# Generate administrator-owned configuration, never import legacy business data.
. (Join-Path $PSScriptRoot 'common.ps1')
if (-not $taskRepository.StartsWith('D:\', [StringComparison]::OrdinalIgnoreCase)) { throw 'This deployment is intended to live on D:.' }
$taskDockerSettings = Get-Content -Raw -LiteralPath (Join-Path $env:APPDATA 'Docker/settings-store.json') | ConvertFrom-Json
if (-not $taskDockerSettings.CustomWslDistroDir.StartsWith('D:\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Switch Docker Desktop WSL data storage to D: before deploying CEA.' }
$taskEnvPath = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path -LiteralPath $taskEnvPath)) {
    $taskTemplate = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '.env.example')
    $taskRng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $taskTemplate = [regex]::Replace($taskTemplate, 'REPLACE_WITH_RANDOM_PASSWORD', {
            $taskBytes = New-Object byte[] 24
            $taskRng.GetBytes($taskBytes)
            [BitConverter]::ToString($taskBytes).Replace('-', '').ToLowerInvariant()
        })
    } finally { $taskRng.Dispose() }
    Write-CeaGeneratedFile $taskEnvPath $taskTemplate
}
$taskSettings = Read-CeaSettings
foreach ($taskName in @('BACKEND_PASSWORD','BACKEND_DB_PASSWORD','MYSQL_ROOT_PASSWORD','MINIO_ROOT_PASSWORD','CEA_S3_SECRET_KEY','REGISTRY_PASSWORD')) {
    if (-not $taskSettings[$taskName] -or $taskSettings[$taskName] -match '^REPLACE_') { throw "Configure $taskName in .env" }
}
$taskSecrets = Join-Path $PSScriptRoot 'secrets'
Write-CeaGeneratedFile (Join-Path $taskSecrets 'backend/s3-access') $taskSettings.CEA_S3_ACCESS_KEY
Write-CeaGeneratedFile (Join-Path $taskSecrets 'backend/s3-secret') $taskSettings.CEA_S3_SECRET_KEY
$taskAuth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($taskSettings.REGISTRY_USER + ':' + $taskSettings.REGISTRY_PASSWORD))
$taskRegistryAuths = @{}
foreach ($taskName in @('center','edge-a','edge-b','edge-c')) {
    $taskRegistryAuths["registry-${taskName}:5000"] = @{auth=$taskAuth}
}
Write-CeaGeneratedFile (Join-Path $taskSecrets 'backend/registry-auth.json') (@{auths=$taskRegistryAuths} | ConvertTo-Json -Depth 5)
# htpasswd reads the password on stdin inside this disposable container; no password in command arguments.
$taskHtpasswd = & docker run --rm --label com.docker.compose.project=cea --env-file $taskEnvPath --entrypoint /bin/sh cea/backend:local -c 'printf "%s\n" "$REGISTRY_PASSWORD" | htpasswd -Bni "$REGISTRY_USER"'
if ($LASTEXITCODE -ne 0) { throw 'Cannot generate Registry credentials; build cea/backend:local first.' }
Write-CeaGeneratedFile (Join-Path $taskSecrets 'registry.htpasswd') (($taskHtpasswd -join "`n") + "`n")
foreach ($taskCluster in @('cloud','edge-a','edge-b','edge-c')) {
    $taskRegistry = if ($taskCluster -eq 'cloud') { 'registry-center:5000' } else { "registry-${taskCluster}:5000" }
    $taskYaml = @"
mirrors:
  "${taskRegistry}":
    endpoint: ["http://${taskRegistry}"]
configs:
  "${taskRegistry}":
    auth:
      username: $($taskSettings.REGISTRY_USER)
      password: $($taskSettings.REGISTRY_PASSWORD)
"@
    Write-CeaGeneratedFile (Join-Path $taskSecrets "registries/$taskCluster.yaml") $taskYaml
}
$taskImages = Join-Path $taskSecrets 'images'
[IO.Directory]::CreateDirectory($taskImages) | Out-Null
$taskPause = Join-Path $taskImages 'pause.tar'
if (-not (Test-Path -LiteralPath $taskPause)) {
    & docker image inspect rancher/mirrored-pause:3.6 --format '{{.Id}}' | Out-Null
    if ($LASTEXITCODE -ne 0) { & docker pull rancher/mirrored-pause:3.6; if ($LASTEXITCODE -ne 0) { throw 'Pause image pull failed' } }
    & docker image save --output $taskPause rancher/mirrored-pause:3.6
    if ($LASTEXITCODE -ne 0) { throw 'Pause image export failed' }
}
[IO.Directory]::CreateDirectory((Join-Path $taskRepository '.local/cea')) | Out-Null
Invoke-CeaCompose config --quiet
Write-Output 'CEA local settings ready. Credentials remain in deploy/cea/.env and secrets/ (Git ignored).'
