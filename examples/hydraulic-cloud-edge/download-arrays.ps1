param([string]$Batch = 'optimized-v2')
. (Join-Path $PSScriptRoot '../../deploy/cea/common.ps1')
$taskFolder = Join-Path $taskRepository ".local/cea/hc01/$Batch"
$taskCommand = 'mc alias set center http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; for e in edge-a edge-b edge-c; do mc alias set "$e" "http://minio-$e:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; done; '
for ($taskIndex=0; $taskIndex -lt 4; $taskIndex++) {
    $taskTrial = Get-Content (Join-Path $taskFolder "trial-$taskIndex.json") -Raw | ConvertFrom-Json
    if ($taskTrial.execution.state -ne 'SUCCESS') { throw 'Only successful evidence has numerical artifacts' }
    foreach ($taskTask in $taskTrial.tasks) {
        $taskPort = if ($taskTask.taskId -eq 'fusion') { 'anomalies.npz' } else { 'features.npz' }
        $taskProperty = $taskTask.outputs.PSObject.Properties[$taskPort]
        if ($null -eq $taskProperty) { continue }
        $taskUri = [uri]$taskProperty.Value
        $taskAlias = if ($taskUri.Host -eq 'cea-artifacts') { 'center' } else { $taskUri.Host.Replace('cea-artifacts-','') }
        $taskName = if ($taskTask.taskId -eq 'fusion') { 'anomalies' } else { $taskTask.taskId.Replace('_','-') }
        $taskCommand += "mc cp '$taskAlias/$($taskUri.Host)$($taskUri.AbsolutePath)' '/data/hc01/$Batch/arrays-$taskIndex/$taskName.npz'; "
    }
}
Invoke-CeaCompose run --rm --no-deps storage-tool -ec $taskCommand
