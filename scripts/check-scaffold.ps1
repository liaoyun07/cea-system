param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$taskRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$taskErrors = [System.Collections.Generic.List[string]]::new()

function Read-Pom([string]$Path) {
    return [xml](Get-Content -LiteralPath $Path -Raw -Encoding UTF8)
}
function Read-PomNodes([xml]$Pom, [string]$XPath) {
    $taskNs = [System.Xml.XmlNamespaceManager]::new($Pom.NameTable)
    $taskNs.AddNamespace('m', 'http://maven.apache.org/POM/4.0.0')
    return @($Pom.SelectNodes($XPath, $taskNs))
}
function Visit-Module([string]$Name) {
    if ($taskVisiting.Contains($Name)) {
        $taskErrors.Add("Dependency cycle at $Name")
        return
    }
    if ($taskVisited.Contains($Name)) { return }
    [void]$taskVisiting.Add($Name)
    foreach ($taskDependency in $taskGraph[$Name]) {
        if ($taskGraph.ContainsKey($taskDependency)) { Visit-Module $taskDependency }
    }
    [void]$taskVisiting.Remove($Name)
    [void]$taskVisited.Add($Name)
}

$taskRequired = @(
    'README.md', 'AGENTS.md', 'pom.xml',
    'docs/00-overview.md', 'docs/01-code-architecture.md',
    'docs/02-feature-index.md', 'docs/03-implementation-plan.md',
    'docs/04-progress.md', 'docs/05-documentation-guide.md',
    'docs/decisions/ADR-0001-module-boundaries.md',
    'docs/decisions/ADR-0002-scaffold-only.md',
    'docs/features/FND-001-scaffold.md', 'docs/features/TEMPLATE.md',
    'docs/contracts/README.md', 'docs/migration/README.md',
    'docs/verification/TEMPLATE.md'
)
foreach ($taskRelative in $taskRequired) {
    if (-not (Test-Path -LiteralPath (Join-Path $taskRoot $taskRelative))) {
        $taskErrors.Add("Missing required file: $taskRelative")
    }
}
if ($taskErrors.Count -gt 0) { throw ($taskErrors -join [Environment]::NewLine) }

$taskParent = Read-Pom (Join-Path $taskRoot 'pom.xml')
$taskModules = @(Read-PomNodes $taskParent '/m:project/m:modules/m:module' | ForEach-Object { $_.InnerText })
$taskGroup = @(Read-PomNodes $taskParent '/m:project/m:groupId')[0].InnerText
$taskVersion = @(Read-PomNodes $taskParent '/m:project/m:version')[0].InnerText
if ($taskModules.Count -ne (@($taskModules | Select-Object -Unique)).Count) {
    $taskErrors.Add('Duplicate Maven module')
}
$taskCodeIndex = Get-Content -LiteralPath (Join-Path $taskRoot 'docs/01-code-architecture.md') -Raw -Encoding UTF8
$taskRules = @{}
foreach ($taskMatch in [regex]::Matches($taskCodeIndex, '(?m)^\| ((?:platform|workflow)-[a-z-]+) \| ([^|\r\n]+) \|\r?$')) {
    $taskRuleName = $taskMatch.Groups[1].Value
    if ($taskRules.ContainsKey($taskRuleName)) { $taskErrors.Add("Duplicate module rule: $taskRuleName") }
    $taskRules[$taskRuleName] = @([regex]::Matches($taskMatch.Groups[2].Value, '(?:platform|workflow)-[a-z-]+') | ForEach-Object { $_.Value })
}
if ($taskRules.Count -ne $taskModules.Count) { $taskErrors.Add('Module documentation and POM module counts differ') }

$taskGraph = @{}
$taskJavaFiles = @()
foreach ($taskModule in $taskModules) {
    $taskModuleRoot = Join-Path $taskRoot $taskModule
    $taskPomPath = Join-Path $taskModuleRoot 'pom.xml'
    if (-not (Test-Path -LiteralPath $taskPomPath)) {
        $taskErrors.Add("Missing module POM: $taskModule")
        continue
    }
    $taskPom = Read-Pom $taskPomPath
    $taskArtifact = @(Read-PomNodes $taskPom '/m:project/m:artifactId')[0].InnerText
    if ($taskArtifact -ne $taskModule) { $taskErrors.Add("Artifact/module mismatch: $taskModule") }
    foreach ($taskField in @('groupId','version')) {
        $taskActual = @(Read-PomNodes $taskPom "/m:project/m:parent/m:$taskField")[0].InnerText
        $taskExpected = if ($taskField -eq 'groupId') { $taskGroup } else { $taskVersion }
        if ($taskActual -ne $taskExpected) { $taskErrors.Add("Parent $taskField mismatch: $taskModule") }
    }
    $taskParentArtifact = @(Read-PomNodes $taskPom '/m:project/m:parent/m:artifactId')[0].InnerText
    if ($taskParentArtifact -ne 'backend-parent') { $taskErrors.Add("Unexpected parent: $taskModule") }
    $taskDeps = @()
    foreach ($taskDep in (Read-PomNodes $taskPom '/m:project/m:dependencies/m:dependency')) {
        if ($taskDep.groupId -eq $taskGroup) {
            $taskDeps += [string]$taskDep.artifactId
            if ($taskModules -notcontains [string]$taskDep.artifactId) { $taskErrors.Add("Unknown project dependency: $taskModule -> $($taskDep.artifactId)") }
        }
        if ([string]$taskDep.groupId -eq 'com.project.web.platform') {
            $taskErrors.Add("Legacy dependency: $taskModule")
        }
    }
    $taskGraph[$taskModule] = $taskDeps
    if (-not $taskRules.ContainsKey($taskModule)) {
        $taskErrors.Add("Missing dependency rule: $taskModule")
    } else {
        $taskActualDeps = ($taskDeps | Sort-Object) -join ','
        $taskExpectedDeps = ($taskRules[$taskModule] | Sort-Object) -join ','
        if ($taskActualDeps -cne $taskExpectedDeps) { $taskErrors.Add("Documented dependencies differ: $taskModule") }
    }
    $taskSrc = Join-Path $taskModuleRoot 'src/main/java'
    if (-not (Test-Path -LiteralPath $taskSrc)) {
        $taskErrors.Add("Missing Java source root: $taskModule")
    } else {
        $taskJavaFiles += @(Get-ChildItem -LiteralPath $taskSrc -Filter '*.java' -File -Recurse)
    }
}
$taskVisiting = [System.Collections.Generic.HashSet[string]]::new()
$taskVisited = [System.Collections.Generic.HashSet[string]]::new()
foreach ($taskModule in $taskModules) { if ($taskGraph.ContainsKey($taskModule)) { Visit-Module $taskModule } }

