param([string]$Version = 'met04-v1')
$ErrorActionPreference = 'Stop'
$taskRepo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskData = Join-Path $taskRepo '.local/cea/edge-processing'
$taskEvidence = Join-Path $taskRepo ".local/cea/met04/$Version"
$taskFixtures = Join-Path $taskEvidence 'fixtures'
[IO.Directory]::CreateDirectory($taskFixtures) | Out-Null
& docker run --rm --network none --memory 2g --cpus 2 --read-only --tmpfs /tmp:rw,size=128m --mount "type=bind,source=$taskData,target=/data,readonly" --mount "type=bind,source=$taskFixtures,target=/evidence" --mount "type=bind,source=$PSScriptRoot/prepare_cases.py,target=/app/prepare_cases.py,readonly" cea/edge-processing:ep01-v1 python /app/prepare_cases.py
if ($LASTEXITCODE -ne 0) { throw 'Reference probe preparation failed' }
foreach ($taskSize in @('small', 'medium', 'large')) {
    $taskImage = "cea/edge-service-${taskSize}:$Version"
    & docker build --platform linux/amd64 --build-context "models=$taskData/models" --target $taskSize -f "$PSScriptRoot/Dockerfile" -t $taskImage $taskRepo
    if ($LASTEXITCODE -ne 0) { throw "Image build failed: $taskSize" }
    & docker run --rm --network none --memory 2g --cpus 1 --read-only --tmpfs /tmp:rw,size=64m --cap-drop ALL --security-opt no-new-privileges --mount "type=bind,source=$PSScriptRoot/test_server.py,target=/app/test_server.py,readonly" --mount "type=bind,source=$taskFixtures,target=/fixtures,readonly" $taskImage python -m unittest -v test_server
    if ($LASTEXITCODE -ne 0) { throw "HTTP/model tests failed: $taskSize" }
    $taskArchive = Join-Path $taskEvidence "$taskSize.tar"
    if (Test-Path -LiteralPath $taskArchive) { throw "Archive exists, preserve it: $taskArchive" }
    & docker save --output $taskArchive $taskImage
    if ($LASTEXITCODE -ne 0) { throw "Image archive export failed: $taskSize" }
    Get-Item -LiteralPath $taskArchive | Select-Object Name,Length
}
