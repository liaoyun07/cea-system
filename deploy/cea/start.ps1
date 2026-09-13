# Start/reconcile only Compose project cea. Does not seed or submit business flows.
. (Join-Path $PSScriptRoot 'common.ps1')
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.env'))) { throw 'Run initialize.ps1 first.' }
Invoke-CeaCompose config --quiet
Invoke-CeaCompose up -d --wait --wait-timeout 600 mysql minio registry-center registry-edge-a registry-edge-b registry-edge-c cloud edge-a edge-b edge-c
foreach ($taskCluster in @('cloud','edge-a','edge-b','edge-c')) {
    Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'rbac.yaml') | Invoke-CeaCompose exec -T $taskCluster kubectl apply -f -
    Invoke-CeaCompose exec -T $taskCluster kubectl wait --for=condition=Ready nodes --all --timeout=120s
    $taskAdmin = (Invoke-CeaCompose exec -T $taskCluster kubectl config view --raw -o json) | ConvertFrom-Json
    $taskToken = $null
    for ($taskTry = 0; $taskTry -lt 20; $taskTry++) {
        $taskSecret = (Invoke-CeaCompose exec -T $taskCluster kubectl get secret cea-backend-token -n cea-lab -o json) | ConvertFrom-Json
        if ($taskSecret.PSObject.Properties.Name -contains 'data' -and $taskSecret.data.PSObject.Properties.Name -contains 'token') {
            $taskToken = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($taskSecret.data.token))
            break
        }
        Start-Sleep -Seconds 1
    }
    if (-not $taskToken) { throw "ServiceAccount token not ready: $taskCluster" }
    $taskKube = @{
        apiVersion='v1';kind='Config';'current-context'='cea'
        clusters=@(@{name='cea';cluster=@{server="https://${taskCluster}:6443";'certificate-authority-data'=$taskAdmin.clusters[0].cluster.'certificate-authority-data'}})
        contexts=@(@{name='cea';context=@{cluster='cea';user='cea-backend';namespace='cea-lab'}})
        users=@(@{name='cea-backend';user=@{token=$taskToken}})
    }
    Write-CeaGeneratedFile (Join-Path $PSScriptRoot "secrets/backend/$taskCluster.yaml") ($taskKube | ConvertTo-Json -Depth 8)
}
Invoke-CeaCompose run --rm --no-deps storage-tool -ec 'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; mc mb --ignore-existing local/datasets local/cea-artifacts; mc admin user add local "$CEA_S3_ACCESS_KEY" "$CEA_S3_SECRET_KEY" >/dev/null; mc admin policy create local cea-backend /config/s3-policy.json; mc admin policy attach local cea-backend --user "$CEA_S3_ACCESS_KEY"'
& (Join-Path $PSScriptRoot 'setup-files.ps1')
Invoke-CeaCompose up -d --wait --wait-timeout 240 backend frontend
# A recreated backend can have a different private IP; refresh nginx's upstream DNS.
Invoke-CeaCompose exec -T frontend nginx -s reload
Invoke-CeaCompose ps
Write-Output 'CEA is ready. This script did not register applications/datasets/flows or create executions.'
