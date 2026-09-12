$ErrorActionPreference = 'Stop'
$taskRepo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskImage = 'cea/deployment-demo:v1'
$taskOutput = Join-Path $taskRepo '.local/images/cea-deployment-demo-v1.tar'
if (Test-Path -LiteralPath $taskOutput) { throw "Archive already exists; preserve or rename it before rebuilding: $taskOutput" }
& docker build --platform linux/amd64 -t $taskImage $PSScriptRoot
if ($LASTEXITCODE -ne 0) { throw 'Image build failed' }
$taskTests = Join-Path $PSScriptRoot 'test_app.py'
& docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --mount "type=bind,source=$taskTests,target=/app/test_app.py,readonly" $taskImage python -m unittest -v test_app
if ($LASTEXITCODE -ne 0) { throw 'Image HTTP tests failed' }
[IO.Directory]::CreateDirectory((Split-Path -Parent $taskOutput)) | Out-Null
& docker save --output $taskOutput $taskImage
if ($LASTEXITCODE -ne 0) { throw 'Image archive export failed' }
Get-Item -LiteralPath $taskOutput | Select-Object FullName,Length
