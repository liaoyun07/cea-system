param([string]$Batch='run-1')
. (Join-Path $PSScriptRoot '../../deploy/cea/common.ps1')
$taskNode='C:/Users/liaoy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$env:CEA_COMPARE_AUTH=(Get-CeaHeaders (Read-CeaSettings)).Authorization
try {
    & $taskNode (Join-Path $PSScriptRoot 'compare.mjs') (Join-Path $taskRepository ".local/cea/hc03/$Batch")
    if($LASTEXITCODE -ne 0) { throw 'Comparison stopped; accepted IDs and evidence retained. Do not replace failed trials.' }
} finally { Remove-Item Env:CEA_COMPARE_AUTH }