$taskIndexed = @([regex]::Matches($taskCodeIndex, '(?m)^\| \x60([^\x60]+\.java)\x60 \|') | ForEach-Object { $_.Groups[1].Value })
if ($taskIndexed.Count -ne (@($taskIndexed | Select-Object -Unique)).Count) { $taskErrors.Add('Duplicate Java index path') }
$taskActualJava = @($taskJavaFiles | ForEach-Object { $_.FullName.Substring($taskRoot.Length + 1).Replace('\','/') })
foreach ($taskPath in $taskActualJava) {
    if ($taskIndexed -notcontains $taskPath) { $taskErrors.Add("Unindexed Java file: $taskPath") }
}
foreach ($taskPath in $taskIndexed) {
    if ($taskActualJava -notcontains $taskPath) { $taskErrors.Add("Indexed Java file missing: $taskPath") }
}

$taskFeatureText = Get-Content -LiteralPath (Join-Path $taskRoot 'docs/02-feature-index.md') -Raw -Encoding UTF8
$taskFeatures = @([regex]::Matches($taskFeatureText, '(?m)^\| ([A-Z]+-\d{3}) \|') | ForEach-Object { $_.Groups[1].Value })
if ($taskFeatures.Count -eq 0) { $taskErrors.Add('No feature IDs') }
if ($taskFeatures.Count -ne (@($taskFeatures | Select-Object -Unique)).Count) { $taskErrors.Add('Duplicate feature ID') }

$taskMarkdown = @(
    Get-Item -LiteralPath (Join-Path $taskRoot 'README.md')
    Get-Item -LiteralPath (Join-Path $taskRoot 'AGENTS.md')
    Get-ChildItem -LiteralPath (Join-Path $taskRoot 'docs') -Filter '*.md' -File -Recurse
    foreach ($taskModule in $taskModules) {
        Get-Item -LiteralPath (Join-Path $taskRoot "$taskModule/README.md")
    }
)
$taskLinkCount = 0
foreach ($taskDoc in $taskMarkdown) {
    $taskText = Get-Content -LiteralPath $taskDoc.FullName -Raw -Encoding UTF8
    foreach ($taskMatch in [regex]::Matches($taskText, '(?<!\!)\[[^\]\r\n]*\]\(([^)\r\n]+)\)')) {
        $taskTarget = $taskMatch.Groups[1].Value.Trim('<','>')
        if ($taskTarget -match '^(https?://|mailto:|#)') { continue }
        $taskTarget = ($taskTarget -split '#',2)[0]
        $taskTarget = [Uri]::UnescapeDataString($taskTarget)
        $taskResolved = Join-Path $taskDoc.DirectoryName $taskTarget
        $taskLinkCount++
        if (-not (Test-Path -LiteralPath $taskResolved)) { $taskErrors.Add("Broken link in $($taskDoc.Name): $taskTarget") }
    }
    foreach ($taskMatch in [regex]::Matches($taskText, '\b(?:FND|WF|RES|DEP|RUN|EDGE|OFF|MET|SEC|MIG|OPS)-\d{3}\b')) {
        if ($taskFeatures -notcontains $taskMatch.Value) { $taskErrors.Add("Unknown feature ID in $($taskDoc.Name): $($taskMatch.Value)") }
    }
}
if ($taskErrors.Count -gt 0) { throw ($taskErrors -join [Environment]::NewLine) }
Write-Output "PASS: $($taskModules.Count) modules; acyclic documented dependencies; $($taskActualJava.Count) indexed Java files; $($taskFeatures.Count) feature IDs; $taskLinkCount local links."
Write-Output 'Scope: structure and documentation only, not business or class-level architecture tests.'
