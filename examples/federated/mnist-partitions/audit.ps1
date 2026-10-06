# After both complete flows only; actual initial/client/final models and exact sanitized Jobs.
. (Join-Path $PSScriptRoot '../../../deploy/cea/common.ps1')
$taskFolder=Join-Path $taskRepository '.local/cea/mnist-partitions/flow-strong'
$taskHeaders=Get-CeaHeaders (Read-CeaSettings)
$taskTrials=@(foreach($taskAlgorithm in @('fedavg','fedcads')){Get-Content (Join-Path $taskFolder "$taskAlgorithm.json") -Raw | ConvertFrom-Json})
$taskCopy=''
foreach($taskCluster in @('cloud','edge-a','edge-b','edge-c')){
    $taskHost=if($taskCluster -eq 'cloud'){'minio'}else{"minio-$taskCluster"}
    $taskCopy+='mc alias set '+$taskCluster+' http://'+$taskHost+':9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; '
}
foreach($taskTrial in $taskTrials){
    $taskInit=$taskTrial.tasks | Where-Object taskId -EQ init
    $taskFinal=$taskTrial.tasks | Where-Object taskId -EQ aggregate | Sort-Object endedAt | Select-Object -Last 1
    foreach($taskPair in @(@{task=$taskInit;name='init'},@{task=$taskFinal;name='final'})){
        $taskUri=[uri]$taskPair.task.outputs.'model.pt'
        $taskCopy+="mc cp 'cloud/$($taskUri.Host)$($taskUri.AbsolutePath)' '/data/mnist-partitions/flow-strong/$($taskTrial.algorithm)-$($taskPair.name).pt' >/dev/null; "
    }
    foreach($taskIteration in 1..3){
        $taskTrain=$taskTrial.tasks | Where-Object { $_.taskId -eq 'train' -and $_.iteration -eq $taskIteration } | Sort-Object endedAt | Select-Object -First 1
        $taskUri=[uri]$taskTrain.outputs.'model.pt'
        $taskCluster=@('edge-a','edge-b','edge-c')[$taskIteration-1]
        $taskCopy+="mc cp '$taskCluster/$($taskUri.Host)$($taskUri.AbsolutePath)' '/data/mnist-partitions/flow-strong/$($taskTrial.algorithm)-$taskCluster.pt' >/dev/null; "
    }
}
Invoke-CeaCompose run --rm --no-deps storage-tool -ec $taskCopy
foreach($taskCluster in @('cloud','edge-a','edge-b','edge-c')){
    $taskNames=@()
    foreach($taskTrial in $taskTrials){foreach($taskTask in $taskTrial.tasks){
        if($taskTask.taskId -notin @('init','train','aggregate','evaluate')){continue}
        $taskTarget=if($taskTask.taskId -eq 'train'){@('edge-a','edge-b','edge-c')[$taskTask.iteration-1]}else{'cloud'}
        if($taskTarget -ne $taskCluster){continue}
        $taskAttempts=Invoke-RestMethod "http://127.0.0.1:18085/api/namespaces/lab/executions/$($taskTrial.execution.id)/tasks/$($taskTask.id)/attempts" -Headers $taskHeaders
        foreach($taskAttempt in $taskAttempts){$taskNames+="cea-$($taskTask.id)-a$($taskAttempt.attemptNo)"}
    }}
    $taskJobs=& docker exec "cea-$taskCluster-1" kubectl -n cea-lab get jobs @taskNames -o json | ConvertFrom-Json
    if($LASTEXITCODE -ne 0){throw 'Exact Job read failed'}
    $taskSafe=@($taskJobs.items | ForEach-Object {@{name=$_.metadata.name;cluster=$taskCluster;status=$_.status;
        containers=@($_.spec.template.spec.containers | ForEach-Object {@{name=$_.name;image=$_.image;resources=$_.resources;command=$_.command}})}})
    Write-CeaGeneratedFile (Join-Path $taskFolder "jobs-$taskCluster.json") ($taskSafe | ConvertTo-Json -Depth 20)
}
& docker run --rm --mount "type=bind,source=$PSScriptRoot/audit.py,target=/app/audit_partitions.py,readonly" --mount "type=bind,source=$taskFolder,target=/audit" --mount "type=bind,source=$taskRepository/.local/cea/mnist/test.pt,target=/test.pt,readonly" cea/federated:mnist-part-v1 python /app/audit_partitions.py
if($LASTEXITCODE -ne 0){throw 'Independent actual artifact audit failed'}
