. (Join-Path $PSScriptRoot '../../../deploy/cea/common.ps1')
$taskHeaders=Get-CeaHeaders (Read-CeaSettings)
$taskApi='http://127.0.0.1:18085/api/namespaces/lab'
$taskFolder=Join-Path $taskRepository '.local/cea/cifar10-partitions'
$taskManifests=Get-Content (Join-Path $taskFolder 'manifest.json') -Raw | ConvertFrom-Json
$taskBefore=Invoke-RestMethod "$taskApi/resources/datasets/cifar10-train/versions/v1" -Headers $taskHeaders
foreach($taskManifest in $taskManifests){
    $taskExists=$false
    try{$null=Invoke-RestMethod "$taskApi/resources/datasets/cifar10-train/versions/$($taskManifest.version)" -Headers $taskHeaders;$taskExists=$true}
    catch{if($_.Exception.Response.StatusCode.value__ -ne 404){throw}}
    if($taskExists){throw 'Dataset version exists; no overwrite'}
}
Invoke-CeaCompose run --rm --no-deps storage-tool -ec 'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; for v in equal-noniid-v1 strong-noniid-v1; do for c in a b c; do mc cp "/data/cifar10-partitions/$v/edge-$c.pt" "local/datasets/cifar10/$v/edge-$c.pt" >/dev/null; mkdir -p "/data/cifar10-partitions-readback/$v"; mc cp "local/datasets/cifar10/$v/edge-$c.pt" "/data/cifar10-partitions-readback/$v/edge-$c.pt" >/dev/null; done; done'
foreach($taskManifest in $taskManifests){
    $taskVersion=$taskManifest.version
    $taskBody=@{datasetId='cifar10-train';version=$taskVersion;format='pt';locations=@(
        foreach($taskCluster in @('edge-a','edge-b','edge-c')){@{clusterId=$taskCluster;uri="s3://datasets/cifar10/$taskVersion/$taskCluster.pt"}}
    )}
    $null=Invoke-RestMethod -Method Put -Uri "$taskApi/resources/datasets/cifar10-train/versions/$taskVersion" -Headers $taskHeaders -ContentType 'application/json' -Body ($taskBody | ConvertTo-Json -Depth 10)
    $taskActual=Invoke-RestMethod "$taskApi/resources/datasets/cifar10-train/versions/$taskVersion" -Headers $taskHeaders
    if($taskActual.locations.Count -ne 3){throw 'Dataset readback mismatch'}
}
$taskAfter=Invoke-RestMethod "$taskApi/resources/datasets/cifar10-train/versions/v1" -Headers $taskHeaders
if(($taskAfter|ConvertTo-Json -Depth 12) -ne ($taskBefore|ConvertTo-Json -Depth 12)){throw 'Original dataset changed'}
'Registered two CIFAR-10 versions; original v1 preserved'
