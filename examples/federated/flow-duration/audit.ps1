param([ValidateSet('cea-1','cea-2')][string]$Batch='cea-1')
. (Join-Path $PSScriptRoot '../../../deploy/cea/common.ps1')
$taskRoot=Join-Path $taskRepository ".local/cea/conv02/$Batch"
$taskTrials=@(0..11 | ForEach-Object {Get-Content (Join-Path $taskRoot "trial-$_.json") -Raw | ConvertFrom-Json})
$taskCommand='mc alias set center http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; '
foreach($taskIndex in 2..11){
    $taskInit=$taskTrials[$taskIndex].tasks | Where-Object taskId -EQ init
    $taskUri=[uri]$taskInit.outputs.'model.pt'
    $taskCommand+="mc cp 'center/$($taskUri.Host)$($taskUri.AbsolutePath)' '/data/conv02/$Batch/init-$taskIndex.pt'; "
}
Invoke-CeaCompose run --rm --no-deps storage-tool -ec $taskCommand
$taskBaseline=@(2..6 | ForEach-Object {
    $taskPrior=Get-Content (Join-Path $taskRepository ".local/cea/conv01/cea-1/trial-$_.json") -Raw | ConvertFrom-Json
    @{seed=$taskPrior.seed;algorithm=$taskPrior.algorithm;evaluations=$taskPrior.evaluations}
})
Write-CeaGeneratedFile (Join-Path $taskRoot 'baseline-curves.json') ($taskBaseline | ConvertTo-Json -Depth 15)
foreach($taskCluster in @('cloud','edge-a','edge-b','edge-c')){
    $taskNames=@()
    foreach($taskTrial in $taskTrials){foreach($taskTask in $taskTrial.tasks){
        if($taskTask.taskId -notin @('init','train','aggregate','evaluate')){continue}
        $taskTarget=if($taskTask.taskId -eq 'train'){@('edge-a','edge-b','edge-c')[$taskTask.iteration-1]}else{'cloud'}
        if($taskTarget -ne $taskCluster){continue}
        $taskAttempts=Invoke-RestMethod "http://127.0.0.1:18085/api/namespaces/lab/executions/$($taskTrial.execution.id)/tasks/$($taskTask.id)/attempts" -Headers (Get-CeaHeaders (Read-CeaSettings))
        foreach($taskAttempt in $taskAttempts){$taskNames+="cea-$($taskTask.id)-a$($taskAttempt.attemptNo)"}
    }}
    $taskJobs=& docker exec "cea-$taskCluster-1" kubectl -n cea-lab get jobs @taskNames -o json | ConvertFrom-Json
    if($LASTEXITCODE -ne 0){throw 'Exact Job read failed'}
    $taskSafe=@($taskJobs.items | ForEach-Object {@{name=$_.metadata.name;cluster=$taskCluster;status=$_.status;
        containers=@($_.spec.template.spec.containers | ForEach-Object {@{name=$_.name;image=$_.image;resources=$_.resources;command=$_.command}})}})
    Write-CeaGeneratedFile (Join-Path $taskRoot "jobs-$taskCluster.json") ($taskSafe | ConvertTo-Json -Depth 20)
}
$taskScript=Join-Path $PSScriptRoot 'audit.py'
$taskData=Join-Path $taskRepository '.local/cea/conv02'
& docker run --rm --mount "type=bind,source=$taskScript,target=/app/audit_flow_duration.py,readonly" --mount "type=bind,source=$taskData,target=/data" cea/federated:fedcads-v2 python /app/audit_flow_duration.py --root "/data/$Batch"
if($LASTEXITCODE -ne 0){throw 'Independent audit failed'}
