param([switch]$Capture)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$taskSettings=Read-CeaSettings
$taskHeaders=Get-CeaHeaders $taskSettings
$taskApi="http://127.0.0.1:$($taskSettings.CEA_HTTP_PORT)/api/namespaces/lab"
if(-not $taskSettings.CEA_HTTP_PORT) { $taskApi='http://127.0.0.1:18080/api/namespaces/lab' }
$taskEvidence=Join-Path $taskRepository '.local/cea/ep02'
function Read-All([string]$Path) {
    $taskAll=[Collections.Generic.List[object]]::new()
    for($taskOffset=0;;$taskOffset+=100) {
        $taskPage=Invoke-RestMethod "$taskApi${Path}?limit=100&offset=$taskOffset" -Headers $taskHeaders -TimeoutSec 20
        foreach($taskRow in $taskPage) { $taskAll.Add($taskRow) }
        if($taskPage.Count -lt 100) { break }
    }
    return ,$taskAll.ToArray()
}
function Snapshot {
    $taskContainers=foreach($taskId in (docker ps -q --filter label=com.docker.compose.project=cea)) {
        $taskContainer=(docker inspect $taskId | ConvertFrom-Json)[0]
        [ordered]@{service=$taskContainer.Config.Labels.'com.docker.compose.service';id=$taskId;image=$taskContainer.Image;started=$taskContainer.State.StartedAt}
    }
    $taskFlows=Read-All '/flows'
    $taskPolicies=Read-All '/edge/policies'
    $taskExecutions=Read-All '/executions'
    if(@($taskExecutions | Where-Object state -NotIn @('SUCCESS','FAILED','KILLED','SKIPPED')).Count) { throw 'CEA contains active executions; do not release during work.' }
    $taskDefinitions=foreach($taskFlow in $taskFlows) { Invoke-RestMethod "$taskApi/flows/$($taskFlow.flowId)" -Headers $taskHeaders }
    $taskPolicyDefinitions=foreach($taskPolicy in $taskPolicies) { Invoke-RestMethod "$taskApi/edge/policies/$($taskPolicy.id)" -Headers $taskHeaders }
    return [ordered]@{containers=@($taskContainers | Sort-Object service);flows=@($taskDefinitions);policies=@($taskPolicyDefinitions);executions=@($taskExecutions);datasets=@(Read-All '/resources/datasets')}
}
$taskCurrent=Snapshot
if($Capture) {
    if(Test-Path (Join-Path $taskEvidence 'before.json')) { throw 'Baseline exists; refusing to overwrite release evidence.' }
    Write-CeaGeneratedFile (Join-Path $taskEvidence 'before.json') ($taskCurrent | ConvertTo-Json -Depth 100)
    foreach($taskService in @('backend','frontend')) {
        $taskImage=($taskCurrent.containers | Where-Object service -EQ $taskService).image
        docker tag $taskImage "cea/${taskService}:before-ep02"
        if($LASTEXITCODE) { throw 'Recovery image tag failed' }
    }
    "Captured CEA baseline: $($taskCurrent.executions.Count) executions; $($taskCurrent.containers.Count) services."
    exit
}
$taskBefore=Get-Content (Join-Path $taskEvidence 'before.json') -Raw | ConvertFrom-Json
foreach($taskField in @('flows','policies','executions','datasets')) {
    if(($taskBefore.$taskField | ConvertTo-Json -Depth 100 -Compress) -cne ($taskCurrent[$taskField] | ConvertTo-Json -Depth 100 -Compress)) { throw "Preservation check failed: $taskField" }
}
foreach($taskOld in $taskBefore.containers | Where-Object service -NotIn @('backend','frontend')) {
    $taskNow=$taskCurrent.containers | Where-Object service -EQ $taskOld.service
    if(-not $taskNow -or $taskNow.id -ne $taskOld.id -or $taskNow.image -ne $taskOld.image -or $taskNow.started -ne $taskOld.started) { throw "Unrelated service changed: $($taskOld.service)" }
}
$taskRecords=Read-All '/edge/processing-records'
$taskExpected=@($taskCurrent.executions | Where-Object flowId -In @($taskCurrent.policies | ForEach-Object {$_.policy.id}))
if(@($taskRecords).Count -ne $taskExpected.Count) { throw 'History count differs from existing policy executions' }
foreach($taskRecord in $taskRecords) {
    $taskOriginal=$taskExpected | Where-Object id -EQ $taskRecord.execution.id
    if(($taskOriginal | ConvertTo-Json -Depth 100 -Compress) -cne ($taskRecord.execution | ConvertTo-Json -Depth 100 -Compress)) { throw 'Execution projection changed original fields' }
    if($taskRecord.execution.flowId -in @('hydraulic-local','bearing-return','surface-cloud')) {
        if($taskRecord.origin.terminalId -ne 'ep01-terminal' -or $taskRecord.origin.gatewayId -ne 'ep01-gateway' -or $taskRecord.origin.clusterId -ne 'edge-a') { throw 'EP-01 origin differs' }
    }
    $taskFiltered=Invoke-RestMethod "$taskApi/edge/processing-records?policyId=$($taskRecord.execution.flowId)&state=$($taskRecord.execution.state)&limit=100" -Headers $taskHeaders
    if(@($taskFiltered | Where-Object {$_.execution.id -eq $taskRecord.execution.id}).Count -ne 1) { throw 'Filter omitted record' }
}
$taskHealth=Invoke-RestMethod "http://127.0.0.1:$($taskSettings.CEA_API_PORT)/health" -TimeoutSec 10
if($taskHealth.status -ne 'UP') { throw 'Backend unhealthy' }
Write-CeaGeneratedFile (Join-Path $taskEvidence 'after.json') (@{checkedAt=[DateTime]::UtcNow.ToString('o');snapshot=$taskCurrent;records=$taskRecords;health=$taskHealth;result='PASS'} | ConvertTo-Json -Depth 100)
"PASS: $($taskRecords.Count) real policy records, original flows/executions/datasets and unrelated services preserved."
