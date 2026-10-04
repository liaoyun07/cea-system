# HC-02 updates only this demo's Applications and Flow. No service restart or quota change.
. (Join-Path $PSScriptRoot '../../deploy/cea/common.ps1')
$taskHeaders = Get-CeaHeaders (Read-CeaSettings)
$taskApi = 'http://127.0.0.1:18085/api/namespaces/lab'
$taskPrior = Invoke-RestMethod "$taskApi/flows/hydraulic-cloud-edge" -Headers $taskHeaders
if ($taskPrior.revision -ne 2) { throw 'Expected HC-01 r2. Do not replace another edit.' }
$taskRoot = Join-Path $taskRepository '.local/cea/hc02'
$taskBefore = @{flow=$taskPrior;flows=(Invoke-RestMethod "$taskApi/flows?limit=100" -Headers $taskHeaders);containers=@(& docker ps --format '{{.ID}} {{.Image}} {{.Names}}')}
Write-CeaGeneratedFile (Join-Path $taskRoot 'before.json') ($taskBefore | ConvertTo-Json -Depth 40)
& docker run --rm cea/hydraulic-cloud-edge:hc02-v1 python -m unittest -v test_app
if ($LASTEXITCODE -ne 0) { throw 'Native algorithm tests failed' }
& docker image save --output (Join-Path $taskRoot 'native.tar') cea/hydraulic-cloud-edge:hc02-v1
if ($LASTEXITCODE -ne 0) { throw 'Native image export failed' }
Invoke-CeaCompose run --rm --no-deps image-tool --command-timeout=300s copy --dest-tls-verify=false --dest-authfile=/run/secrets/registry-auth.json docker-archive:/data/hc02/native.tar docker://registry-center:5000/lab/hydraulic-cloud-edge:hc02-v1
foreach ($taskFile in @('edge-contract.json','fusion-contract.json')) {
    $taskContract = Get-Content (Join-Path $PSScriptRoot $taskFile) -Raw | ConvertFrom-Json
    $taskContract.version = 'hc02-v1'
    $taskContract.image = 'registry-center:5000/lab/hydraulic-cloud-edge:hc02-v1'
    Invoke-RestMethod "$taskApi/applications/$($taskContract.applicationId)/versions/hc02-v1" -Method Put -Headers $taskHeaders -ContentType application/json -Body ($taskContract | ConvertTo-Json -Depth 30) | Out-Null
}
$taskSource = Get-Content (Join-Path $PSScriptRoot 'flow-native.yaml') -Raw
Invoke-RestMethod "$taskApi/flows/hydraulic-cloud-edge/validate" -Method Post -Headers $taskHeaders -ContentType application/json -Body (@{source=$taskSource} | ConvertTo-Json) | Out-Null
Invoke-RestMethod "$taskApi/flows/hydraulic-cloud-edge/revisions" -Method Post -Headers $taskHeaders -ContentType application/json -Body (@{source=$taskSource;expectedRevision=2} | ConvertTo-Json) | Out-Null
Write-Output 'HC-02 r3 registered. r2, data, resources, metrics and all existing services preserved.'
