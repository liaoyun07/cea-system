# Requires approval for three storage services and namespaced helper Secret RBAC.
# Does not restart backend, frontend, registries or algorithm clusters, or migrate datasets.
. (Join-Path $PSScriptRoot 'common.ps1')
Invoke-CeaCompose up -d --no-deps --wait --wait-timeout 180 minio-edge-a minio-edge-b minio-edge-c
Invoke-CeaCompose run --rm --no-deps storage-tool -ec 'for edge in edge-a edge-b edge-c; do mc alias set "$edge" "http://minio-$edge:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; mc mb --ignore-existing "$edge/cea-artifacts-$edge"; mc admin user add "$edge" "$CEA_S3_ACCESS_KEY" "$CEA_S3_SECRET_KEY" >/dev/null; mc admin policy create "$edge" cea-backend /config/s3-edge-policy.json; mc admin policy attach "$edge" cea-backend --user "$CEA_S3_ACCESS_KEY"; done'
& docker build -t cea/file-helper:local (Join-Path $taskRepository 'deploy/file-helper')
if ($LASTEXITCODE -ne 0) { throw 'File helper build failed' }
$taskArchive = Join-Path $taskRepository '.local/cea/file-helper.tar'
& docker image save --output $taskArchive cea/file-helper:local
if ($LASTEXITCODE -ne 0) { throw 'File helper export failed' }
$taskHelpers = @{}
foreach ($taskCluster in @('cloud','edge-a','edge-b','edge-c')) {
    $taskRegistry = if ($taskCluster -eq 'cloud') { 'registry-center:5000' } else { "registry-${taskCluster}:5000" }
    Invoke-CeaCompose run --rm --no-deps image-tool copy --dest-tls-verify=false --dest-authfile=/run/secrets/registry-auth.json docker-archive:/data/file-helper.tar "docker://${taskRegistry}/cea/file-helper:v1"
    $taskDigest = (Invoke-CeaCompose run --rm --no-deps image-tool inspect --tls-verify=false --authfile=/run/secrets/registry-auth.json --format '{{.Digest}}' "docker://${taskRegistry}/cea/file-helper:v1").Trim()
    if ($taskDigest -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Invalid helper digest' }
    $taskHelpers[$taskCluster] = "${taskRegistry}/cea/file-helper@${taskDigest}"
    Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'rbac.yaml') | Invoke-CeaCompose exec -T $taskCluster kubectl apply -f -
}
# These CEA clusters have CoreDNS disabled. Grant URLs use reachable Docker bridge IPs,
# not backend-only DNS names. Regenerate after storage recreation/network address changes.
$taskStores = @{}
foreach ($taskStore in @('center','edge-a','edge-b','edge-c')) {
    $taskService = if ($taskStore -eq 'center') { 'minio' } else { "minio-$taskStore" }
    $taskId = (Invoke-CeaCompose ps -q $taskService).Trim()
    $taskInspection = (& docker inspect $taskId | ConvertFrom-Json)[0]
    $taskIp = $taskInspection.NetworkSettings.Networks.cea_default.IPAddress
    $taskParsedIp = $null
    if (-not [Net.IPAddress]::TryParse($taskIp,[ref]$taskParsedIp)) { throw "Invalid storage IP: $taskService" }
    $taskStores[$taskStore] = @{'transfer-endpoint'="http://${taskIp}:9000"}
}
$taskConfig = @{platform=@{jobs=@{storage=@{lab=@{stores=$taskStores}};helpers=@{lab=$taskHelpers}}}}
Write-CeaGeneratedFile (Join-Path $PSScriptRoot 'secrets/backend/storage-endpoints.yaml') ($taskConfig | ConvertTo-Json -Depth 10)
Write-Output 'File storage/helper configuration ready. No business flow or backend restart performed.'
