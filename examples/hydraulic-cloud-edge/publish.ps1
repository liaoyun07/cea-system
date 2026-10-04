# Add only the HC-01 image, datasets, Applications and Flow. Never reseed existing business data.
. (Join-Path $PSScriptRoot '../../deploy/cea/common.ps1')
$taskSettings = Read-CeaSettings
$taskHeaders = Get-CeaHeaders $taskSettings
$taskApi = "http://127.0.0.1:$($taskSettings.CEA_API_PORT)/api/namespaces/lab"
$taskRoot = Join-Path $taskRepository '.local/cea/hc01'
$taskFlows = Invoke-RestMethod "$taskApi/flows?limit=100" -Headers $taskHeaders
if (@($taskFlows | Where-Object flowId -EQ 'hydraulic-cloud-edge').Count) { throw 'HC-01 already exists; do not replace its revision implicitly.' }
$taskBefore = @{flows=$taskFlows;containers=@(& docker ps --format '{{.ID}} {{.Image}} {{.Names}}')}
Write-CeaGeneratedFile (Join-Path $taskRoot 'before.json') ($taskBefore | ConvertTo-Json -Depth 40)
& docker run --rm cea/hydraulic-cloud-edge:hc01-v2 python -m unittest -v test_app
if ($LASTEXITCODE -ne 0) { throw 'Algorithm tests failed' }
& docker image save --output (Join-Path $taskRoot 'hydraulic.tar') cea/hydraulic-cloud-edge:hc01-v2
if ($LASTEXITCODE -ne 0) { throw 'Image export failed' }
Invoke-CeaCompose run --rm --no-deps image-tool --command-timeout=300s copy --dest-tls-verify=false --dest-authfile=/run/secrets/registry-auth.json docker-archive:/data/hc01/hydraulic.tar docker://registry-center:5000/lab/hydraulic-cloud-edge:hc01-v2
Invoke-CeaCompose run --rm --no-deps storage-tool -ec 'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; for f in reference edge-a edge-b edge-c; do mc cp "/data/hc01/full/$f.npz" "local/datasets/hydraulic/hc01-v1/$f.npz"; done'
function Send-Hydraulic($Method, $Path, $Body) {
    Invoke-RestMethod -Method $Method -Uri "$taskApi/$Path" -Headers $taskHeaders -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 30) | Out-Null
}
$taskSignals = @{datasetId='hydraulic-signals';version='hc01-v1';format='npz';locations=@(
    foreach ($taskEdge in @('edge-a','edge-b','edge-c')) { @{clusterId=$taskEdge;uri="s3://datasets/hydraulic/hc01-v1/$taskEdge.npz"} }
)}
Send-Hydraulic Put 'resources/datasets/hydraulic-signals/versions/hc01-v1' $taskSignals
Send-Hydraulic Put 'resources/datasets/hydraulic-reference/versions/hc01-v1' @{datasetId='hydraulic-reference';version='hc01-v1';format='npz';locations=@(@{clusterId='cloud';uri='s3://datasets/hydraulic/hc01-v1/reference.npz'})}
foreach ($taskFile in @('edge-contract.json','fusion-contract.json')) {
    $taskContract = Get-Content (Join-Path $PSScriptRoot $taskFile) -Raw | ConvertFrom-Json
    $taskContract.image = 'registry-center:5000/lab/hydraulic-cloud-edge:hc01-v2'
    Send-Hydraulic Put "applications/$($taskContract.applicationId)/versions/$($taskContract.version)" $taskContract
}
$taskSource = Get-Content (Join-Path $PSScriptRoot 'flow.yaml') -Raw
Send-Hydraulic Post 'flows/hydraulic-cloud-edge/validate' @{source=$taskSource}
Send-Hydraulic Post 'flows/hydraulic-cloud-edge/revisions' @{expectedRevision=0;source=$taskSource}
Write-Output 'HC-01 registered. Existing services not restarted; no executions submitted.'
