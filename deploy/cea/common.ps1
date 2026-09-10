$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$taskDeployRoot = $PSScriptRoot
$taskRepository = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
function Invoke-CeaCompose {
    $taskPipedInput = @($input)
    if ($taskPipedInput.Count -gt 0) {
        $taskPipedInput | & docker compose --project-name cea --env-file (Join-Path $taskDeployRoot '.env') -f (Join-Path $taskDeployRoot 'compose.yaml') @args
    } else {
        & docker compose --project-name cea --env-file (Join-Path $taskDeployRoot '.env') -f (Join-Path $taskDeployRoot 'compose.yaml') @args
    }
    if ($LASTEXITCODE -ne 0) { throw "CEA compose operation failed (exit $LASTEXITCODE)" }
}
function Read-CeaSettings {
    $taskValues = @{}
    foreach ($taskLine in (Get-Content -LiteralPath (Join-Path $taskDeployRoot '.env'))) {
        if ($taskLine -match '^([A-Z_0-9]+)=(.*)$') { $taskValues[$matches[1]] = $matches[2] }
    }
    return $taskValues
}
function Write-CeaGeneratedFile([string]$Path, [string]$Content) {
    [IO.Directory]::CreateDirectory((Split-Path -Parent $Path)) | Out-Null
    [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}
function Get-CeaHeaders($Settings) {
    return @{Authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Settings.BACKEND_USER + ':' + $Settings.BACKEND_PASSWORD))}
}
