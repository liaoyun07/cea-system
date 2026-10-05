. (Join-Path $PSScriptRoot '../../../deploy/cea/common.ps1')
$taskRoot=Join-Path $taskRepository '.local/cea/conv01/cea-1'
$taskIndices=@(0..11 | Where-Object {Test-Path (Join-Path $taskRoot "trial-$_.json")})
$taskTrials=@($taskIndices | ForEach-Object {Get-Content (Join-Path $taskRoot "trial-$_.json") -Raw | ConvertFrom-Json})
$taskCommand='mc alias set center http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; '
foreach($taskIndex in ($taskIndices | Where-Object {$_ -ge 2})){
    $taskTrial=Get-Content (Join-Path $taskRoot "trial-$taskIndex.json") -Raw | ConvertFrom-Json
    $taskInit=$taskTrial.tasks | Where-Object taskId -EQ init
    $taskUri=[uri]$taskInit.outputs.'model.pt'
    $taskCommand+="mc cp 'center/$($taskUri.Host)$($taskUri.AbsolutePath)' '/data/conv01/cea-1/init-$taskIndex.pt'; "
}
Invoke-CeaCompose run --rm --no-deps storage-tool -ec $taskCommand
foreach($taskCluster in @('cloud','edge-a','edge-b','edge-c')){
    $taskNames=@()
    foreach($taskTrial in $taskTrials){foreach($taskTask in $taskTrial.tasks){
        if($taskTask.taskId -notin @('init','train','aggregate','evaluate')){continue}
        $taskAttempts=Invoke-RestMethod "http://127.0.0.1:18085/api/namespaces/lab/executions/$($taskTrial.execution.id)/tasks/$($taskTask.id)/attempts" -Headers (Get-CeaHeaders (Read-CeaSettings))
        $taskTarget=if($taskTask.taskId -eq 'train'){@('edge-a','edge-b','edge-c')[$taskTask.iteration-1]}else{'cloud'}
        foreach($taskAttempt in $taskAttempts){
            if($taskTarget -eq $taskCluster){$taskNames+="cea-$($taskTask.id)-a$($taskAttempt.attemptNo)"}
        }
    }}
    # Exact Job reads only; do not export credential-bearing Pod environment/specs.
    if(-not $taskNames.Count){throw "No Jobs found for $taskCluster; inspect attempt target schema"}
    $taskJobs=& docker exec "cea-$taskCluster-1" kubectl -n cea-lab get jobs @taskNames -o json | ConvertFrom-Json
    if($LASTEXITCODE -ne 0){throw 'Job audit read failed'}
    $taskSafe=@($taskJobs.items | ForEach-Object {@{name=$_.metadata.name;cluster=$taskCluster;status=$_.status;
        containers=@($_.spec.template.spec.containers | ForEach-Object {@{name=$_.name;image=$_.image;resources=$_.resources;command=$_.command}})}})
    Write-CeaGeneratedFile (Join-Path $taskRoot "jobs-$taskCluster.json") ($taskSafe | ConvertTo-Json -Depth 20)
}
$taskScript=Join-Path $PSScriptRoot 'audit.py'
$taskData=Join-Path $taskRepository '.local/cea/conv01'
& docker run --rm --mount "type=bind,source=$taskScript,target=/app/audit_convergence.py,readonly" --mount "type=bind,source=$taskData,target=/data" cea/federated:fedcads-v2 python /app/audit_convergence.py --root /data/cea-1
if($LASTEXITCODE -ne 0){throw 'Convergence audit failed'}
