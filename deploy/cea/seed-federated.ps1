# Explicit first registration only. Run after start.ps1 on an empty CEA catalog.
param([int]$TrainSamples=60000, [int]$TestSamples=10000)
. (Join-Path $PSScriptRoot 'common.ps1')
$taskSettings = Read-CeaSettings
$taskBase = "http://127.0.0.1:$($taskSettings.CEA_API_PORT)"
$taskHeaders = Get-CeaHeaders $taskSettings
$taskExisting = Invoke-RestMethod -Uri "$taskBase/api/namespaces/lab/flows?limit=100" -Headers $taskHeaders
if (@($taskExisting | Where-Object { $_.flowId -in @('fedavg','fedprox') }).Count -gt 0) {
    throw 'FedAvg/FedProx already registered. Edit Flow revisions explicitly; this first-install script will not replace versions.'
}
$taskImage = 'cea/federated:deploy-v1'
& docker build -f (Join-Path $taskRepository 'algorithms/federated/Dockerfile') -t $taskImage $taskRepository
if ($LASTEXITCODE -ne 0) { throw 'Federated image build failed' }
& docker run --rm --label com.docker.compose.project=cea $taskImage python -m unittest -v test_federated
if ($LASTEXITCODE -ne 0) { throw 'Federated unit tests failed' }
$taskData = Join-Path $taskRepository '.local/cea/mnist'
[IO.Directory]::CreateDirectory((Join-Path $taskData 'raw')) | Out-Null
$taskRawCache = Join-Path $taskRepository 'platform-server/target/federated-data/raw'
if (Test-Path -LiteralPath $taskRawCache) {
    Get-ChildItem -LiteralPath $taskRawCache -Filter '*.gz' | ForEach-Object {
        if (-not (Test-Path -LiteralPath (Join-Path $taskData "raw/$($_.Name)"))) { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $taskData 'raw') }
    }
}
foreach ($taskDataset in @('mnist','cifar10','cifar100')) {
    $taskData = Join-Path $taskRepository ".local/cea/$taskDataset"
    [IO.Directory]::CreateDirectory($taskData) | Out-Null
    $taskCount = if ($taskDataset -eq 'mnist') { $TrainSamples } else { [Math]::Min($TrainSamples,50000) }
    & docker run --rm --label com.docker.compose.project=cea --memory 2g --mount "type=bind,source=$taskData,target=/data" $taskImage python /app/seed.py --dataset $taskDataset --output /data --train-samples $taskCount --test-samples $TestSamples
    if ($LASTEXITCODE -ne 0) { throw "Real $taskDataset preparation failed" }
}
$taskArchive = Join-Path $taskRepository '.local/cea/federated.tar'
& docker image save --output $taskArchive $taskImage
if ($LASTEXITCODE -ne 0) { throw 'Federated image archive failed' }
Invoke-CeaCompose run --rm --no-deps image-tool --command-timeout=300s copy --dest-tls-verify=false --dest-authfile=/run/secrets/registry-auth.json docker-archive:/data/federated.tar docker://registry-center:5000/lab/cea-federated:deploy-v1
Invoke-CeaCompose run --rm --no-deps storage-tool -ec 'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; for d in mnist cifar10 cifar100; do for f in edge-a.pt edge-b.pt edge-c.pt test.pt; do mc cp "/data/$d/$f" "local/datasets/$d/v1/$f"; done; done'
foreach ($taskCluster in @('cloud','edge-a','edge-b','edge-c')) {
    $taskKind = if ($taskCluster -eq 'cloud') { 'CLOUD' } else { 'EDGE' }
    $taskBody = @{id=$taskCluster;kind=$taskKind;enabled=$true} | ConvertTo-Json
    Invoke-RestMethod -Method Put -Uri "$taskBase/api/namespaces/lab/resources/clusters/$taskCluster" -Headers $taskHeaders -ContentType 'application/json' -Body $taskBody | Out-Null
}
$taskPreviousUser = $env:BACKEND_USER
$taskPreviousPassword = $env:BACKEND_PASSWORD
try {
    $env:BACKEND_USER = $taskSettings.BACKEND_USER
    $env:BACKEND_PASSWORD = $taskSettings.BACKEND_PASSWORD
    & (Join-Path $taskRepository 'scripts/register-federated.ps1') -BaseUrl $taskBase -Image 'registry-center:5000/lab/cea-federated:deploy-v1'
} finally {
    $env:BACKEND_USER = $taskPreviousUser
    $env:BACKEND_PASSWORD = $taskPreviousPassword
}
Write-Output 'Real MNIST/CIFAR-10/CIFAR-100 objects, six dataset versions, five Applications and two Flow revisions registered. No executions submitted.'
