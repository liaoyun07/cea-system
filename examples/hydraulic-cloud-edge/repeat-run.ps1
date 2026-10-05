param([int]$Passes=5,[string]$Batch='run-1')
. (Join-Path $PSScriptRoot '../../deploy/cea/common.ps1')
$taskNode='C:/Users/liaoy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$env:CEA_COMPARE_AUTH=(Get-CeaHeaders (Read-CeaSettings)).Authorization
try {
    & $taskNode (Join-Path $PSScriptRoot 'compare.mjs') (Join-Path $taskRepository ".local/cea/hc04/$Batch-p$Passes") $Passes
    if($LASTEXITCODE -ne 0){throw 'Repeat comparison stopped; preserve accepted IDs, no replacement.'}
} finally {Remove-Item Env:CEA_COMPARE_AUTH}
