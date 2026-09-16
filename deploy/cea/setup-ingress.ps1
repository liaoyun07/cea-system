# Run only after ING-01 infrastructure approval. Does not restart K3s or change business resources.
. (Join-Path $PSScriptRoot 'common.ps1')
$taskSettings = Read-CeaSettings
& docker image inspect traefik:v3.7.13 --format '{{.Id}}' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    & docker pull traefik:v3.7.13
    if ($LASTEXITCODE -ne 0) { throw 'Traefik image pull failed' }
}
$taskArchive = Join-Path $taskRepository '.local/cea/ing01-traefik.tar'
[IO.Directory]::CreateDirectory((Split-Path -Parent $taskArchive)) | Out-Null
& docker save -o $taskArchive traefik:v3.7.13
if ($LASTEXITCODE -ne 0) { throw 'Traefik image save failed' }
$taskTargets = @(
    @{Cluster='cloud'; Key='CEA_INGRESS_CLOUD_PORT'; Port=18090},
    @{Cluster='edge-a'; Key='CEA_INGRESS_EDGE_A_PORT'; Port=18091},
    @{Cluster='edge-b'; Key='CEA_INGRESS_EDGE_B_PORT'; Port=18092},
    @{Cluster='edge-c'; Key='CEA_INGRESS_EDGE_C_PORT'; Port=18093}
)
foreach ($taskTarget in $taskTargets) {
    $taskCluster = $taskTarget.Cluster
    Invoke-CeaCompose cp $taskArchive "${taskCluster}:/tmp/ing01-traefik.tar"
    Invoke-CeaCompose exec -T $taskCluster ctr images import /tmp/ing01-traefik.tar
    Invoke-CeaCompose cp (Join-Path $PSScriptRoot 'ingress-controller.yaml') "${taskCluster}:/tmp/ing01-controller.yaml"
    Invoke-CeaCompose exec -T $taskCluster kubectl apply -f /tmp/ing01-controller.yaml
    Invoke-CeaCompose cp (Join-Path $PSScriptRoot 'rbac.yaml') "${taskCluster}:/tmp/ing01-rbac.yaml"
    Invoke-CeaCompose exec -T $taskCluster kubectl apply -f /tmp/ing01-rbac.yaml
    $taskPort = if ($taskSettings.ContainsKey($taskTarget.Key)) { $taskSettings[$taskTarget.Key] } else { $taskTarget.Port }
    Invoke-CeaCompose exec -T $taskCluster kubectl annotate ingressclass cea-traefik "cea-system/http-entrypoint=http://127.0.0.1:$taskPort" --overwrite
    Invoke-CeaCompose exec -T $taskCluster kubectl rollout status deployment/cea-traefik -n cea-ingress --timeout=60s
}
Invoke-CeaCompose up -d --no-deps --wait ingress-access
'ING-01 controller/entry bridge deployed. Verify Host/path routing before marking acceptance PASS.'
