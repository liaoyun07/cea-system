# Read only the four artifacts from this pair, then reevaluate without training.
. (Join-Path $PSScriptRoot '../../../deploy/cea/common.ps1')
$taskFolder = Join-Path $taskRepository '.local/cea/fl-resource95-20261017'
$taskCopy = 'mc alias set cloud http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; '
foreach ($taskAlgorithm in @('fedavg', 'fedcads')) {
    $taskTrial = Get-Content -LiteralPath (Join-Path $taskFolder "$taskAlgorithm.json") -Raw | ConvertFrom-Json
    if ($taskTrial.algorithm -ne $taskAlgorithm -or $taskTrial.execution.flowId -ne "mnist-strong-$taskAlgorithm" -or $taskTrial.execution.state -ne 'SUCCESS') {
        throw "Unexpected execution for $taskAlgorithm"
    }
    $taskExecutionId = $taskTrial.execution.id
    if ($taskExecutionId -notmatch '^[a-f0-9-]{36}$') { throw 'Invalid execution ID' }
    $taskFirst = @($taskTrial.evaluations | Sort-Object round | Where-Object accuracy -GE 0.95 | Select-Object -First 1)
    if ($taskFirst.Count -ne 1) { throw "$taskAlgorithm did not reach 95%; do not replace the run" }
    $taskInit = @($taskTrial.tasks | Where-Object taskId -EQ 'init')
    $taskAggregate = @($taskTrial.tasks | Where-Object { $_.taskId -eq 'aggregate' -and $_.iteration -eq $taskFirst[0].round })
    if ($taskInit.Count -ne 1 -or $taskAggregate.Count -ne 1) { throw 'Expected one init and one first-95 aggregate' }
    foreach ($taskPair in @(@{ task = $taskInit[0]; name = 'init' }, @{ task = $taskAggregate[0]; name = 'first95' })) {
        $taskTask = $taskPair.task
        if ($taskTask.state -ne 'SUCCESS' -or $taskTask.executionId -ne $taskExecutionId) { throw 'Artifact task is not a successful member of this execution' }
        if ($taskTask.id -notmatch '^[a-f0-9-]{36}$') { throw 'Invalid artifact task ID' }
        $taskSource = $taskTask.outputs.'model.pt'
        $taskExpected = '^s3://cea-artifacts/lab/' + [regex]::Escape($taskExecutionId) + '/' + [regex]::Escape($taskTask.id) + '/[1-9][0-9]*/model\.pt$'
        if ($taskSource -notmatch $taskExpected) { throw 'Model URI is outside this task/execution artifact prefix' }
        $taskObject = $taskSource.Substring('s3://'.Length)
        $taskCopy += "mc cp 'cloud/$taskObject' '/data/fl-resource95-20261017/$taskAlgorithm-$($taskPair.name).pt' >/dev/null; "
    }
}
Invoke-CeaCompose run --rm --no-deps storage-tool -ec $taskCopy
$taskAuditImage = & docker image inspect cea/federated:mnist-part-v1 --format '{{.Id}}'
if ($LASTEXITCODE -ne 0 -or $taskAuditImage -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Original audit image is unavailable' }
$taskReport = & docker run --rm --network none `
    --mount "type=bind,source=$PSScriptRoot/audit.py,target=/app/audit_resource95.py,readonly" `
    --mount "type=bind,source=$taskFolder,target=/audit,readonly" `
    --mount "type=bind,source=$taskRepository/.local/cea/mnist/test.pt,target=/test.pt,readonly" `
    $taskAuditImage python /app/audit_resource95.py
if ($LASTEXITCODE -ne 0) { throw 'Independent artifact audit failed; no training was rerun' }
$taskReportValue = ($taskReport -join "`n") | ConvertFrom-Json
if ($taskReportValue.passed -ne $true) { throw 'Artifact audit did not pass' }
$taskReportValue | Add-Member -NotePropertyName auditImageId -NotePropertyValue $taskAuditImage
$taskReportText = $taskReportValue | ConvertTo-Json -Depth 10
Write-CeaGeneratedFile (Join-Path $taskFolder 'model-audit.json') $taskReportText
$taskReportText
