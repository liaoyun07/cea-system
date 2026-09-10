param(
    [Parameter(Mandatory = $true)][string]$Image,
    [string]$BaseUrl = 'http://127.0.0.1:18085',
    [string]$Namespace = 'lab'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $env:BACKEND_USER -or -not $env:BACKEND_PASSWORD) { throw 'Set BACKEND_USER and BACKEND_PASSWORD first.' }
if ($Namespace -notmatch '^[A-Za-z][A-Za-z0-9_.-]{0,99}$') { throw 'Invalid namespace' }
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskAuth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$($env:BACKEND_USER):$($env:BACKEND_PASSWORD)"))
$taskHeaders = @{Authorization = "Basic $taskAuth"}
$taskApi = "$($BaseUrl.TrimEnd('/'))/api/namespaces/$Namespace"
function Send-Definition([string]$Method, [string]$Path, $Value) {
    $taskBody = $Value | ConvertTo-Json -Depth 40
    Invoke-RestMethod -Method $Method -Uri "$taskApi/$Path" -Headers $taskHeaders -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($taskBody))
}
# Existing cluster connections and real dataset objects are prerequisites, never created implicitly here.
foreach ($taskCluster in @('cloud', 'edge-a', 'edge-b', 'edge-c')) {
    $null = Invoke-RestMethod -Uri "$taskApi/resources/clusters/$taskCluster" -Headers $taskHeaders
}
$taskDatasets = Get-Content -LiteralPath (Join-Path $taskRoot 'examples/federated/datasets.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($taskDataset in $taskDatasets) {
    Send-Definition 'Put' "resources/datasets/$($taskDataset.datasetId)/versions/$($taskDataset.version)" $taskDataset
}
foreach ($taskAppId in @('fl-init', 'fedavg-train', 'fedprox-train', 'fl-aggregate', 'fl-evaluate')) {
    $taskContract = Get-Content -LiteralPath (Join-Path $taskRoot "examples/federated/contracts/$taskAppId.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    $taskContract.image = $Image
    Send-Definition 'Put' "applications/$taskAppId/versions/v1" $taskContract
}
foreach ($taskAlgorithm in @('fedavg', 'fedprox')) {
    $taskSource = Get-Content -LiteralPath (Join-Path $taskRoot "examples/federated/$taskAlgorithm.yaml") -Raw -Encoding UTF8
    $taskSource = $taskSource -replace '(?m)^namespace: lab\r?$', "namespace: $Namespace"
    Send-Definition 'Post' "flows/$taskAlgorithm/revisions" @{expectedRevision = 0; source = $taskSource}
}
Write-Output 'Registered FedAvg/FedProx contracts and Flow revisions. No executions submitted.'
