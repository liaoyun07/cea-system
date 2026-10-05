param([string]$Batch='run-1')
. (Join-Path $PSScriptRoot '../../deploy/cea/common.ps1')
$taskFolder=Join-Path $taskRepository ".local/cea/hc03/$Batch"
$taskCommand='mc alias set center http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; for e in edge-a edge-b edge-c; do mc alias set "$e" "http://minio-$e:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; done; '
for($taskPair=0;$taskPair -le 5;$taskPair++) {
    foreach($taskMode in @('central','distributed')) {
        $taskName="pair-$taskPair-$taskMode"
        $taskTrial=Get-Content (Join-Path $taskFolder "$taskName.json") -Raw | ConvertFrom-Json
        if($taskTrial.execution.state -ne 'SUCCESS') { throw 'Failed evidence retained; no complete output comparison' }
        foreach($taskTask in $taskTrial.tasks) {
            foreach($taskPort in @('features.npz','anomalies.npz')) {
                $taskProperty=$taskTask.outputs.PSObject.Properties[$taskPort]
                if($null -eq $taskProperty) { continue }
                $taskUri=[uri]$taskProperty.Value
                $taskAlias=if($taskUri.Host -eq 'cea-artifacts') {'center'} else {$taskUri.Host.Replace('cea-artifacts-','')}
                $taskTarget=if($taskPort -eq 'anomalies.npz') {'anomalies'} else {$taskTask.taskId.Replace('_','-')}
                $taskCommand+="mc cp '$taskAlias/$($taskUri.Host)$($taskUri.AbsolutePath)' '/data/hc03/$Batch/arrays-$taskName/$taskTarget.npz'; "
            }
        }
    }
}
Invoke-CeaCompose run --rm --no-deps storage-tool -ec $taskCommand
