# Read exact successful artifacts/Jobs only; no credential-bearing Pod exports.
. (Join-Path $PSScriptRoot '../../../deploy/cea/common.ps1')
$taskFolder = Join-Path $taskRepository '.local/cea/gfed-hsam'
$taskResult = Get-Content (Join-Path $taskFolder 'result.json') -Raw | ConvertFrom-Json
if ($taskResult.execution.state -ne 'SUCCESS') { throw 'Acceptance execution did not succeed' }
$taskHeaders = Get-CeaHeaders (Read-CeaSettings)
$taskApi = 'http://127.0.0.1:18085/api/namespaces/lab'
$taskCopy = ''
foreach ($taskCluster in @('cloud','edge-a','edge-b','edge-c')) {
    $taskHost = if ($taskCluster -eq 'cloud') { 'minio' } else { "minio-$taskCluster" }
    $taskCopy += 'mc alias set ' + $taskCluster + ' http://' + $taskHost + ':9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; '
}
$taskArtifacts = @()
$taskJobsByCluster = @{}
foreach ($taskCluster in @('cloud','edge-a','edge-b','edge-c')) { $taskJobsByCluster[$taskCluster] = @() }
foreach ($taskTask in $taskResult.tasks) {
    if ($taskTask.taskId -notin @('init','train','aggregate','evaluate')) { continue }
    $taskAttempts = @(Invoke-RestMethod "$taskApi/executions/$($taskResult.execution.id)/tasks/$($taskTask.id)/attempts" -Headers $taskHeaders)
    if ($taskAttempts.Count -ne 1 -or $taskAttempts[0].state -ne 'SUCCESS') { throw 'Expected one successful attempt per stage' }
    $taskCluster = if ($taskTask.taskId -eq 'train') { @('edge-a','edge-b','edge-c')[$taskTask.iteration-1] } else { 'cloud' }
    $taskJobsByCluster[$taskCluster] += "cea-$($taskTask.id)-a$($taskAttempts[0].attemptNo)"
    if ($taskTask.taskId -eq 'evaluate') { continue }
    $taskUri = [uri]$taskTask.outputs.'model.pt'
    $taskName = "$($taskTask.id).pt"
    $taskArtifacts += @{taskRunId=$taskTask.id;stage=$taskTask.taskId;cluster=$taskCluster;name=$taskName}
    $taskCopy += "mc cp '$taskCluster/$($taskUri.Host)$($taskUri.AbsolutePath)' '/data/gfed-hsam/$taskName' >/dev/null; "
}
Invoke-CeaCompose run --rm --no-deps storage-tool -ec $taskCopy
Write-CeaGeneratedFile (Join-Path $taskFolder 'artifacts.json') ($taskArtifacts | ConvertTo-Json -Depth 8)
foreach ($taskCluster in @('cloud','edge-a','edge-b','edge-c')) {
    $taskNames = $taskJobsByCluster[$taskCluster]
    $taskJobs = & docker exec "cea-$taskCluster-1" kubectl -n cea-lab get jobs @taskNames -o json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Exact Job read failed' }
    $taskSafe = @($taskJobs.items | ForEach-Object { @{name=$_.metadata.name;cluster=$taskCluster;status=$_.status;
        containers=@($_.spec.template.spec.containers | ForEach-Object {
            $taskArgs = if ($_.PSObject.Properties['args']) { $_.args } else { @() }
            @{name=$_.name;image=$_.image;command=$_.command;args=@($taskArgs)}
        })} })
    Write-CeaGeneratedFile (Join-Path $taskFolder "jobs-$taskCluster.json") ($taskSafe | ConvertTo-Json -Depth 12)
}
& docker run --rm --label com.docker.compose.project=cea -e OMP_NUM_THREADS=1 --memory 2g `
    --mount "type=bind,source=$taskFolder,target=/audit" `
    --mount "type=bind,source=$taskRepository/.local/cea/mnist-partitions/strong-noniid-v1,target=/train,readonly" `
    --mount "type=bind,source=$taskRepository/.local/cea/mnist/test.pt,target=/test.pt,readonly" `
    --mount "type=bind,source=$PSScriptRoot/audit.py,target=/app/audit_gfed_hsam.py,readonly" `
    cea/federated:gfed-hsam-v1 python /app/audit_gfed_hsam.py
if ($LASTEXITCODE -ne 0) { throw 'Actual model/state audit failed' }
