# OFF-03 affected services only. No initialization, policy writes, RBAC or storage restart.
. (Join-Path $PSScriptRoot 'common.ps1')
$taskEvidence=Join-Path $taskRepository '.local/cea/off03'
foreach($taskRequired in @('before.json','database-before.sql')) {
    if(-not(Test-Path (Join-Path $taskEvidence $taskRequired))) {throw "Required release backup missing: $taskRequired"}
}
$taskSettings=Read-CeaSettings
$taskHeaders=Get-CeaHeaders $taskSettings
$taskApi="http://127.0.0.1:$($taskSettings.CEA_API_PORT)/api/namespaces/lab"
$taskExecutions=Invoke-RestMethod "$taskApi/executions?limit=100" -Headers $taskHeaders
if(@($taskExecutions | Where-Object state -NotIn @('SUCCESS','FAILED','KILLED','SKIPPED')).Count) {throw 'Active execution; release deferred'}
$taskConfigPath=Join-Path $PSScriptRoot 'secrets/backend/storage-endpoints.yaml'
$taskConfigBackup=Join-Path $taskEvidence 'storage-endpoints-before.yaml'
if(-not(Test-Path $taskConfigBackup)) {Copy-Item -LiteralPath $taskConfigPath -Destination $taskConfigBackup}
$taskConfig=Get-Content $taskConfigPath -Raw | ConvertFrom-Json -AsHashtable
Invoke-CeaCompose build backend frontend edge-gateway terminal-agent
& docker build -t cea/file-helper:off03-v1 (Join-Path $taskRepository 'deploy/file-helper')
if($LASTEXITCODE) {throw 'Helper build failed'}
& docker image save --output (Join-Path $taskEvidence 'helper.tar') cea/file-helper:off03-v1
if($LASTEXITCODE) {throw 'Helper export failed'}
foreach($taskCluster in @('edge-a','cloud')) {
    $taskRegistry=if($taskCluster -eq 'cloud') {'registry-center:5000'} else {'registry-edge-a:5000'}
    Invoke-CeaCompose run --rm --no-deps image-tool copy --dest-tls-verify=false --dest-authfile=/run/secrets/registry-auth.json docker-archive:/data/off03/helper.tar "docker://${taskRegistry}/cea/file-helper:off03-v1"
    $taskDigest=(Invoke-CeaCompose run --rm --no-deps image-tool inspect --tls-verify=false --authfile=/run/secrets/registry-auth.json --format '{{.Digest}}' "docker://${taskRegistry}/cea/file-helper:off03-v1").Trim()
    if($taskDigest -notmatch '^sha256:[a-f0-9]{64}$') {throw 'Invalid helper digest'}
    $taskConfig.platform.jobs.helpers.lab[$taskCluster]="${taskRegistry}/cea/file-helper@${taskDigest}"
}
Write-CeaGeneratedFile $taskConfigPath ($taskConfig | ConvertTo-Json -Depth 20)
Invoke-CeaCompose --profile edge-processing --profile terminal-offloading up -d --no-deps --wait --wait-timeout 180 backend edge-gateway terminal-agent frontend
Invoke-CeaCompose exec -T frontend nginx -s reload
$taskHealth=Invoke-RestMethod "http://127.0.0.1:$($taskSettings.CEA_API_PORT)/health" -TimeoutSec 15
if($taskHealth.status -ne 'UP') {throw 'Backend not healthy'}
Write-CeaGeneratedFile (Join-Path $taskEvidence 'release.json') (@{deployedAt=[DateTime]::UtcNow.ToString('o');services=@('backend','edge-gateway','terminal-agent','frontend');helpers=$taskConfig.platform.jobs.helpers.lab} | ConvertTo-Json -Depth 10)
'OFF-03 services updated; run the measured workload and browser checks before declaring PASS.'
