param([ValidateSet('upload','models')][string]$Mode = 'upload', [switch]$Clean)
. (Join-Path $PSScriptRoot '../../../deploy/cea/common.ps1')
$taskBatch = if ($Clean) { 'par22-clean' } else { 'par22' }
if ($Clean -and $Mode -eq 'upload') { throw 'Clean rerun reuses data' }
$taskEvidence = Join-Path $taskRepository ".local/cea/$taskBatch"
$taskScript = @'
mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
for edge in edge-a edge-b edge-c; do
  mc alias set "$edge" "http://minio-$edge:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
done
'@
if ($Mode -eq 'upload') {
    $taskManifest = Get-Content (Join-Path $taskEvidence 'prepare-audit.json') -Raw | ConvertFrom-Json
    if ($taskManifest.result -ne 'PASS' -or $taskManifest.processedSamples -ne 100000) { throw 'Preparation audit required' }
    foreach ($taskShard in $taskManifest.shards) {
        $taskCluster = $taskShard.cluster
        if ($taskCluster -notmatch '^edge-[abc]$') { throw 'Unexpected cluster' }
        $taskScript += "`nif mc stat local/datasets/par22/raw/$taskCluster.pt >/dev/null 2>&1; then echo 'Refuse existing object'; exit 1; fi"
        $taskScript += "`nmc cp /data/par22/raw/$taskCluster.pt local/datasets/par22/raw/$taskCluster.pt >/dev/null"
        $taskScript += "`nmc cp local/datasets/par22/raw/$taskCluster.pt /data/par22/readback/$taskCluster.pt >/dev/null"
    }
} else {
    $taskAudit = Get-Content (Join-Path $taskEvidence 'audit.json') -Raw | ConvertFrom-Json
    if ($taskAudit.result -ne 'PASS') { throw 'Job audit required' }
    foreach ($taskCopy in $taskAudit.copies) {
        if ($taskCopy.source -notmatch '^(local/cea-artifacts|edge-[abc]/cea-artifacts-edge-[abc])/[A-Za-z0-9/._-]+$') { throw 'Unexpected source' }
        if ($taskCopy.destination -notmatch "^$taskBatch/models/[0-7]/(init-0|train-[1-6]|aggregate-1)\.pt$") { throw 'Unexpected destination' }
        if (Test-Path (Join-Path $taskRepository ".local/cea/$($taskCopy.destination)")) { throw 'Refuse overwriting evidence' }
        $taskScript += "`nmc cp `"$($taskCopy.source)`" `"/data/$($taskCopy.destination)`" >/dev/null"
    }
}
Invoke-CeaCompose run --rm --no-deps storage-tool -ec $taskScript
