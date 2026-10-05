param([string]$Batch='run-1',[ValidateSet(0,1,5,10)][int]$Passes=0)
. (Join-Path $PSScriptRoot '../../deploy/cea/common.ps1')
$taskFamily=if($Passes){'hc04'}else{'hc03'}
$taskFolder=Join-Path $taskRepository ".local/cea/$taskFamily/$Batch"
$taskSetup='mc alias set center http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; for e in edge-a edge-b edge-c; do mc alias set "$e" "http://minio-$e:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; done; '
for($taskPair=0;$taskPair -le 5;$taskPair++) {
    foreach($taskMode in @('central','distributed')) {
        $taskCommand=$taskSetup
        $taskName="pair-$taskPair-$taskMode"
        $taskTrial=Get-Content (Join-Path $taskFolder "$taskName.json") -Raw | ConvertFrom-Json
        if($taskTrial.execution.state -ne 'SUCCESS') { throw 'Failed evidence retained; no complete output comparison' }
        foreach($taskTask in $taskTrial.tasks) {
            $taskPorts=if($Passes){@(0..($Passes-1) | ForEach-Object {"features-$_.npz";"anomalies-$_.npz"})}else{@('features.npz','anomalies.npz')}
            foreach($taskPort in $taskPorts) {
                $taskProperty=$taskTask.outputs.PSObject.Properties[$taskPort]
                if($null -eq $taskProperty) { continue }
                $taskUri=[uri]$taskProperty.Value
                $taskAlias=if($taskUri.Host -eq 'cea-artifacts') {'center'} else {$taskUri.Host.Replace('cea-artifacts-','')}
                $taskTarget=if($taskPort.StartsWith('anomalies')) {$taskPort} else {$taskTask.taskId.Replace('_','-')+$taskPort.Replace('features','')}
                $taskCommand+="mc cp '$taskAlias/$($taskUri.Host)$($taskUri.AbsolutePath)' '/data/$taskFamily/$Batch/arrays-$taskName/$taskTarget'; "
            }
        }
        Invoke-CeaCompose run --rm --no-deps storage-tool -ec $taskCommand
        if($LASTEXITCODE -ne 0) { throw 'Output download failed' }
    }
}
