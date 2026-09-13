# Read-only check: original history, user Flows and unrelated service identities must remain unchanged.
. (Join-Path $PSScriptRoot '../../deploy/cea/common.ps1')
$taskRoot = Join-Path $taskRepository '.local/cea/edge-processing'
$taskBefore = Get-Content (Join-Path $taskRoot 'before.json') -Raw | ConvertFrom-Json
$taskHeaders = Get-CeaHeaders (Read-CeaSettings)
$taskApi = 'http://127.0.0.1:18080/api/namespaces/lab'
foreach ($taskService in $taskBefore.containers.PSObject.Properties) {
    if ($taskService.Name -eq 'backend') { continue }
    $taskId = (Invoke-CeaCompose ps -q $taskService.Name).Trim()
    $taskNow = (& docker inspect $taskId | ConvertFrom-Json)[0]
    if ($taskId -ne $taskService.Value.id -or $taskNow.Image -ne $taskService.Value.image -or $taskNow.State.StartedAt -ne $taskService.Value.started) {
        throw "Unexpected change to service $($taskService.Name)"
    }
}
$taskFlows = Invoke-RestMethod "$taskApi/flows?limit=100" -Headers $taskHeaders
if (($taskFlows | ConvertTo-Json -Depth 40 -Compress) -ne ($taskBefore.flows | ConvertTo-Json -Depth 40 -Compress)) { throw 'Original user Flows changed' }
foreach ($taskPrior in $taskBefore.executions) {
    $taskNow = Invoke-RestMethod "$taskApi/executions/$($taskPrior.id)" -Headers $taskHeaders
    if (($taskNow | ConvertTo-Json -Depth 40 -Compress) -ne ($taskPrior | ConvertTo-Json -Depth 40 -Compress)) { throw "Historical execution changed: $($taskPrior.id)" }
}
$taskPolicies = Invoke-RestMethod "$taskApi/edge/policies?limit=100" -Headers $taskHeaders
if (@($taskPolicies | Where-Object id -In @('hydraulic-local','bearing-return','surface-cloud')).Count -ne 3) { throw 'Missing deployed example policies' }
$taskAfter = @{policies=$taskPolicies;health=(Invoke-RestMethod http://127.0.0.1:18085/health);gateway=(Invoke-RestMethod http://127.0.0.1:18086/health);
    userFlowsPreserved=$true;historicalExecutionsPreserved=@($taskBefore.executions).Count;unrelatedServicesPreserved=$true;checkedAt=(Get-Date -Format o)}
Write-CeaGeneratedFile (Join-Path $taskRoot 'release.json') ($taskAfter | ConvertTo-Json -Depth 20)
Write-Output 'PASS: live frontend API, gateway, original user Flows/history and all unrelated services preserved.'
