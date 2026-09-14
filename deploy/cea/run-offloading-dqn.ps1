# Active workload, not a read-only check. Creates OFF-04 policies/models/executions.
param([string]$RunName = ('pilot-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')))
. (Join-Path $PSScriptRoot 'common.ps1')
if($RunName -notmatch '^pilot-[a-zA-Z0-9-]+$') {throw 'Use a pilot- name containing letters, numbers and dashes'}
$taskEvidence=Join-Path $taskRepository '.local/cea/off04'
if(-not (Test-Path (Join-Path $taskEvidence 'release.json'))) {throw 'Publish and verify CEA OFF-04 before collecting'}
if(Test-Path (Join-Path $taskEvidence $RunName)) {throw 'Experiment output already exists; do not overwrite or silently retry'}
$taskSettings=Read-CeaSettings
$taskHeaders=Get-CeaHeaders $taskSettings
$taskApi="http://127.0.0.1:$($taskSettings.CEA_API_PORT)/api/namespaces/lab"
$taskExisting=Invoke-RestMethod "$taskApi/edge/policies?limit=100&offset=0" -Headers $taskHeaders
if(@($taskExisting | Where-Object id -Like 'off04-*').Count) {throw 'OFF-04 research policies already exist; inspect prior results before starting another experiment'}
# Generated private subset, not the Registry/database credentials in the full .env.
$taskCredentialPath=Join-Path $taskEvidence 'pilot.env'
Write-CeaGeneratedFile $taskCredentialPath ("BACKEND_USER="+$taskSettings.BACKEND_USER+"`nBACKEND_PASSWORD="+$taskSettings.BACKEND_PASSWORD+"`n")
$taskRepositoryDocker=$taskRepository.Replace('\','/')
$taskArguments=@('run','--rm','--name','cea-off04-pilot','--network','cea_default','--read-only','--cap-drop','ALL',
    '--security-opt','no-new-privileges','--memory','1g','--tmpfs','/tmp:rw,noexec,nosuid,size=128m',
    '-v',"${taskRepositoryDocker}/algorithms/offloading:/research:ro",
    '-v',"${taskRepositoryDocker}/deploy/terminal-agent:/terminal-client:ro",
    '-v',"${taskRepositoryDocker}/deploy/cea/secrets/edge/terminal.json:/run/secrets/terminal.json:ro",
    '-v',"${taskRepositoryDocker}/.local/cea/off04/pilot.env:/run/secrets/cea.env:ro",
    '-v',"${taskRepositoryDocker}/.local/cea/off02/signal-manifest.json:/manifest.json:ro",
    '-v',"${taskRepositoryDocker}/.local/cea/off02/terminal:/data",
    '-v',"${taskRepositoryDocker}/.local/cea/off04:/evidence",
    '--entrypoint','python','cea/federated:deploy-v1','-B','/research/experiment.py','--output',"/evidence/$RunName")
& docker @taskArguments
if($LASTEXITCODE) {throw "Pilot failed; keep $RunName receipts and inspect before taking further action"}
"Completed $RunName; inspect comparison.json, then verify preserved CEA objects."
