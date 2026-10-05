param([string]$Batch='run-1',[ValidateSet(0,1,5,10)][int]$Passes=0)
. (Join-Path $PSScriptRoot '../../deploy/cea/common.ps1')
$taskFamily=if($Passes){'hc04'}else{'hc03'}
$taskFolder=Join-Path $taskRepository ".local/cea/$taskFamily/$Batch"
foreach($taskCluster in @('cloud','edge-a','edge-b','edge-c')) {
    $taskNames=@()
    foreach($taskFile in (Get-ChildItem $taskFolder -Filter 'pair-*.json' | Where-Object Name -NotLike '*accepted*')) {
        $taskTrial=Get-Content $taskFile -Raw | ConvertFrom-Json
        foreach($taskTask in $taskTrial.tasks) {
            if(-not $taskTask.outputs.PSObject.Properties['cea-measurement.json']) { continue }
            $taskBucket=([uri]$taskTask.outputs.'cea-measurement.json').Host
            $taskTarget=if($taskBucket -eq 'cea-artifacts') {'cloud'} else {$taskBucket.Replace('cea-artifacts-','')}
            if($taskTarget -eq $taskCluster) { $taskNames+="cea-$($taskTask.id)-a1" }
        }
    }
    if($taskNames.Count -eq 0) { throw 'No measured Jobs; incomplete comparison batch' }
    $taskJobs=& docker exec "cea-$taskCluster-1" kubectl -n cea-lab get jobs @taskNames -o json | ConvertFrom-Json
    if($LASTEXITCODE -ne 0) { throw 'Exact Job read failed' }
    # Never write grants, environment credentials or complete Pod specs to evidence.
    $taskSafe=@($taskJobs.items | ForEach-Object {@{name=$_.metadata.name;cluster=$taskCluster;
        containers=@($_.spec.template.spec.containers | ForEach-Object {@{name=$_.name;image=$_.image;resources=$_.resources;command=$_.command}});
        initContainers=@($_.spec.template.spec.initContainers | ForEach-Object {@{name=$_.name;image=$_.image;resources=$_.resources}});
        succeeded=$_.status.succeeded}})
    Write-CeaGeneratedFile (Join-Path $taskFolder "jobs-$taskCluster.json") ($taskSafe | ConvertTo-Json -Depth 20)
}
$taskScript=Join-Path $PSScriptRoot 'compare-audit.py'
$taskData=Join-Path $taskRepository '.local/cea'
& docker run --rm --mount "type=bind,source=$taskScript,target=/app/compare_audit.py,readonly" --mount "type=bind,source=$taskData,target=/data" cea/hydraulic-cloud-edge:hc03-v1 python /app/compare_audit.py --raw /data/hc01/full --batch "/data/$taskFamily/$Batch" --passes $Passes
if($LASTEXITCODE -ne 0) { throw 'Independent comparison audit failed' }
