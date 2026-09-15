. (Join-Path $PSScriptRoot '../../../deploy/cea/common.ps1')
$taskUploaded=@()
foreach ($taskDataset in @('cifar10','cifar100')) {
    $taskManifest=Get-Content (Join-Path $taskRepository ".local/cea/par01/$taskDataset/manifest.json") -Raw | ConvertFrom-Json
    foreach ($taskFile in $taskManifest) {
        if ($taskFile.client -notmatch '^edge-[abc][12]$') { throw 'Unexpected partition name' }
        $taskKey="par01/$taskDataset/$($taskFile.client).pt"
        $taskCommand='mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; mc cp "/data/' + $taskKey + '" "local/datasets/' + $taskKey + '" >/dev/null; mc stat --json "local/datasets/' + $taskKey + '"'
        $taskObject=(Invoke-CeaCompose run --rm --no-deps storage-tool -ec $taskCommand) | ConvertFrom-Json
        if ($taskObject.status -ne 'success' -or $taskObject.size -ne $taskFile.bytes) {throw 'Uploaded partition size mismatch'}
        $taskUploaded+=@{dataset=$taskDataset;client=$taskFile.client;bytes=$taskObject.size}
        Write-Output "Verified $taskKey $($taskObject.size) bytes"
    }
}
Write-CeaGeneratedFile (Join-Path $taskRepository '.local/cea/par01/uploaded.json') ($taskUploaded | ConvertTo-Json)
