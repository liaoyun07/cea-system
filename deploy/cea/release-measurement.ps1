# MET-001 release: immutable application versions and explicit Flow revisions; no database migration.
param([ValidateSet('Capture','Publish','Verify')][string]$Mode)
. (Join-Path $PSScriptRoot 'common.ps1')
$taskEvidence=Join-Path $taskRepository '.local/cea/met01'
$taskSettings=Read-CeaSettings
$taskHeaders=Get-CeaHeaders $taskSettings
$taskApi="http://127.0.0.1:$($taskSettings.CEA_API_PORT)/api/namespaces/lab"
function Read-MetAll([string]$Path) {
    $taskRows=[Collections.Generic.List[object]]::new()
    for($taskOffset=0;;$taskOffset+=100) {
        $taskPage=Invoke-RestMethod "$taskApi${Path}?limit=100&offset=$taskOffset" -Headers $taskHeaders -TimeoutSec 30
        foreach($taskRow in $taskPage) {$taskRows.Add($taskRow)}
        if($taskPage.Count -lt 100) {break}
    }
    return ,$taskRows.ToArray()
}
function Snapshot-Met {
    $taskContainers=foreach($taskId in (docker ps -q --filter label=com.docker.compose.project=cea)) {
        $taskContainer=(docker inspect $taskId | ConvertFrom-Json)[0]
        [ordered]@{service=$taskContainer.Config.Labels.'com.docker.compose.service';id=$taskId;image=$taskContainer.Image;started=$taskContainer.State.StartedAt}
    }
    $taskExecutions=Read-MetAll '/executions'
    if(@($taskExecutions | Where-Object state -NotIn @('SUCCESS','FAILED','KILLED','SKIPPED')).Count) {throw 'Active CEA executions; do not publish'}
    $taskFlows=foreach($taskFlow in (Read-MetAll '/flows')) {Invoke-RestMethod "$taskApi/flows/$($taskFlow.flowId)" -Headers $taskHeaders}
    $taskPolicies=foreach($taskPolicy in (Read-MetAll '/edge/policies')) {Invoke-RestMethod "$taskApi/edge/policies/$($taskPolicy.id)" -Headers $taskHeaders}
    [ordered]@{containers=@($taskContainers);flows=@($taskFlows);policies=@($taskPolicies);executions=$taskExecutions;datasets=(Read-MetAll '/resources/datasets');samples=(Read-MetAll '/offloading/samples')}
}
if($Mode -eq 'Capture') {
    if(Test-Path (Join-Path $taskEvidence 'before.json')) {throw 'Release baseline already exists'}
    $taskBefore=Snapshot-Met
    $taskClocks=foreach($taskService in @('backend','cloud','edge-a','edge-b','edge-c','terminal-engine')) {
        $taskBoot=docker exec "cea-$taskService-1" cat /proc/sys/kernel/random/boot_id
        if($LASTEXITCODE) {throw 'Cannot verify shared host clock'}
        @{service=$taskService;bootId=($taskBoot -join '').Trim()}
    }
    if(@($taskClocks.bootId | Select-Object -Unique).Count -ne 1) {throw 'Different kernels: verify NTP before enabling measurement'}
    Write-CeaGeneratedFile (Join-Path $taskEvidence 'clocks.json') ($taskClocks | ConvertTo-Json)
    Write-CeaGeneratedFile (Join-Path $taskEvidence 'before.json') ($taskBefore | ConvertTo-Json -Depth 100)
    foreach($taskService in @('backend','frontend')) {
        docker tag ($taskBefore.containers | Where-Object service -EQ $taskService).image "cea/${taskService}:before-met01"
        if($LASTEXITCODE) {throw 'Recovery tag failed'}
    }
    "Captured $($taskBefore.executions.Count) executions, $($taskBefore.containers.Count) services; shared host clock verified."
    return
}
$taskBefore=Get-Content (Join-Path $taskEvidence 'before.json') -Raw | ConvertFrom-Json
if($Mode -eq 'Publish') {
    $null=Snapshot-Met
    foreach($taskName in @('federated','edge-processing','offload-signal')) {
        $taskArchive=Join-Path $taskEvidence "$taskName.tar"
        docker image save -o $taskArchive "cea/${taskName}:met01-v1"
        if($LASTEXITCODE) {throw 'Algorithm image export failed'}
        Invoke-CeaCompose run --rm --no-deps image-tool --command-timeout=300s copy --dest-tls-verify=false --dest-authfile=/run/secrets/registry-auth.json "docker-archive:/data/met01/$taskName.tar" "docker://registry-center:5000/lab/${taskName}:met01-v1"
    }
    Invoke-CeaCompose build backend frontend
    Invoke-CeaCompose up -d --no-deps --wait --wait-timeout 180 backend frontend
    Invoke-CeaCompose exec -T frontend nginx -s reload
    if((Invoke-RestMethod "http://127.0.0.1:$($taskSettings.CEA_API_PORT)/health").status -ne 'UP') {throw 'Backend unhealthy'}
    Write-CeaGeneratedFile (Join-Path $taskEvidence 'release.json') (@{deployedAt=[DateTime]::UtcNow.ToString('o');services=@('backend','frontend');migration=$false} | ConvertTo-Json)
    'Published frontend/backend and three algorithm images; catalog upgrade and real runs remain.'
    return
}
$taskNow=Snapshot-Met
foreach($taskField in @('executions','datasets','samples')) {
    foreach($taskOriginal in $taskBefore.$taskField) {
        $taskEncoded=$taskOriginal | ConvertTo-Json -Depth 100 -Compress
        if(@($taskNow[$taskField] | Where-Object {($_ | ConvertTo-Json -Depth 100 -Compress) -ceq $taskEncoded}).Count -ne 1) {throw "Original object changed: $taskField"}
    }
}
foreach($taskOld in $taskBefore.containers | Where-Object service -NotIn @('backend','frontend')) {
    $taskCurrent=$taskNow.containers | Where-Object service -EQ $taskOld.service
    if($taskCurrent.id -ne $taskOld.id -or $taskCurrent.image -ne $taskOld.image -or $taskCurrent.started -ne $taskOld.started) {throw "Unrelated service changed: $($taskOld.service)"}
}
Write-CeaGeneratedFile (Join-Path $taskEvidence 'after.json') (@{checkedAt=[DateTime]::UtcNow.ToString('o');snapshot=$taskNow;result='PASS'} | ConvertTo-Json -Depth 100)
"PASS: original executions/datasets/samples and $(@($taskBefore.containers).Count-2) unrelated services preserved."
