. (Join-Path $PSScriptRoot '../../deploy/cea/common.ps1')
$taskHeaders=Get-CeaHeaders (Read-CeaSettings)
$taskApi='http://127.0.0.1:18085/api/namespaces/lab'
$taskRoot=Join-Path $taskRepository '.local/cea/hc04'
$taskFlows=Invoke-RestMethod "$taskApi/flows?limit=100" -Headers $taskHeaders
if(@($taskFlows | Where-Object flowId -Match '^hydraulic-(central|distributed)-repeat(1|5|10)$').Count) {throw 'Repeat Flow exists; preserve it.'}
Write-CeaGeneratedFile (Join-Path $taskRoot 'before.json') (@{flows=$taskFlows;containers=@(& docker ps --format '{{.ID}} {{.Image}} {{.Names}}')} | ConvertTo-Json -Depth 40)
& docker run --rm cea/hydraulic-cloud-edge:hc04-v1 python -m unittest -v test_app test_compare test_repeat
if($LASTEXITCODE -ne 0){throw 'Repeat tests failed'}
& docker image save --output (Join-Path $taskRoot 'repeat.tar') cea/hydraulic-cloud-edge:hc04-v1
if($LASTEXITCODE -ne 0){throw 'Image export failed'}
Invoke-CeaCompose run --rm --no-deps image-tool --command-timeout=300s copy --dest-tls-verify=false --dest-authfile=/run/secrets/registry-auth.json docker-archive:/data/hc04/repeat.tar docker://registry-center:5000/lab/hydraulic-cloud-edge:hc04-v1
$taskContract=@{applicationId='hydraulic-compare';version='hc04-v1';image='registry-center:5000/lab/hydraulic-cloud-edge:hc04-v1';parameters=@{
    EDGE_GROUP=@{type='STRING';choices=@('edge-a','edge-b','edge-c')};Z_THRESHOLD=@{type='NUMBER';defaultValue=3}
}}
Invoke-RestMethod "$taskApi/applications/hydraulic-compare/versions/hc04-v1" -Method Put -Headers $taskHeaders -ContentType application/json -Body ($taskContract | ConvertTo-Json -Depth 20) | Out-Null
$taskReferenceContract=@{applicationId='hydraulic-compare';version='hc04-reference-v1';image=$taskContract.image;parameters=@{
    Z_THRESHOLD=@{type='NUMBER';defaultValue=3};REFERENCE=@{type='STRING';required=$true;dataset=@{format='npz';allowed=@(@{datasetId='hydraulic-reference';version='hc01-v1'})}}
}}
Invoke-RestMethod "$taskApi/applications/hydraulic-compare/versions/hc04-reference-v1" -Method Put -Headers $taskHeaders -ContentType application/json -Body ($taskReferenceContract | ConvertTo-Json -Depth 20) | Out-Null
foreach($taskPasses in @(1,5,10)) {foreach($taskMode in @('central','distributed')) {
    $taskSource=Get-Content (Join-Path $PSScriptRoot "flow-repeat-$taskMode-$taskPasses.yaml") -Raw
    $taskId="hydraulic-$taskMode-repeat$taskPasses"
    Invoke-RestMethod "$taskApi/flows/$taskId/validate" -Method Post -Headers $taskHeaders -ContentType application/json -Body (@{source=$taskSource} | ConvertTo-Json) | Out-Null
    Invoke-RestMethod "$taskApi/flows/$taskId/revisions" -Method Post -Headers $taskHeaders -ContentType application/json -Body (@{source=$taskSource;expectedRevision=0} | ConvertTo-Json) | Out-Null
}}
Write-Output 'Six isolated repeat flows published; old flows/images/data/resources retained.'
