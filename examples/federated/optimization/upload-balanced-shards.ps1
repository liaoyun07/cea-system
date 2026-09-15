. (Join-Path $PSScriptRoot '../../../deploy/cea/common.ps1')
$taskManifest = Get-Content (Join-Path $taskRepository '.local/cea/par13/raw/manifest.json') -Raw | ConvertFrom-Json
if ($taskManifest.result -ne 'PASS' -or $taskManifest.uniqueSamples -ne 50000) { throw 'Partition audit required' }
$taskScript = @'
mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
'@
foreach ($taskShard in $taskManifest.shards) {
    if ($taskShard.cluster -notmatch '^edge-[abc]$') { throw 'Unexpected cluster' }
    $taskCluster = $taskShard.cluster
    $taskScript += "`nif mc stat `"local/datasets/par13/raw/$taskCluster.pt`" >/dev/null 2>&1; then echo 'Refuse existing object'; exit 1; fi"
    $taskScript += "`nmc cp `"/data/par13/raw/$taskCluster.pt`" `"local/datasets/par13/raw/$taskCluster.pt`" >/dev/null"
    $taskScript += "`nmc stat --json `"local/datasets/par13/raw/$taskCluster.pt`""
    $taskScript += "`nmc cp `"local/datasets/par13/raw/$taskCluster.pt`" `"/data/par13/readback/$taskCluster.pt`" >/dev/null"
}
$taskObjects = @(Invoke-CeaCompose run --rm --no-deps storage-tool -ec $taskScript | ForEach-Object { $_ | ConvertFrom-Json })
if ($taskObjects.Count -ne 3) { throw 'Expected three storage results' }
for ($taskIndex=0; $taskIndex -lt 3; $taskIndex++) {
    if ($taskObjects[$taskIndex].status -ne 'success' -or $taskObjects[$taskIndex].size -ne $taskManifest.shards[$taskIndex].bytes) { throw 'Uploaded size mismatch' }
}
Write-CeaGeneratedFile (Join-Path $taskRepository '.local/cea/par13/uploaded.json') (@{result='PASS';objects=$taskObjects} | ConvertTo-Json -Depth 10)
Write-Output 'Uploaded three equal-size edge shards using the original datasets store; downloaded audit copies.'
