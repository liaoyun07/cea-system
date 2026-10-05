. (Join-Path $PSScriptRoot '../../deploy/cea/common.ps1')
$taskHeaders=Get-CeaHeaders (Read-CeaSettings)
$taskApi='http://127.0.0.1:18085/api/namespaces/lab'
$taskRoot=Join-Path $taskRepository '.local/cea/hc03'
$taskFlows=Invoke-RestMethod "$taskApi/flows?limit=100" -Headers $taskHeaders
if(@($taskFlows | Where-Object flowId -in @('hydraulic-central-compare','hydraulic-distributed-compare')).Count) { throw 'Comparison Flow exists; preserve revision, do not overwrite.' }
Write-CeaGeneratedFile (Join-Path $taskRoot 'before.json') (@{flows=$taskFlows;containers=@(& docker ps --format '{{.ID}} {{.Image}} {{.Names}}')} | ConvertTo-Json -Depth 40)
& docker run --rm cea/hydraulic-cloud-edge:hc03-v1 python -m unittest -v test_app test_compare
if($LASTEXITCODE -ne 0) { throw 'Comparison tests failed' }
& docker image save --output (Join-Path $taskRoot 'compare.tar') cea/hydraulic-cloud-edge:hc03-v1
if($LASTEXITCODE -ne 0) { throw 'Image export failed' }
Invoke-CeaCompose run --rm --no-deps image-tool --command-timeout=300s copy --dest-tls-verify=false --dest-authfile=/run/secrets/registry-auth.json docker-archive:/data/hc03/compare.tar docker://registry-center:5000/lab/hydraulic-cloud-edge:hc03-v1
# New keys only, in each already-authorized edge artifact bucket. No bucket/config/permission changes.
Invoke-CeaCompose run --rm --no-deps storage-tool -ec 'for e in edge-a edge-b edge-c; do mc alias set "$e" "http://minio-$e:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; mc cp "/data/hc01/full/$e.npz" "$e/cea-artifacts-$e/lab/hc03/raw/$e.npz"; mc stat --json "$e/cea-artifacts-$e/lab/hc03/raw/$e.npz"; done'
$taskContract=@{applicationId='hydraulic-compare';version='hc03-v1';image='registry-center:5000/lab/hydraulic-cloud-edge:hc03-v1';parameters=@{
    EDGE_GROUP=@{type='STRING';choices=@('edge-a','edge-b','edge-c')};Z_THRESHOLD=@{type='NUMBER';defaultValue=3}
}}
Invoke-RestMethod "$taskApi/applications/hydraulic-compare/versions/hc03-v1" -Method Put -Headers $taskHeaders -ContentType application/json -Body ($taskContract | ConvertTo-Json -Depth 20) | Out-Null
foreach($taskMode in @('central','distributed')) {
    $taskSource=Get-Content (Join-Path $PSScriptRoot "flow-$taskMode.yaml") -Raw
    $taskId="hydraulic-$taskMode-compare"
    Invoke-RestMethod "$taskApi/flows/$taskId/validate" -Method Post -Headers $taskHeaders -ContentType application/json -Body (@{source=$taskSource} | ConvertTo-Json) | Out-Null
    Invoke-RestMethod "$taskApi/flows/$taskId/revisions" -Method Post -Headers $taskHeaders -ContentType application/json -Body (@{source=$taskSource;expectedRevision=0} | ConvertTo-Json) | Out-Null
}
Write-Output 'Two HC-03 flows registered. Existing flows, data, resource configuration and services preserved.'
