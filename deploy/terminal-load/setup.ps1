param(
    [ValidateRange(1,64)][int]$Count = 4,
    [ValidateRange(0.1,4)][double]$Cpu = 0.5,
    [ValidateRange(128,2048)][int]$MemoryMiB = 512,
    [string]$CalibrationBatch = 'v1',
    [ValidateSet('Prepare','Start','Calibrate','Stop')][string]$Action = 'Prepare'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot '../cea/common.ps1')
$taskSimRoot = Join-Path $taskRepository '.local/cea/terminal-load'
$taskComposePath = Join-Path $taskSimRoot 'compose.yaml'
function Sim-Compose { & docker compose -p cea-terminal-load -f $taskComposePath @args; if($LASTEXITCODE){throw 'Simulator compose failed'} }
if($Action -eq 'Stop') { Sim-Compose stop; return }
$taskSettings = Read-CeaSettings
$taskHeaders = Get-CeaHeaders $taskSettings
$taskApi = "http://127.0.0.1:$($taskSettings.CEA_API_PORT)/api/namespaces/lab"
$taskGatewayId = 'sim-load-gateway'
$taskAgentImage = 'cea/terminal-agent:load-v1'
$taskGatewayImage = 'cea/edge-gateway:load-v1'
function Save-SimJson($Name,$Value) { Write-CeaGeneratedFile (Join-Path $taskSimRoot $Name) ($Value | ConvertTo-Json -Depth 35) }
function Token { [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant() }
if($Action -eq 'Prepare') {
    [IO.Directory]::CreateDirectory($taskSimRoot) | Out-Null
    $taskSecretsFile = Join-Path $taskSimRoot 'private.json'
    if(-not(Test-Path $taskSecretsFile)) { Save-SimJson 'private.json' @{password=(Token);control=(Token);agent=(Token);terminals=@{}} }
    $taskSecrets = Get-Content $taskSecretsFile -Raw | ConvertFrom-Json -AsHashtable
    if(-not $taskSecrets.ContainsKey('storage')) {$taskSecrets.storage=Token}
    & docker build -t $taskAgentImage (Join-Path $taskRepository 'deploy/terminal-agent'); if($LASTEXITCODE){throw 'Agent build failed'}
    & docker build -t $taskGatewayImage (Join-Path $taskRepository 'deploy/edge-gateway'); if($LASTEXITCODE){throw 'Gateway build failed'}
    & docker run --rm --network none -v "${taskSimRoot}:/sim" -v "${PSScriptRoot}:/source:ro" $taskAgentImage python /source/prepare.py --root /sim --count $Count
    if($LASTEXITCODE){throw 'Signal preparation failed'}
    $taskFiles = Get-Content (Join-Path $taskSimRoot 'files.json') -Raw | ConvertFrom-Json -AsHashtable
    $taskBaseGateway = Get-Content (Join-Path $taskRepository 'deploy/cea/secrets/edge/gateway.json') -Raw | ConvertFrom-Json -AsHashtable
    $taskGateway = @{} + $taskBaseGateway
    $taskGateway.backendUser=$taskGatewayId; $taskGateway.backendPassword=$taskSecrets.password
    $taskGateway.controlToken=$taskSecrets.control; $taskGateway.terminals=@{}; $taskGateway.agents=@{}
    $taskGateway.storageUser='cea-sim-load'; $taskGateway.storagePassword=$taskSecrets.storage
    $taskGateway.computeEvents=@('load-calibrate-edge','load-calibrate-cloud')
    $taskHosts=@{}
    foreach($taskName in @('registry-center','registry-edge-a','registry-edge-b','registry-edge-c','minio','minio-edge-a','minio-edge-b','minio-edge-c')) {
        $taskInspect = docker inspect "cea-$taskName-1" | ConvertFrom-Json
        $taskHosts[$taskName]=$taskInspect[0].NetworkSettings.Networks.cea_default.IPAddress
    }
    $taskTerminals=@()
    for($taskIndex=1;$taskIndex -le $Count;$taskIndex++) {
        $taskId='sim-terminal-{0:d3}' -f $taskIndex
        if(-not $taskSecrets.terminals.ContainsKey($taskId)) {$taskSecrets.terminals[$taskId]=Token}
        $taskPort=19000+$taskIndex
        $taskTerminals+=@{id=$taskId;port=$taskPort}
        $taskGateway.terminals[$taskId]=$taskSecrets.terminals[$taskId]
        $taskGateway.agents[$taskId]=@{endpoint="http://sim-load-engine:$taskPort";token=$taskSecrets.agent}
        $taskAgent=@{token=$taskSecrets.agent;dockerHost='unix:///var/run/docker.sock';dataDirectory='/data';workDirectory="/sim/work/$taskId";stateDirectory='/state';cgroupParent="cea-terminal-load/$taskId";
            registryHosts=@('registry-edge-a:5000');registryAuth=@{'registry-edge-a:5000'=@{username=$taskSettings.REGISTRY_USER;password=$taskSettings.REGISTRY_PASSWORD}};
            storageHosts=@($taskHosts.Keys | Where-Object { $_ -like 'minio*' } | ForEach-Object {"${_}:9000"; "$($taskHosts[$_]):9000"});
            load=@{terminalId=$taskId;gateway='http://sim-load-gateway:8080';token=$taskSecrets.terminals[$taskId];resourceDirectory='/terminal-resource';files=$taskFiles}}
        Save-SimJson "agents/$taskId.json" $taskAgent
    }
    Save-SimJson 'private.json' $taskSecrets
    Save-SimJson 'gateway.json' $taskGateway
    Save-SimJson 'storage-policy.json' @{Version='2012-10-17';Statement=@(@{Effect='Allow';Action=@('s3:GetObject','s3:PutObject');Resource=@($taskTerminals | ForEach-Object {"arn:aws:s3:::$($taskGateway.bucket)/lab/ingress/$($_.id)/*"})})}
    Write-CeaGeneratedFile (Join-Path $taskSimRoot 'storage.env') ("GATEWAY_STORAGE_USER=$($taskGateway.storageUser)`nGATEWAY_STORAGE_PASSWORD=$($taskSecrets.storage)`n")
    Save-SimJson 'bootstrap.json' @{agentImage=$taskAgentImage;cpu=$Cpu;memoryMiB=$MemoryMiB;terminals=$taskTerminals;hosts=$taskHosts}
    $taskCompose=@{services=@{
        engine=@{image='docker:28-dind';container_name='cea-terminal-load-engine';privileged=$true;environment=@{DOCKER_TLS_CERTDIR=''};
            command=@('dockerd','--host=unix:///var/run/docker.sock','--insecure-registry=registry-edge-a:5000');
            volumes=@('sim-engine:/var/lib/docker',"${taskSimRoot}:/sim", "${PSScriptRoot}:/source:ro");
            networks=@{cea=@{aliases=@('sim-load-engine')}};labels=@{'cea.simulator'='terminal-load'};
            healthcheck=@{test=@('CMD','docker','info');interval='3s';timeout='3s';retries=30}};
        gateway=@{image=$taskGatewayImage;container_name='cea-terminal-load-gateway';read_only=$true;mem_limit='256m';cpus=1;
            tmpfs=@('/tmp:size=150m,mode=1777');cap_drop=@('ALL');security_opt=@('no-new-privileges:true');
            volumes=@("${taskSimRoot}/gateway.json:/run/secrets/gateway.json:ro");
            networks=@{cea=@{aliases=@('sim-load-gateway')}};labels=@{'cea.simulator'='terminal-load'}}};
        volumes=@{'sim-engine'=@{}};networks=@{cea=@{external=$true;name='cea_default'}}}
    Save-SimJson 'compose.yaml' $taskCompose
    $taskMachineConfig = Get-Content (Join-Path $taskRepository 'deploy/cea/secrets/backend/edge-access.yaml') -Raw | ConvertFrom-Json -AsHashtable
    $taskMachineConfig.platform.security.users=@($taskMachineConfig.platform.security.users | Where-Object name -NE $taskGatewayId)+@(@{name=$taskGatewayId;password=$taskSecrets.password;namespaces=@('lab');actions=@('CONNECT')})
    $taskMachineConfig.platform.jobs=@{'terminal-gateways'=@{lab=@{$taskGatewayId=@{slots=1;gateway=@{endpoint='http://sim-load-gateway:8080';tokenFile='/run/secrets/terminal-load-control-token'}}}}}
    $taskMachineConfig.platform['terminal-load']=@{profiles=@{lab=@{signal=@{label='振动信号分析';policies=@{'edge-a'=@{local='load-local';dqn='load-dqn'}}}}}}
    Write-CeaGeneratedFile (Join-Path $taskRepository 'deploy/cea/secrets/backend/terminal-load.yaml') ($taskMachineConfig | ConvertTo-Json -Depth 30)
    Write-CeaGeneratedFile (Join-Path $taskRepository 'deploy/cea/secrets/backend/terminal-load-control-token') $taskSecrets.control
    Sim-Compose up -d --no-deps --wait --wait-timeout 120 engine
    & docker save --output (Join-Path $taskSimRoot 'agent-image.tar') $taskAgentImage; if($LASTEXITCODE){throw 'Agent archive failed'}
    & docker exec cea-terminal-load-engine docker load -i /sim/agent-image.tar; if($LASTEXITCODE){throw 'Agent import failed'}
    'Prepared isolated simulator. Deploy tested backend configuration, then run setup.ps1 -Action Start.'
    return
}
$taskBootstrap = Get-Content (Join-Path $taskSimRoot 'bootstrap.json') -Raw | ConvertFrom-Json -AsHashtable
if($Action -eq 'Calibrate') {
    $taskApp=Invoke-RestMethod "$taskApi/applications/offload-signal/versions/off02-v1" -Headers $taskHeaders
    $taskImage="registry-edge-a:5000/lab/offload-signal@$($taskApp.image.Split('@')[1])"
    foreach($taskTerminal in $taskBootstrap.terminals) {
        & docker exec cea-terminal-load-engine docker exec -e PYTHONPATH=/app $taskTerminal.id python /source/warm.py --image $taskImage --calibrate --batch $CalibrationBatch
        if($LASTEXITCODE){throw "Calibration failed for $($taskTerminal.id); existing receipt retained"}
    }
    return
}
function Put-Sim($Path,$Body) {Invoke-RestMethod "$taskApi/$Path" -Method Put -Headers $taskHeaders -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 35) | Out-Null}
$taskDevices=Invoke-RestMethod "$taskApi/edge/load/devices" -Headers $taskHeaders
if(@($taskDevices | Where-Object {$_.terminal.id -in $taskBootstrap.terminals.id -and $_.loadRunId}).Count) {throw 'Stop sending and wait for this simulator load to drain before restarting agents'}
Invoke-CeaCompose run --rm --no-deps -v "${taskSimRoot}:/sim:ro" storage-tool -ec '. /sim/storage.env; mc alias set edge http://minio-edge-a:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; mc admin user add edge "$GATEWAY_STORAGE_USER" "$GATEWAY_STORAGE_PASSWORD" >/dev/null; mc admin policy create edge cea-sim-load /sim/storage-policy.json >/dev/null; mc admin policy attach edge cea-sim-load --user "$GATEWAY_STORAGE_USER" >/dev/null'
Put-Sim "edge/gateways/$taskGatewayId" @{clusterId='edge-a';principal=$taskGatewayId;enabled=$true}
foreach($taskTerminal in $taskBootstrap.terminals) {Put-Sim "edge/terminals/$($taskTerminal.id)" @{gatewayId=$taskGatewayId;enabled=$true}}
$taskDqn = Invoke-RestMethod "$taskApi/edge/policies/off04-dqn" -Headers $taskHeaders
$taskModel = $taskDqn.flow.definition.tasks[0].container.offload.modelVersion
foreach($taskKind in @('local','dqn','calibrate-edge','calibrate-cloud')) {
    $taskPolicyId="load-$taskKind"
    $taskOffload= switch($taskKind) {local {@{strategy='FIXED';layer='TERMINAL'}} dqn {@{strategy='DQN';modelVersion=$taskModel;exploration=0}} calibrate-edge {@{strategy='FIXED';layer='EDGE'}} calibrate-cloud {@{strategy='FIXED';layer='CLOUD'}}}
    $taskFlow=@{schemaVersion=1;namespace='lab';id=$taskPolicyId;inputs=@{data_file=@{type='OBJECT';required=$true}};
        tasks=@(@{id='features';type='platform.Application';timeout='PT2M';container=@{applicationId='offload-signal';version='off02-v1';execution='TERMINAL';offload=$taskOffload;
            command=@('python','/app/app.py');inputFiles=@{'signal.csv'=@{source='INPUT';name='data_file'}};outputFiles=@('result.json')}});
        outputs=@{terminal_result=@{source='TASK_OUTPUT';taskId='features';port='result.json'}}}
    $taskPolicies=Invoke-RestMethod "$taskApi/edge/policies?limit=100" -Headers $taskHeaders
    if(-not @($taskPolicies | Where-Object id -EQ $taskPolicyId).Count) {Put-Sim "edge/policies/$taskPolicyId" @{clusterId='edge-a';eventType=$taskPolicyId;enabled=$true;expectedRevision=0;source=($taskFlow | ConvertTo-Json -Depth 25)}}
}
Sim-Compose up -d --no-deps gateway
$taskGatewayInspect = docker inspect cea-terminal-load-gateway | ConvertFrom-Json
$taskBootstrap.hosts['sim-load-gateway']=$taskGatewayInspect[0].NetworkSettings.Networks.cea_default.IPAddress
Save-SimJson 'bootstrap.json' $taskBootstrap
# The bootstrap helper sees only the dedicated engine and its cgroup namespace.
& docker exec cea-terminal-load-engine docker run --rm --privileged --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup -v /var/run/docker.sock:/var/run/docker.sock -v /sim:/sim -v /source:/source:ro $taskAgentImage python /source/bootstrap.py
if($LASTEXITCODE){throw 'Terminal bootstrap failed'}
'Simulation terminals created. Preload images and calibrate transfers before a DQN load.'
