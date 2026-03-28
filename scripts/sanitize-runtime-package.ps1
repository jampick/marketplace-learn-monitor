param(
    [Parameter(Mandatory = $true)]
    [string]$PackageRoot
)

$ErrorActionPreference = "Stop"

$resolvedRoot = Resolve-Path $PackageRoot
$nodeModulesRoot = Join-Path $resolvedRoot "node_modules"

if (-not (Test-Path $nodeModulesRoot)) {
    Write-Host "No node_modules found at $nodeModulesRoot, nothing to sanitize."
    return
}

$removeDirectoryNames = @("test", "tests", "__tests__", "spec", "specs", "example", "examples", "docs", "doc", "sample", "samples")
$removeFilePatterns = @("*.ts", "*.d.ts", "*.map")

$directories = Get-ChildItem -Path $nodeModulesRoot -Directory -Recurse -Force |
    Where-Object { $removeDirectoryNames -contains $_.Name } |
    Sort-Object FullName -Descending

foreach ($directory in $directories) {
    Remove-Item $directory.FullName -Recurse -Force
}

foreach ($pattern in $removeFilePatterns) {
    Get-ChildItem -Path $nodeModulesRoot -File -Recurse -Force -Filter $pattern |
        Remove-Item -Force
}

$privateKeyMatches = Get-ChildItem -Path $nodeModulesRoot -File -Recurse -Force |
    Select-String -Pattern "BEGIN [A-Z ]*PRIVATE KEY|PRIVATE KEY-----" -SimpleMatch:$false

if ($privateKeyMatches) {
    $matchedFiles = $privateKeyMatches.Path | Sort-Object -Unique
    throw "Sensitive private-key-like content still present after sanitization:`n$($matchedFiles -join "`n")"
}

Write-Host "Sanitized runtime package at $resolvedRoot"
