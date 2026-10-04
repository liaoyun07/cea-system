param([string]$Batch = 'validated')
. (Join-Path $PSScriptRoot '../../deploy/cea/common.ps1')
$taskHeaders = Get-CeaHeaders (Read-CeaSettings)
$taskApi = 'http://127.0.0.1:18085/api/namespaces/lab'
$taskRoot = Join-Path $taskRepository ".local/cea/hc01/$Batch"
$taskFlow = Invoke-RestMethod "$taskApi/flows/hydraulic-cloud-edge" -Headers $taskHeaders
for ($taskIndex=0; $taskIndex -lt 4; $taskIndex++) {
    $taskEvidence = Join-Path $taskRoot "trial-$taskIndex.json"
    if (Test-Path $taskEvidence) { throw 'A trial already exists. Preserve it; use a separate evidence directory for another batch.' }
    $taskAcceptedFile = Join-Path $taskRoot "accepted-$taskIndex.json"
    if (Test-Path $taskAcceptedFile) { $taskAccepted = Get-Content $taskAcceptedFile -Raw | ConvertFrom-Json } else {
        $taskHeaders['Idempotency-Key'] = [guid]::NewGuid().ToString()
        $taskAccepted = Invoke-RestMethod "$taskApi/executions" -Method Post -Headers $taskHeaders -ContentType 'application/json' -Body (@{flowId='hydraulic-cloud-edge';revision=$taskFlow.revision;inputs=@{}} | ConvertTo-Json)
    }
    Write-CeaGeneratedFile (Join-Path $taskRoot "accepted-$taskIndex.json") ($taskAccepted | ConvertTo-Json -Depth 20)
    Write-Output "Trial $taskIndex (0=warmup): $($taskAccepted.executionId)"
    $taskDeadline = (Get-Date).AddMinutes(10)
    do {
        $taskExecution = Invoke-RestMethod "$taskApi/executions/$($taskAccepted.executionId)" -Headers $taskHeaders
        if ($taskExecution.state -in @('SUCCESS','FAILED','KILLED')) { break }
        if ((Get-Date) -gt $taskDeadline) { throw 'Execution still active; inspect accepted ID, do not resubmit.' }
        Start-Sleep -Seconds 3
    } while ($true)
    $taskTasks = Invoke-RestMethod "$taskApi/executions/$($taskExecution.id)/tasks" -Headers $taskHeaders
    $taskProfiles = @(); $taskReports = @()
    foreach ($taskTask in $taskTasks) {
        if (@($taskTask.outputs.PSObject.Properties | ForEach-Object Name) -contains 'compute-profile.json') {
            $taskProfiles += Invoke-RestMethod "$taskApi/executions/$($taskExecution.id)/tasks/$($taskTask.id)/output-json?port=compute-profile.json" -Headers $taskHeaders
            $taskReports += Invoke-RestMethod "$taskApi/executions/$($taskExecution.id)/tasks/$($taskTask.id)/output-json?port=cea-measurement.json" -Headers $taskHeaders
        }
    }
    $taskFusion = $taskTasks | Where-Object taskId -EQ 'fusion'
    $taskReport = if ($taskExecution.state -eq 'SUCCESS') { Invoke-RestMethod "$taskApi/executions/$($taskExecution.id)/tasks/$($taskFusion.id)/output-json?port=report.json" -Headers $taskHeaders } else { $null }
    $taskMeasurement = Invoke-RestMethod "$taskApi/executions/$($taskExecution.id)/measurement" -Headers $taskHeaders
    Write-CeaGeneratedFile $taskEvidence (@{execution=$taskExecution;tasks=$taskTasks;profiles=$taskProfiles;sdkReports=$taskReports;report=$taskReport;measurement=$taskMeasurement} | ConvertTo-Json -Depth 50)
    if ($taskExecution.state -ne 'SUCCESS') { throw "Trial failed: $($taskExecution.state); evidence preserved." }
    if ($taskProfiles.Count -ne 4) { throw 'Expected exactly four measured Application calls' }
    Write-Output "SUCCESS core=$($taskReport.metrics.computeGBps) GB/s union=$($taskReport.metrics.computeSeconds)s span=$($taskReport.metrics.computeSpanSeconds)s"
}
Write-Output 'One warmup and three formal trials recorded without replacing previous evidence.'
