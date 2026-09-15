param([ValidateSet('par10','par11')][string]$Batch = 'par11')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot '../../../deploy/cea/common.ps1')
$taskEvidence = Join-Path $taskRepository ".local/cea/$Batch"
$taskAudit = Get-Content -LiteralPath (Join-Path $taskEvidence 'audit.json') -Raw | ConvertFrom-Json
if ($taskAudit.result -ne 'PASS') { throw 'Job/SDK audit must pass first' }
$taskExpectedRuns = if ($Batch -eq 'par11') { 4 } else { 1 }
if ($taskAudit.rows.Count -ne $taskExpectedRuns) { throw 'Missing measured runs' }
$taskFetch = @'
mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
for edge in edge-a edge-b edge-c; do
  mc alias set "$edge" "http://minio-$edge:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
done
'@
foreach ($taskCopy in $taskAudit.copies) {
    if ($taskCopy.source -notmatch '^(local/cea-artifacts|edge-[abc]/cea-artifacts-edge-[abc])/[A-Za-z0-9/._-]+$') { throw 'Unexpected object location' }
    if ($taskCopy.destination -notmatch "^$Batch/models/[0-3]/(init-0|train-([1-9]|1[0-8])|aggregate-1)\.pt$") { throw 'Unexpected evidence filename' }
    if (Test-Path -LiteralPath (Join-Path $taskRepository ".local/cea/$($taskCopy.destination)")) { throw 'Do not overwrite saved model evidence' }
    $taskFetch += "`nmc cp `"$($taskCopy.source)`" `"/data/$($taskCopy.destination)`" >/dev/null"
}
Invoke-CeaCompose run --rm --no-deps storage-tool -ec $taskFetch
$taskResults = @()
for ($taskIndex = 0; $taskIndex -lt $taskExpectedRuns; $taskIndex++) {
    $taskOutput = & docker run --rm --network none --memory 2g -e PYTHONPATH=/app `
        --mount "type=bind,source=$taskRepository/.local/cea/par08/models/baseline,target=/audit/baseline,readonly" `
        --mount "type=bind,source=$taskEvidence/models/$taskIndex,target=/audit/candidate,readonly" `
        --mount "type=bind,source=$taskEvidence/trial-$taskIndex.json,target=/audit/trial-0.json,readonly" `
        --mount "type=bind,source=$taskRepository/.local/cea/cifar10/test.pt,target=/datasets/test.pt,readonly" `
        --mount "type=bind,source=$PSScriptRoot/verify_eighteen.py,target=/audit/verify.py,readonly" `
        --entrypoint python cea/federated:par07-v1 /audit/verify.py
    if ($LASTEXITCODE -ne 0) { throw "Independent numerical audit failed for run $taskIndex" }
    $taskResult = $taskOutput | ConvertFrom-Json
    if ($taskResult.result -ne 'PASS') { throw 'Numerical audit did not pass' }
    $taskResults += $taskResult
    Write-Output "Run $taskIndex : 20 models / 80 tensors / independent evaluation PASS"
}
$taskDestination = Join-Path $taskEvidence 'models-audit.json'
if (Test-Path -LiteralPath $taskDestination) { throw 'Do not replace previous audit' }
Write-CeaGeneratedFile $taskDestination (@{result='PASS';runs=$taskResults} | ConvertTo-Json -Depth 30)
