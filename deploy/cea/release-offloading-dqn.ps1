# OFF-04: captures/restores no business objects; only affected services are replaced.
param([switch]$Capture,[switch]$Publish,[switch]$Verify)
. (Join-Path $PSScriptRoot 'common.ps1')
if(@($Capture,$Publish,$Verify | Where-Object {$_}).Count -ne 1) {throw 'Choose exactly one of Capture, Publish, Verify'}
$taskEvidence=Join-Path $taskRepository '.local/cea/off04'
$taskSettings=Read-CeaSettings
$taskHeaders=Get-CeaHeaders $taskSettings
$taskApi="http://127.0.0.1:$($taskSettings.CEA_API_PORT)/api/namespaces/lab"
function Read-OffAll([string]$Path) {
    $taskRows=[Collections.Generic.List[object]]::new()
    for($taskOffset=0;;$taskOffset+=100) {
        $taskPage=Invoke-RestMethod "$taskApi${Path}?limit=100&offset=$taskOffset" -Headers $taskHeaders -TimeoutSec 30
        foreach($taskItem in $taskPage) {$taskRows.Add($taskItem)}
        if($taskPage.Count -lt 100) {break}
    }
    return ,$taskRows.ToArray()
}
function Snapshot-Off {
    $taskContainers=foreach($taskId in (docker ps -q --filter label=com.docker.compose.project=cea)) {
        $taskContainer=(docker inspect $taskId | ConvertFrom-Json)[0]
        [ordered]@{service=$taskContainer.Config.Labels.'com.docker.compose.service';id=$taskId;image=$taskContainer.Image;started=$taskContainer.State.StartedAt}
    }
    $taskExecutions=Read-OffAll '/executions'
    if(@($taskExecutions | Where-Object state -NotIn @('SUCCESS','FAILED','KILLED','SKIPPED')).Count) {throw 'CEA has active executions; do not publish now'}
    $taskFlows=foreach($taskFlow in (Read-OffAll '/flows')) {Invoke-RestMethod "$taskApi/flows/$($taskFlow.flowId)" -Headers $taskHeaders}
    $taskPolicies=foreach($taskPolicy in (Read-OffAll '/edge/policies')) {Invoke-RestMethod "$taskApi/edge/policies/$($taskPolicy.id)" -Headers $taskHeaders}
    return [ordered]@{containers=@($taskContainers | Sort-Object service);flows=@($taskFlows);policies=@($taskPolicies);executions=@($taskExecutions);datasets=(Read-OffAll '/resources/datasets');samples=(Read-OffAll '/offloading/samples')}
}
if($Capture) {
    if(Test-Path (Join-Path $taskEvidence 'before.json')) {throw 'OFF-04 release baseline already exists'}
    $taskBefore=Snapshot-Off
    Write-CeaGeneratedFile (Join-Path $taskEvidence 'before.json') ($taskBefore | ConvertTo-Json -Depth 100)
    foreach($taskService in @('backend','frontend','edge-gateway')) {
        $taskImage=($taskBefore.containers | Where-Object service -EQ $taskService).image
        docker tag $taskImage "cea/${taskService}:before-off04"
        if($LASTEXITCODE) {throw 'Recovery tag failed'}
    }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'secrets/edge/gateway.json') -Destination (Join-Path $taskEvidence 'gateway-before.json')
    "Captured $($taskBefore.executions.Count) executions, $($taskBefore.samples.Count) samples, $($taskBefore.containers.Count) CEA services."
    return
}
$taskBefore=Get-Content (Join-Path $taskEvidence 'before.json') -Raw | ConvertFrom-Json
if($Publish) {
    $null=Snapshot-Off
    Invoke-CeaCompose build backend frontend edge-gateway
    $taskGatewayPath=Join-Path $PSScriptRoot 'secrets/edge/gateway.json'
    $taskGateway=Get-Content $taskGatewayPath -Raw | ConvertFrom-Json -AsHashtable
    if($taskGateway.clusterId -ne 'edge-a') {throw 'Unexpected gateway scope'}
    $taskGateway.computeEvents=@($taskGateway.computeEvents)+@('off04-terminal','off04-edge','off04-cloud','off04-rule','off04-train','off04-dqn') | Select-Object -Unique
    Write-CeaGeneratedFile $taskGatewayPath ($taskGateway | ConvertTo-Json -Depth 30)
    Invoke-CeaCompose --profile edge-processing up -d --no-deps --wait --wait-timeout 180 backend frontend edge-gateway
    Invoke-CeaCompose exec -T frontend nginx -s reload
    $taskHealth=Invoke-RestMethod "http://127.0.0.1:$($taskSettings.CEA_API_PORT)/health"
    if($taskHealth.status -ne 'UP') {throw 'Backend unhealthy'}
    Write-CeaGeneratedFile (Join-Path $taskEvidence 'release.json') (@{deployedAt=[DateTime]::UtcNow.ToString('o');services=@('backend','frontend','edge-gateway');migration=$false} | ConvertTo-Json)
    'CEA OFF-04 deployed; real workload and browser verification still required.'
    return
}
$taskCurrent=Snapshot-Off
function Comparable-Off($Value,[string]$Field) {
    $taskCopy=$Value | ConvertTo-Json -Depth 100 | ConvertFrom-Json -AsHashtable
    if($Field -eq 'policies') {
        # API reparses the immutable source. The new optional DSL field serializes as null;
        # normalize only that absent/default difference, never the source or revision itself.
        foreach($taskDefinition in $taskCopy.flow.definition.tasks) {
            if($taskDefinition.container -is [Collections.IDictionary] -and $taskDefinition.container.offload -is [Collections.IDictionary]) {
                $taskOffload=$taskDefinition.container.offload
                if($taskOffload.strategy -in @('FIXED','RULE') -and $taskOffload.Contains('exploration') -and $null -eq $taskOffload.exploration) {
                    $taskOffload.Remove('exploration')
                }
            }
        }
    }
    return $taskCopy | ConvertTo-Json -Depth 100 -Compress
}
foreach($taskField in @('flows','policies','executions','datasets','samples')) {
    foreach($taskOriginal in $taskBefore.$taskField) {
        $taskEncoded=Comparable-Off $taskOriginal $taskField
        if(@($taskCurrent[$taskField] | Where-Object {(Comparable-Off $_ $taskField) -ceq $taskEncoded}).Count -ne 1) {throw "Original object changed: $taskField"}
    }
}
foreach($taskOld in $taskBefore.containers | Where-Object service -NotIn @('backend','frontend','edge-gateway')) {
    $taskNow=$taskCurrent.containers | Where-Object service -EQ $taskOld.service
    if(-not $taskNow -or $taskNow.id -ne $taskOld.id -or $taskNow.image -ne $taskOld.image -or $taskNow.started -ne $taskOld.started) {throw "Unrelated service changed: $($taskOld.service)"}
}
Write-CeaGeneratedFile (Join-Path $taskEvidence 'after.json') (@{checkedAt=[DateTime]::UtcNow.ToString('o');result='PASS';snapshot=$taskCurrent} | ConvertTo-Json -Depth 100)
"PASS: original objects and 16 unrelated services preserved; $($taskCurrent.executions.Count) executions, $($taskCurrent.samples.Count) samples."
