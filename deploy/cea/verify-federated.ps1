param([ValidateSet('fedavg','fedprox')][string]$Algorithm='fedavg', [string]$ExecutionId)
. (Join-Path $PSScriptRoot 'common.ps1')
$taskSettings = Read-CeaSettings
$taskHeaders = Get-CeaHeaders $taskSettings
$taskApi = "http://127.0.0.1:$($taskSettings.CEA_API_PORT)/api/namespaces/lab"
if ($ExecutionId) {
    $taskExecutionId = ([guid]$ExecutionId).ToString()
} else {
    $taskHeaders['Idempotency-Key'] = [guid]::NewGuid().ToString()
    $taskSubmission = Invoke-RestMethod -Method Post -Uri "$taskApi/executions" -Headers $taskHeaders -ContentType 'application/json' -Body (@{flowId=$Algorithm;inputs=@{rounds=2}} | ConvertTo-Json)
    $taskExecutionId = $taskSubmission.executionId
}
Write-Output "$Algorithm execution: $taskExecutionId"
$taskDeadline = (Get-Date).AddMinutes(20)
$taskLastState = ''
do {
    $taskExecution = Invoke-RestMethod -Uri "$taskApi/executions/$taskExecutionId" -Headers $taskHeaders
    if ($taskExecution.flowId -ne $Algorithm) { throw 'Execution does not belong to the requested algorithm' }
    if ($taskExecution.state -ne $taskLastState) { Write-Output "$Algorithm state: $($taskExecution.state)"; $taskLastState=$taskExecution.state }
    if ($taskExecution.state -in @('SUCCESS','FAILED','KILLED')) { break }
    if ((Get-Date) -gt $taskDeadline) { throw "Verification timed out; inspect execution $taskExecutionId. It was not automatically cancelled." }
    Start-Sleep -Seconds 3
} while ($true)
$taskEvidence = Join-Path $taskRepository ".local/cea/evidence/$Algorithm/$taskExecutionId"
[IO.Directory]::CreateDirectory($taskEvidence) | Out-Null
Write-CeaGeneratedFile (Join-Path $taskEvidence 'execution.json') ($taskExecution | ConvertTo-Json -Depth 60)
$taskRuns = Invoke-RestMethod -Uri "$taskApi/executions/$taskExecutionId/tasks" -Headers $taskHeaders
Write-CeaGeneratedFile (Join-Path $taskEvidence 'tasks.json') ($taskRuns | ConvertTo-Json -Depth 60)
if ($taskExecution.state -ne 'SUCCESS') { throw "Execution failed: $($taskExecution.error). Evidence: $taskEvidence" }
if ($taskExecution.outputs.completed_rounds -ne 2) { throw 'Expected two completed rounds' }
$taskLeaves = @($taskRuns | Where-Object { $_.taskId -in @('init','train','aggregate','evaluate') })
if ($taskLeaves.Count -ne 11) { throw 'Expected init plus two rounds of three clients, aggregate and evaluate' }
$taskCopies = @()
foreach ($taskRun in $taskLeaves) {
    if ($taskRun.state -ne 'SUCCESS') { throw 'A leaf task was not successful' }
    $taskRound = $taskRun.iteration
    $taskName = $taskRun.taskId
    $taskCluster = 'cloud'
    if ($taskRun.taskId -eq 'train') {
        $taskParent = @($taskRuns | Where-Object id -eq $taskRun.parentTaskRunId)[0]
        $taskRound = $taskParent.iteration
        $taskLetter = @('a','b','c')[$taskRun.iteration-1]
        $taskName = "client-$taskLetter"
        $taskCluster = "edge-$taskLetter"
    }
    $taskFile = if($taskName -eq 'init') {'init.pt'} elseif($taskName -eq 'evaluate') {"evaluate-r$taskRound.json"} else {"$taskName-r$taskRound.pt"}
    $taskPort = if ($taskRun.taskId -eq 'evaluate') { 'metrics.json' } else { 'model.pt' }
    $taskUri = [uri]$taskRun.outputs.$taskPort
    $taskBucket = if ($taskCluster -eq 'cloud') { 'cea-artifacts' } else { "cea-artifacts-$taskCluster" }
    $taskAlias = if ($taskCluster -eq 'cloud') { 'local' } else { $taskCluster }
    if ($taskUri.Scheme -ne 's3' -or $taskUri.Host -ne $taskBucket) { throw "Expected artifact in actual execution store $taskBucket" }
    $taskCopies += @{source="$taskAlias/$($taskUri.Host)$($taskUri.AbsolutePath)";destination=$taskFile}
    $taskJob = (Invoke-CeaCompose exec -T $taskCluster kubectl get job "cea-$($taskRun.id)-a1" -n cea-lab -o json) | ConvertFrom-Json
    if ($taskJob.status.succeeded -ne 1) { throw "Expected completed Job in cluster $taskCluster" }
    if (@($taskJob.spec.template.spec.initContainers.name) -notcontains 'files-in' -or @($taskJob.spec.template.spec.containers.name) -notcontains 'files-out') { throw 'Missing platform file helpers' }
    $taskMain = @($taskJob.spec.template.spec.containers | Where-Object name -eq 'task')[0]
    if (@($taskMain.volumeMounts.name) -contains 'file-plan') { throw 'Algorithm must not receive file authorization Secret' }
    $taskSecretName = Invoke-CeaCompose exec -T $taskCluster kubectl get secret "cea-$($taskRun.id)-a1-files" -n cea-lab --ignore-not-found -o name
    if ($taskSecretName) { throw 'Completed task still retains file authorization Secret' }
    Write-CeaGeneratedFile (Join-Path $taskEvidence "$taskName-r$taskRound-job.json") ($taskJob | ConvertTo-Json -Depth 60)
}
foreach ($taskFile in @('edge-a.pt','edge-b.pt','edge-c.pt','test.pt')) { Copy-Item -LiteralPath (Join-Path $taskRepository ".local/cea/mnist/$taskFile") -Destination $taskEvidence }
$taskRelative = "evidence/$Algorithm/$taskExecutionId"
# Paths come from platform-owned S3 URIs and generated UUIDs, not arbitrary Flow shell content.
$taskFetch = 'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; '
$taskFetch += 'for edge in edge-a edge-b edge-c; do mc alias set "$edge" "http://minio-$edge:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; done; '
foreach ($taskCopy in $taskCopies) {
    if ($taskCopy.source -notmatch '^(local/cea-artifacts|edge-[abc]/cea-artifacts-edge-[abc])/[A-Za-z0-9/._-]+$') { throw 'Unexpected artifact key characters' }
    $taskFetch += 'mc cp "' + $taskCopy.source + '" "/data/' + $taskRelative + '/' + $taskCopy.destination + '"; '
}
Invoke-CeaCompose run --rm --no-deps storage-tool -ec $taskFetch
$taskAudit = & docker run --rm --label com.docker.compose.project=cea --memory 2g --mount "type=bind,source=$taskEvidence,target=/audit,readonly" cea/federated:deploy-v1 python /app/verify_run.py /audit $Algorithm
if ($LASTEXITCODE -ne 0) { throw "Numerical verification failed for $taskExecutionId" }
Write-CeaGeneratedFile (Join-Path $taskEvidence 'numerical-audit.json') ($taskAudit -join "`n")
Write-Output ($taskAudit -join "`n")
Write-Output "PASS: $Algorithm, actual four clusters and stores, Pod helpers, 11 Jobs, two rounds, independent numerical audit. Evidence: $taskEvidence"
