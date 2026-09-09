param(
    [string]$JavaHome,
    [string]$MavenCommand = 'mvn.cmd'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$taskRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'check-scaffold.ps1') -ProjectRoot $taskRoot

$taskPreviousJavaHome = [Environment]::GetEnvironmentVariable('JAVA_HOME', 'Process')
$taskPreviousPath = [Environment]::GetEnvironmentVariable('PATH', 'Process')
try {
    if ($JavaHome) {
        $taskJdk = (Resolve-Path -LiteralPath $JavaHome).Path
        if (-not (Test-Path -LiteralPath (Join-Path $taskJdk 'bin/javac.exe'))) {
            throw "Not a JDK: $taskJdk"
        }
        [Environment]::SetEnvironmentVariable('JAVA_HOME', $taskJdk, 'Process')
        [Environment]::SetEnvironmentVariable('PATH', ((Join-Path $taskJdk 'bin') + ';' + $taskPreviousPath), 'Process')
    }
    $taskMaven = (Get-Command $MavenCommand -ErrorAction Stop).Source
    & $taskMaven -version
    if ($LASTEXITCODE -ne 0) { throw "Maven version check failed: $LASTEXITCODE" }
    & $taskMaven -B -ntp -f (Join-Path $taskRoot 'pom.xml') verify
    if ($LASTEXITCODE -ne 0) { throw "Maven verify failed: $LASTEXITCODE" }
    Write-Output 'PASS: Maven verify. Inspect Surefire reports; includes S1-S3 regression, S4-01 resource catalog and S4-02a application catalog and explicit Flow boundary tests. Real external tasks are not yet implemented.'
} finally {
    [Environment]::SetEnvironmentVariable('JAVA_HOME', $taskPreviousJavaHome, 'Process')
    [Environment]::SetEnvironmentVariable('PATH', $taskPreviousPath, 'Process')
}
