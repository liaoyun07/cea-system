# Run only AFTER timing trials; local numerical recomputation must not contend with them.
. (Join-Path $PSScriptRoot '../../../deploy/cea/common.ps1')
$taskRoot=Join-Path $taskRepository '.local/cea/par01'
$taskCases=Get-Content (Join-Path $taskRoot 'cases.json') -Raw | ConvertFrom-Json
foreach($taskCase in $taskCases | Where-Object clients -eq 6) {
    $taskKey="$($taskCase.flowId)-r1"
    $taskEvidence=Join-Path $taskRoot $taskKey
    $taskResult=Get-Content (Join-Path $taskEvidence 'result.json') -Raw | ConvertFrom-Json
    if($taskResult.measurement.status -ne 'AVAILABLE') {throw "Cannot numerically audit an unsuccessful timing trial: $taskKey"}
    $taskTasks=Get-Content (Join-Path $taskEvidence 'tasks.json') -Raw | ConvertFrom-Json
    $taskFetch='mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; for edge in edge-a edge-b edge-c; do mc alias set "$edge" "http://minio-$edge:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; done; '
    foreach($taskRun in $taskTasks | Where-Object {$_.taskId -in @('init','train','aggregate','evaluate')}) {
        $taskCluster='cloud'
        $taskRound=$taskRun.iteration
        if($taskRun.taskId -eq 'train') {
            $taskItem=$taskCase.items[$taskRun.iteration-1]
            $taskCluster=$taskItem.clusters[0]
            $taskRound=($taskTasks | Where-Object id -eq $taskRun.parentTaskRunId).iteration
            $taskFile="client-$($taskItem.id.Substring(5))-r$taskRound.pt"
        } elseif($taskRun.taskId -eq 'init') { $taskFile='init.pt' }
        elseif($taskRun.taskId -eq 'aggregate') { $taskFile="aggregate-r$taskRound.pt" }
        else { $taskFile="evaluate-r$taskRound.json" }
        $taskPort=if($taskRun.taskId -eq 'evaluate') {'metrics.json'} else {'model.pt'}
        $taskUri=[uri]$taskRun.outputs.$taskPort
        $taskBucket=if($taskCluster -eq 'cloud') {'cea-artifacts'} else {"cea-artifacts-$taskCluster"}
        if($taskUri.Scheme -ne 's3' -or $taskUri.Host -ne $taskBucket) {throw 'Output is not in actual execution store'}
        $taskAlias=if($taskCluster -eq 'cloud') {'local'} else {$taskCluster}
        $taskSource="$taskAlias/$($taskUri.Host)$($taskUri.AbsolutePath)"
        if($taskSource -notmatch '^(local/cea-artifacts|edge-[abc]/cea-artifacts-edge-[abc])/[A-Za-z0-9/._-]+$') {throw 'Unexpected artifact key'}
        $taskFetch+='mc cp "'+$taskSource+'" "/data/par01/'+$taskKey+'/'+$taskFile+'" >/dev/null; '
        $taskJob=(Invoke-CeaCompose exec -T $taskCluster kubectl get job "cea-$($taskRun.id)-a1" -n cea-lab -o json) | ConvertFrom-Json
        if($taskJob.status.succeeded -ne 1) {throw 'Expected a completed Job'}
        if(@($taskJob.spec.template.spec.initContainers.name) -notcontains 'files-in' -or @($taskJob.spec.template.spec.containers.name) -notcontains 'files-out') {throw 'Expected common file helpers'}
    }
    Invoke-CeaCompose run --rm --no-deps storage-tool -ec $taskFetch
    $taskDatasetDirectory=Join-Path $taskRoot $taskCase.dataset
    $taskTest=Join-Path $taskDatasetDirectory 'test.pt'
    if(!(Test-Path -LiteralPath $taskTest)) { Copy-Item -LiteralPath (Join-Path $taskRepository ".local/cea/$($taskCase.dataset)/test.pt") -Destination $taskTest }
    $taskAudit=& docker run --rm --label com.docker.compose.project=cea --memory 2g --mount "type=bind,source=$taskEvidence,target=/audit,readonly" --mount "type=bind,source=$taskDatasetDirectory,target=/datasets,readonly" cea/federated:cf01-v1 python /app/verify_run.py /audit $taskCase.algorithm --clients a1 a2 b1 b2 c1 c2 --data-directory /datasets
    if($LASTEXITCODE -ne 0) {throw "Numerical audit failed: $taskKey"}
    Write-CeaGeneratedFile (Join-Path $taskEvidence 'numerical-audit.json') ($taskAudit -join "`n")
    Write-Output "$taskKey PASS: 17 Jobs, actual stores, six independent clients and numerical recomputation"
    Write-Output $taskAudit
}
