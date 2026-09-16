. (Join-Path $PSScriptRoot '../../../deploy/cea/common.ps1')
$taskEvidence = Join-Path $taskRepository '.local/cea/par21'
$taskAudit = Get-Content (Join-Path $taskEvidence 'audit.json') -Raw | ConvertFrom-Json
if ($taskAudit.result -ne 'PASS' -or $taskAudit.copies.Count -lt 1) { throw 'Job audit must pass first' }
$taskScript = @'
mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
for edge in edge-a edge-b edge-c; do
  mc alias set "$edge" "http://minio-$edge:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
done
'@
foreach ($taskCopy in $taskAudit.copies) {
    if ($taskCopy.source -notmatch '^(local/cea-artifacts|edge-[abc]/cea-artifacts-edge-[abc])/[A-Za-z0-9/._-]+$') { throw 'Unexpected source' }
    if ($taskCopy.destination -notmatch '^par21/models/[0-9]/(init-0|train-[1-6]|aggregate-1)\.pt$') { throw 'Unexpected destination' }
    if (Test-Path (Join-Path $taskRepository ".local/cea/$($taskCopy.destination)")) { throw 'Refuse overwriting evidence' }
    $taskScript += "`nmc cp `"$($taskCopy.source)`" `"/data/$($taskCopy.destination)`" >/dev/null"
}
Invoke-CeaCompose run --rm --no-deps storage-tool -ec $taskScript
$taskOutput = & docker run --rm --network none --memory 2g -e PYTHONPATH=/app `
    --mount "type=bind,source=$taskEvidence,target=/audit,readonly" `
    --mount "type=bind,source=$taskRepository/.local/cea/par13,target=/reference,readonly" `
    --mount "type=bind,source=$taskRepository/.local/cea/cifar10/test.pt,target=/test.pt,readonly" `
    --mount "type=bind,source=$PSScriptRoot/verify_models.py,target=/verify.py,readonly" `
    --entrypoint python cea/federated:par07-v1 /verify.py
if ($LASTEXITCODE -ne 0) { throw 'Numerical audit failed' }
$taskResult = $taskOutput | ConvertFrom-Json
if ($taskResult.result -ne 'PASS') { throw 'Model audit failed' }
$taskPath = Join-Path $taskEvidence 'models-audit.json'
if (Test-Path $taskPath) { throw 'Refuse replacing audit evidence' }
Write-CeaGeneratedFile $taskPath ($taskResult | ConvertTo-Json -Depth 15)
Write-Output $taskOutput
