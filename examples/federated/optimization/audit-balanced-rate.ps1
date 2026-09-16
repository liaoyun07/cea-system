. (Join-Path $PSScriptRoot '../../../deploy/cea/common.ps1')
$taskEvidence = Join-Path $taskRepository '.local/cea/par14'
$taskAudit = Get-Content (Join-Path $taskEvidence 'audit.json') -Raw | ConvertFrom-Json
if ($taskAudit.result -ne 'PASS' -or $taskAudit.copies.Count -ne 20) { throw 'Four successful audited executions required' }
$taskScript = @'
mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
for edge in edge-a edge-b edge-c; do
  mc alias set "$edge" "http://minio-$edge:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
done
'@
foreach ($taskCopy in $taskAudit.copies) {
    if ($taskCopy.source -notmatch '^(local/cea-artifacts|edge-[abc]/cea-artifacts-edge-[abc])/[A-Za-z0-9/._-]+$') { throw 'Unexpected source' }
    if ($taskCopy.destination -notmatch '^par14/models/[0-3]/(init-0|train-[1-3]|aggregate-1)\.pt$') { throw 'Unexpected destination' }
    if (Test-Path (Join-Path $taskRepository ".local/cea/$($taskCopy.destination)")) { throw 'Refuse overwriting evidence' }
    $taskScript += "`nmc cp `"$($taskCopy.source)`" `"/data/$($taskCopy.destination)`" >/dev/null"
}
Invoke-CeaCompose run --rm --no-deps storage-tool -ec $taskScript
$taskCheck = @'
import json
from pathlib import Path
import torch
torch.set_num_threads(1)
load = lambda p: torch.load(p, weights_only=True, map_location='cpu')
audit = json.loads(Path('/reference/data-model-audit.json').read_text())
assert audit['result'] == 'PASS' and audit['equalTensors'] == 20
count = 0
for run in range(4):
    for name in ('init-0', 'train-1', 'train-2', 'train-3', 'aggregate-1'):
        expected = load(Path('/reference/models') / (name + '.pt'))
        actual = load(Path('/audit/models') / str(run) / (name + '.pt'))
        assert expected.keys() == actual.keys()
        for key in expected:
            if key == 'state':
                assert expected[key].keys() == actual[key].keys()
                for tensor in expected[key]:
                    assert torch.equal(expected[key][tensor], actual[key][tensor]), (run, name, tensor)
                    count += 1
            else:
                assert expected[key] == actual[key], (run, name, key)
    trial = json.loads((Path('/audit') / f'trial-{run}.json').read_text())
    assert trial['execution']['state'] == 'SUCCESS'
    for key, value in audit['metrics'].items():
        assert trial['metrics'][key] == value
assert count == 80
print(json.dumps(dict(result='PASS', models=20, equalTensors=count, samples=[16667,16667,16666])))
'@
$taskOutput = & docker run --rm --network none --memory 2g `
    --mount "type=bind,source=$taskEvidence,target=/audit,readonly" `
    --mount "type=bind,source=$taskRepository/.local/cea/par13,target=/reference,readonly" `
    --entrypoint python cea/federated:par07-v1 -c $taskCheck
if ($LASTEXITCODE -ne 0) { throw 'Model comparison failed' }
$taskResult = $taskOutput | ConvertFrom-Json
if ($taskResult.result -ne 'PASS') { throw 'Model audit failed' }
$taskOutputPath = Join-Path $taskEvidence 'models-audit.json'
if (Test-Path $taskOutputPath) { throw 'Refuse replacing evidence' }
Write-CeaGeneratedFile $taskOutputPath ($taskResult | ConvertTo-Json -Depth 10)
Write-Output $taskOutput
