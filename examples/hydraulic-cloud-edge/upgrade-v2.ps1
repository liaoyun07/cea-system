# Explicit HC-01 first numerical optimization; preserve r1 and all v1 Applications.
. (Join-Path $PSScriptRoot '../../deploy/cea/common.ps1')
$taskHeaders = Get-CeaHeaders (Read-CeaSettings)
$taskApi = 'http://127.0.0.1:18085/api/namespaces/lab'
$taskPrior = Invoke-RestMethod "$taskApi/flows/hydraulic-cloud-edge" -Headers $taskHeaders
if ($taskPrior.revision -ne 1) { throw 'Expected original HC-01 r1; do not overwrite another edit.' }
& docker run --rm cea/hydraulic-cloud-edge:hc01-v2 python -m unittest -v test_app
if ($LASTEXITCODE -ne 0) { throw 'Algorithm tests failed' }
& docker image save --output (Join-Path $taskRepository '.local/cea/hc01/hydraulic-v2.tar') cea/hydraulic-cloud-edge:hc01-v2
if ($LASTEXITCODE -ne 0) { throw 'Export failed' }
Invoke-CeaCompose run --rm --no-deps image-tool --command-timeout=300s copy --dest-tls-verify=false --dest-authfile=/run/secrets/registry-auth.json docker-archive:/data/hc01/hydraulic-v2.tar docker://registry-center:5000/lab/hydraulic-cloud-edge:hc01-v2
foreach ($taskFile in @('edge-contract.json','fusion-contract.json')) {
    $taskContract = Get-Content (Join-Path $PSScriptRoot $taskFile) -Raw | ConvertFrom-Json
    $taskContract.image = 'registry-center:5000/lab/hydraulic-cloud-edge:hc01-v2'
    Invoke-RestMethod "$taskApi/applications/$($taskContract.applicationId)/versions/hc01-v2" -Method Put -Headers $taskHeaders -ContentType application/json -Body ($taskContract | ConvertTo-Json -Depth 30) | Out-Null
}
$taskSource = Get-Content (Join-Path $PSScriptRoot 'flow.yaml') -Raw
$taskBody = @{source=$taskSource;expectedRevision=1} | ConvertTo-Json -Depth 10
Invoke-RestMethod "$taskApi/flows/hydraulic-cloud-edge/validate" -Method Post -Headers $taskHeaders -ContentType application/json -Body (@{source=$taskSource} | ConvertTo-Json) | Out-Null
Invoke-RestMethod "$taskApi/flows/hydraulic-cloud-edge/revisions" -Method Post -Headers $taskHeaders -ContentType application/json -Body $taskBody | Out-Null
Write-Output 'HC-01 r2 registered; same datasets, native channels, threshold, compute interval and system resources.'
