$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot '../../../deploy/cea/common.ps1')
$taskEvidence = Join-Path $taskRepository '.local/cea/par12'
$taskAudit = Get-Content -LiteralPath (Join-Path $taskEvidence 'audit.json') -Raw | ConvertFrom-Json
if ($taskAudit.result -ne 'PASS' -or $taskAudit.rows.Count -ne 12) { throw 'Twelve timed runs must pass Job/SDK audit first' }
$taskFetch = @'
mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
for edge in edge-a edge-b edge-c; do
  mc alias set "$edge" "http://minio-$edge:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
done
'@
foreach ($taskCopy in $taskAudit.copies) {
    if ($taskCopy.source -notmatch '^(local/cea-artifacts|edge-[abc]/cea-artifacts-edge-[abc])/[A-Za-z0-9/._-]+$') { throw 'Unexpected source' }
    if ($taskCopy.destination -notmatch '^par12/models/([0-9]|1[01])/(init-0|train-[1-3]|aggregate-1)\.pt$') { throw 'Unexpected destination' }
    if (Test-Path -LiteralPath (Join-Path $taskRepository ".local/cea/$($taskCopy.destination)")) { throw 'Do not overwrite model evidence' }
    $taskFetch += "`nmc cp `"$($taskCopy.source)`" `"/data/$($taskCopy.destination)`" >/dev/null"
}
Invoke-CeaCompose run --rm --no-deps storage-tool -ec $taskFetch
$taskOutput = & docker run --rm --network none --memory 2g -e PYTHONPATH=/app `
    --mount "type=bind,source=$taskRepository/.local/cea/par08/models/baseline,target=/baseline,readonly" `
    --mount "type=bind,source=$taskEvidence,target=/audit,readonly" `
    --mount "type=bind,source=$taskRepository/.local/cea/cifar10/test.pt,target=/datasets/test.pt,readonly" `
    --mount "type=bind,source=$PSScriptRoot/verify_low_clients.py,target=/verify.py,readonly" `
    --entrypoint python cea/federated:par07-v1 /verify.py
if ($LASTEXITCODE -ne 0) { throw 'Independent numerical audit failed' }
$taskResult = $taskOutput | ConvertFrom-Json
if ($taskResult.result -ne 'PASS') { throw 'Numerical audit did not pass' }
$taskDestination = Join-Path $taskEvidence 'models-audit.json'
if (Test-Path -LiteralPath $taskDestination) { throw 'Do not replace previous audit' }
Write-CeaGeneratedFile $taskDestination ($taskResult | ConvertTo-Json -Depth 30)
Write-Output 'PASS: 48 models / 192 tensors; all weighted aggregates and 10000-sample evaluations verified.'
