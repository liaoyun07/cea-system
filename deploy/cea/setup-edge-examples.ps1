# Run after offline data/model preparation and tests. Scoped to CEA EP-01.
param([switch]$Publish)
. (Join-Path $PSScriptRoot 'common.ps1')
$taskSettings = Read-CeaSettings
$taskEdgeRoot = Join-Path $taskRepository '.local/cea/edge-processing'
$taskSecretRoot = Join-Path $PSScriptRoot 'secrets/edge'
$taskBackendConfig = Join-Path $PSScriptRoot 'secrets/backend/edge-access.yaml'
foreach ($taskFile in @('models/bearing.joblib','models/tile.pt','terminal/hydraulic.npz','terminal/bearing.npz','terminal/surface.zip')) {
    if (-not (Test-Path (Join-Path $taskEdgeRoot $taskFile))) { throw "Missing prepared sample: $taskFile" }
}
if (-not (Test-Path (Join-Path $taskSecretRoot 'gateway.json'))) {
    function New-EdgeToken { return [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant() }
    $taskGateway = @{namespace='lab';clusterId='edge-a';backend='http://backend:18085';backendUser='ep01-gateway';backendPassword=(New-EdgeToken);
        storageEndpoint='http://minio-edge-a:9000';storageUser='cea-ep01-gateway';storagePassword=(New-EdgeToken);
        bucket='cea-artifacts-edge-a';terminals=@{'ep01-terminal'=(New-EdgeToken);'ep01-other'=(New-EdgeToken)};
        events=@('hydraulic-window','bearing-window','surface-batch')}
    Write-CeaGeneratedFile (Join-Path $taskSecretRoot 'gateway.json') ($taskGateway | ConvertTo-Json -Depth 8)
    Write-CeaGeneratedFile (Join-Path $taskSecretRoot 'terminal.json') (@{gateway='http://edge-gateway:8080';token=$taskGateway.terminals.'ep01-terminal'} | ConvertTo-Json)
    Write-CeaGeneratedFile (Join-Path $taskSecretRoot 'storage.env') ("GATEWAY_STORAGE_USER=$($taskGateway.storageUser)`nGATEWAY_STORAGE_PASSWORD=$($taskGateway.storagePassword)`n")
} else { $taskGateway = Get-Content (Join-Path $taskSecretRoot 'gateway.json') -Raw | ConvertFrom-Json }
if ($taskGateway.clusterId -ne 'edge-a') { throw 'These examples require the configured edge-a gateway domain' }
$taskUsers = @(
    @{name=$taskSettings.BACKEND_USER;password=$taskSettings.BACKEND_PASSWORD;namespaces=@('lab');actions=@('READ','WRITE','EXECUTE');role='ADMIN'},
    @{name=$taskGateway.backendUser;password=$taskGateway.backendPassword;namespaces=@('lab');actions=@('CONNECT')}
)
Write-CeaGeneratedFile $taskBackendConfig (@{platform=@{security=@{users=$taskUsers}}} | ConvertTo-Json -Depth 8)
$taskPolicy = @{Version='2012-10-17';Statement=@(
    @{Effect='Allow';Action=@('s3:GetObject');Resource=@('arn:aws:s3:::cea-artifacts-edge-a/lab/*')},
    @{Effect='Allow';Action=@('s3:PutObject');Resource=@('arn:aws:s3:::cea-artifacts-edge-a/lab/ingress/ep01-terminal/*','arn:aws:s3:::cea-artifacts-edge-a/lab/ingress/ep01-other/*')}
)}
Write-CeaGeneratedFile (Join-Path $taskSecretRoot 'storage-policy.json') ($taskPolicy | ConvertTo-Json -Depth 8)
if (-not $Publish) { Write-Output 'EP-01 local config generated; no services changed.'; return }
# Original backend image stays available. No DB migration, no algorithm cluster restart.
$taskBaseline = @{}
foreach ($taskId in @(Invoke-CeaCompose ps -q)) {
    $taskContainer = (& docker inspect $taskId | ConvertFrom-Json)[0]
    $taskBaseline[$taskContainer.Config.Labels.'com.docker.compose.service'] = @{id=$taskId;image=$taskContainer.Image;started=$taskContainer.State.StartedAt}
}
$taskHeaders = Get-CeaHeaders $taskSettings
$taskApi = "http://127.0.0.1:$($taskSettings.CEA_API_PORT)/api/namespaces/lab"
if (-not $taskSettings.CEA_API_PORT) { $taskApi='http://127.0.0.1:18085/api/namespaces/lab' }
$taskFlows = Invoke-RestMethod "$taskApi/flows?limit=100" -Headers $taskHeaders
$taskExecutions = Invoke-RestMethod "$taskApi/executions?limit=100" -Headers $taskHeaders
if (@($taskExecutions | Where-Object state -NotIn @('SUCCESS','FAILED','KILLED','CANCELLED')).Count) { throw 'Wait for active CEA executions before configuring backend' }
if (-not (Test-Path (Join-Path $taskEdgeRoot 'before.json'))) {
    Write-CeaGeneratedFile (Join-Path $taskEdgeRoot 'before.json') (@{containers=$taskBaseline;flows=$taskFlows;executions=$taskExecutions} | ConvertTo-Json -Depth 50)
}
& docker tag cea/backend:local cea/backend:before-ep01
if ($LASTEXITCODE -ne 0) { throw 'Could not retain backend image' }
Invoke-CeaCompose run --rm --no-deps -v "${taskSecretRoot}:/edge:ro" storage-tool -ec '. /edge/storage.env; mc alias set edge http://minio-edge-a:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; mc admin user add edge "$GATEWAY_STORAGE_USER" "$GATEWAY_STORAGE_PASSWORD" >/dev/null; mc admin policy create edge cea-ep01-gateway /edge/storage-policy.json >/dev/null; mc admin policy attach edge cea-ep01-gateway --user "$GATEWAY_STORAGE_USER" >/dev/null; for model in bearing.joblib tile.pt; do if mc stat "edge/cea-artifacts-edge-a/lab/edge-models/ep01-v1/$model" >/dev/null 2>&1; then echo "Retaining published $model"; else mc cp "/data/edge-processing/models/$model" "edge/cea-artifacts-edge-a/lab/edge-models/ep01-v1/$model"; fi; done'
& docker image save --output (Join-Path $taskEdgeRoot 'algorithm.tar') cea/edge-processing:ep01-v1
if ($LASTEXITCODE -ne 0) { throw 'Export algorithm failed' }
Invoke-CeaCompose run --rm --no-deps image-tool copy --dest-tls-verify=false --dest-authfile=/run/secrets/registry-auth.json docker-archive:/data/edge-processing/algorithm.tar docker://registry-center:5000/lab/edge-processing:ep01-v1
$taskDigest = (Invoke-CeaCompose run --rm --no-deps image-tool inspect --tls-verify=false --authfile=/run/secrets/registry-auth.json --format '{{.Digest}}' docker://registry-center:5000/lab/edge-processing:ep01-v1).Trim()
if ($taskDigest -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Invalid algorithm digest' }
Invoke-CeaCompose up -d --no-deps --wait --wait-timeout 180 backend
Invoke-CeaCompose exec -T frontend nginx -s reload
function Put-EdgeJson($Path,$Value) {
    Invoke-RestMethod -Method Put -Uri "$taskApi/$Path" -Headers $taskHeaders -ContentType 'application/json; charset=utf-8' -Body ($Value | ConvertTo-Json -Depth 30)
}
Put-EdgeJson 'edge/gateways/ep01-gateway' @{clusterId='edge-a';principal=$taskGateway.backendUser;enabled=$true} | Out-Null
foreach ($taskTerminal in @('ep01-terminal','ep01-other')) {
    Put-EdgeJson "edge/terminals/$taskTerminal" @{gatewayId='ep01-gateway';enabled=$true} | Out-Null
}
foreach ($taskApp in @('edge-hydraulic','edge-bearing','edge-surface','edge-quality-report')) {
    Put-EdgeJson "applications/$taskApp/versions/ep01-v1" @{applicationId=$taskApp;version='ep01-v1';image="registry-center:5000/lab/edge-processing@$taskDigest";parameters=@{}} | Out-Null
}
$taskPolicies = @{'hydraulic-local'='hydraulic-window';'bearing-return'='bearing-window';'surface-cloud'='surface-batch'}
foreach ($taskName in $taskPolicies.Keys) {
    $taskSource = Get-Content (Join-Path $taskRepository "examples/edge-processing/$taskName.yaml") -Raw -Encoding UTF8
    $taskExisting = Invoke-RestMethod "$taskApi/edge/policies?limit=100" -Headers $taskHeaders
    $taskRevision = 0
    if (@($taskExisting | Where-Object id -EQ $taskName).Count -gt 0) {
        $taskSaved = Invoke-RestMethod "$taskApi/edge/policies/$taskName" -Headers $taskHeaders
        if ($taskSaved.flow.source -eq $taskSource) { continue }
        throw "Policy $taskName already exists with other source; review before updating"
    }
    Put-EdgeJson "edge/policies/$taskName" @{clusterId='edge-a';eventType=$taskPolicies[$taskName];enabled=$true;expectedRevision=$taskRevision;source=$taskSource} | Out-Null
}
Invoke-CeaCompose up -d --no-deps --wait --wait-timeout 60 edge-gateway
# The one-shot preparation container creates this directory as root; only the terminal UID needs to write it.
Invoke-CeaCompose run --rm --no-deps --user 0 --cap-add CHOWN --entrypoint chown terminal-replay 65532:65532 /evidence
Write-Output 'EP-01 deployed. Run terminal-replay separately to verify actual upload and three policies.'
