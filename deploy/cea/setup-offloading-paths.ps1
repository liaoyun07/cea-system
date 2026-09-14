# OFF-02 only. Run after tests; uses existing CEA, never initializes or seeds the old system.
param([switch]$Publish)
. (Join-Path $PSScriptRoot 'common.ps1')
$taskSettings=Read-CeaSettings
$taskRoot=Join-Path $taskRepository '.local/cea/off02'
$taskPending=Join-Path $taskRoot 'pending'
$taskGatewayPath=Join-Path $PSScriptRoot 'secrets/edge/gateway.json'
$taskGateway=Get-Content $taskGatewayPath -Raw | ConvertFrom-Json -AsHashtable
if($taskGateway.clusterId -ne 'edge-a' -or -not $taskGateway.terminals.ContainsKey('ep01-terminal')) { throw 'Expected existing edge-a gateway and ep01-terminal' }
function New-OffToken { [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant() }
if(-not(Test-Path (Join-Path $taskPending 'control-token'))) {
    Write-CeaGeneratedFile (Join-Path $taskPending 'control-token') (New-OffToken)
    Write-CeaGeneratedFile (Join-Path $taskPending 'agent-token') (New-OffToken)
}
$taskControl=Get-Content (Join-Path $taskPending 'control-token') -Raw
$taskAgentToken=Get-Content (Join-Path $taskPending 'agent-token') -Raw
$taskGateway['controlToken']=$taskControl
$taskGateway['computeEvents']=@('offload-terminal','offload-edge','offload-cloud','offload-rule')
$taskGateway['agents']=@{'ep01-terminal'=@{endpoint='http://terminal-agent:8080';token=$taskAgentToken}}
Write-CeaGeneratedFile (Join-Path $taskPending 'gateway.json') ($taskGateway | ConvertTo-Json -Depth 15)
$taskTransfer=Get-Content (Join-Path $PSScriptRoot 'secrets/backend/storage-endpoints.yaml') -Raw | ConvertFrom-Json -AsHashtable
$taskHosts=@($taskTransfer.platform.jobs.storage.lab.stores.Values | ForEach-Object {([uri]$_['transfer-endpoint']).Authority})
$taskAgent=@{token=$taskAgentToken;dockerHost='unix:///run/cea-terminal/docker.sock';registryHosts=@('registry-edge-a:5000');
    registryAuth=@{'registry-edge-a:5000'=@{username=$taskSettings.REGISTRY_USER;password=$taskSettings.REGISTRY_PASSWORD}};storageHosts=$taskHosts}
Write-CeaGeneratedFile (Join-Path $taskPending 'agent.json') ($taskAgent | ConvertTo-Json -Depth 10)
$taskConnection=@{platform=@{jobs=@{terminals=@{lab=@{'ep01-terminal'=@{slots=1;gateway=@{endpoint='http://edge-gateway:8080';tokenFile='/run/secrets/terminal-control-token'}}}}}}}
Write-CeaGeneratedFile (Join-Path $taskPending 'terminal-gateway.yaml') ($taskConnection | ConvertTo-Json -Depth 15)
if(-not(Test-Path (Join-Path $taskRoot 'signal-manifest.json'))) {
    [IO.Directory]::CreateDirectory((Join-Path $taskRoot 'terminal')) | Out-Null
    & docker run --rm --network none -v "${taskRoot}:/output" -v "${taskRepository}/examples/offloading:/source:ro" python:3.11.15-slim python /source/prepare.py --output /output/terminal
    if($LASTEXITCODE) { throw 'Prepare terminal signal failed' }
}
[IO.Directory]::CreateDirectory((Join-Path $taskRoot 'receipts')) | Out-Null
if(-not $Publish) { 'OFF-02 private pending configuration and synthetic terminal signal prepared. No CEA services changed.'; return }
if(-not(Test-Path (Join-Path $taskRoot 'before.json'))) { throw 'Capture CEA baseline and recovery images before publishing' }
$taskHeaders=Get-CeaHeaders $taskSettings
$taskApi="http://127.0.0.1:$($taskSettings.CEA_API_PORT)/api/namespaces/lab"
$taskActive=Invoke-RestMethod "$taskApi/executions?limit=100" -Headers $taskHeaders
if(@($taskActive | Where-Object state -NotIn @('SUCCESS','FAILED','KILLED','SKIPPED')).Count) { throw 'Wait for active executions before release' }
if(-not(Test-Path (Join-Path $taskRoot 'gateway-before.json'))) {
    Copy-Item -LiteralPath $taskGatewayPath -Destination (Join-Path $taskRoot 'gateway-before.json')
}
foreach($taskCopy in @(
    @('gateway.json','secrets/edge/gateway.json'),@('agent.json','secrets/terminal/agent.json'),
    @('terminal-gateway.yaml','secrets/backend/terminal-gateway.yaml'),@('control-token','secrets/backend/terminal-control-token'))) {
    Write-CeaGeneratedFile (Join-Path $PSScriptRoot $taskCopy[1]) (Get-Content (Join-Path $taskPending $taskCopy[0]) -Raw)
}
& docker build -f (Join-Path $taskRepository 'examples/offloading/Dockerfile') -t cea/offload-signal:off02-v1 $taskRepository
if($LASTEXITCODE) { throw 'Signal image build failed' }
& docker image save --output (Join-Path $taskRoot 'signal-image.tar') cea/offload-signal:off02-v1
if($LASTEXITCODE) { throw 'Image archive failed' }
Invoke-CeaCompose run --rm --no-deps image-tool copy --dest-tls-verify=false --dest-authfile=/run/secrets/registry-auth.json docker-archive:/data/off02/signal-image.tar docker://registry-center:5000/lab/offload-signal:off02-v1
$taskDigest=(Invoke-CeaCompose run --rm --no-deps image-tool inspect --tls-verify=false --authfile=/run/secrets/registry-auth.json --format '{{.Digest}}' docker://registry-center:5000/lab/offload-signal:off02-v1).Trim()
if($taskDigest -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Invalid signal digest' }
Invoke-CeaCompose --profile edge-processing --profile terminal-offloading up -d --no-deps --wait --wait-timeout 180 terminal-engine terminal-agent edge-gateway backend
Invoke-CeaCompose exec -T frontend nginx -s reload
function Put-OffJson($Path,$Value) {
    Invoke-RestMethod -Method Put -Uri "$taskApi/$Path" -Headers $taskHeaders -ContentType 'application/json; charset=utf-8' -Body ($Value | ConvertTo-Json -Depth 40) | Out-Null
}
Put-OffJson 'applications/offload-signal/versions/off02-v1' @{applicationId='offload-signal';version='off02-v1';image="registry-center:5000/lab/offload-signal@$taskDigest";parameters=@{}}
foreach($taskLayer in @('TERMINAL','EDGE','CLOUD','RULE')) {
    $taskId='offload-'+$taskLayer.ToLowerInvariant()
    $taskOffload=if($taskLayer -eq 'RULE') {[ordered]@{strategy='RULE'}} else {[ordered]@{strategy='FIXED';layer=$taskLayer}}
    $taskFlow=[ordered]@{schemaVersion=1;namespace='lab';id=$taskId;description="OFF-02 振动窗口特征：$taskLayer（三路径验证，合成信号）";
        inputs=[ordered]@{data_file=[ordered]@{type='OBJECT';required=$true}};
        tasks=@([ordered]@{id='features';type='platform.Application';timeout='PT2M';container=[ordered]@{applicationId='offload-signal';version='off02-v1';execution='TERMINAL';offload=$taskOffload;
            command=@('python','/app/app.py');inputFiles=[ordered]@{'signal.csv'=[ordered]@{source='INPUT';name='data_file'}};outputFiles=@('result.json','cea-measurement.json')}});
        outputs=[ordered]@{terminal_result=[ordered]@{source='TASK_OUTPUT';taskId='features';port='result.json'}}}
    $taskSource=$taskFlow | ConvertTo-Json -Depth 30
    $taskExisting=Invoke-RestMethod "$taskApi/edge/policies?limit=100" -Headers $taskHeaders
    if(@($taskExisting | Where-Object id -EQ $taskId).Count) {
        $taskSaved=Invoke-RestMethod "$taskApi/edge/policies/$taskId" -Headers $taskHeaders
        if($taskSaved.flow.source -cne $taskSource) { throw "Existing $taskId differs; do not overwrite" }
        continue
    }
    Put-OffJson "edge/policies/$taskId" @{clusterId='edge-a';eventType=$taskId;enabled=$true;expectedRevision=0;source=$taskSource}
}
Write-CeaGeneratedFile (Join-Path $taskRoot 'release.json') (@{deployedAt=[DateTime]::UtcNow.ToString('o');imageDigest=$taskDigest;policies=@('offload-terminal','offload-edge','offload-cloud','offload-rule')} | ConvertTo-Json)
'OFF-02 services and four new policies deployed. Run the terminal client and verify real outputs/storage before declaring PASS.'
