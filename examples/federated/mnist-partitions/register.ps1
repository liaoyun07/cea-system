# Prepare/test first. Add two versions only, never overwrite v1 or other resources.
. (Join-Path $PSScriptRoot '../../../deploy/cea/common.ps1')
$taskSettings=Read-CeaSettings
$taskHeaders=Get-CeaHeaders $taskSettings
$taskApi="http://127.0.0.1:$($taskSettings.CEA_API_PORT)/api/namespaces/lab"
$taskFolder=Join-Path $taskRepository '.local/cea/mnist-partitions'
$taskManifests=Get-Content (Join-Path $taskFolder 'manifest.json') -Raw | ConvertFrom-Json
$taskBefore=Invoke-RestMethod "$taskApi/resources/datasets/mnist-train/versions/v1" -Headers $taskHeaders
foreach($taskManifest in $taskManifests){
    $taskExists=$false
    try { $null=Invoke-RestMethod "$taskApi/resources/datasets/mnist-train/versions/$($taskManifest.version)" -Headers $taskHeaders; $taskExists=$true }
    catch { if($_.Exception.Response.StatusCode.value__ -ne 404){throw} }
    if($taskExists){throw 'Dataset version already exists; do not overwrite'}
}
Invoke-CeaCompose run --rm --no-deps storage-tool -ec 'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; for v in equal-noniid-v1 strong-noniid-v1; do for c in a b c; do mc cp "/data/mnist-partitions/$v/edge-$c.pt" "local/datasets/mnist/$v/edge-$c.pt" >/dev/null; mc stat "local/datasets/mnist/$v/edge-$c.pt" >/dev/null; done; done'
foreach($taskManifest in $taskManifests){
    $taskVersion=$taskManifest.version
    $taskBody=@{datasetId='mnist-train';version=$taskVersion;format='pt';locations=@(
        foreach($taskCluster in @('edge-a','edge-b','edge-c')){@{clusterId=$taskCluster;uri="s3://datasets/mnist/$taskVersion/$taskCluster.pt"}}
    )}
    $null=Invoke-RestMethod -Method Put -Uri "$taskApi/resources/datasets/mnist-train/versions/$taskVersion" -Headers $taskHeaders -ContentType 'application/json' -Body ($taskBody | ConvertTo-Json -Depth 10)
    $taskActual=Invoke-RestMethod "$taskApi/resources/datasets/mnist-train/versions/$taskVersion" -Headers $taskHeaders
    if($taskActual.locations.Count -ne 3 -or $taskActual.version -ne $taskVersion){throw 'Dataset readback mismatch'}
}
$taskAfter=Invoke-RestMethod "$taskApi/resources/datasets/mnist-train/versions/v1" -Headers $taskHeaders
if(($taskAfter | ConvertTo-Json -Depth 12) -ne ($taskBefore | ConvertTo-Json -Depth 12)){throw 'Original dataset changed'}
Write-Output 'PASS: two MNIST train versions and six objects added; original v1 preserved. No Flow/image/contracts changed or executions submitted.'
