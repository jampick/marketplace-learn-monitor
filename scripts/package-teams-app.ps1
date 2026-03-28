param(
    [string]$BotAppId = $env:MICROSOFT_APP_ID,
    [string]$TeamsAppId = $env:TEAMS_APP_ID,
    [string]$FunctionHostname = $env:FUNCTION_HOSTNAME,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\artifacts")
)

$ErrorActionPreference = "Stop"

if (-not $BotAppId) {
    $BotAppId = $env:MicrosoftAppId
}

if (-not $TeamsAppId) {
    $TeamsAppId = $BotAppId
}

if (-not $BotAppId) {
    throw "BotAppId is required. Set MicrosoftAppId or pass -BotAppId."
}

if (-not $FunctionHostname) {
    throw "FunctionHostname is required. Pass -FunctionHostname or set FUNCTION_HOSTNAME."
}

$teamsAppRoot = Join-Path $PSScriptRoot "..\teamsapp"
$assetsPath = Join-Path $teamsAppRoot "assets"
$buildPath = Join-Path $teamsAppRoot "build"
$appVersion = (Get-Content (Join-Path $PSScriptRoot "..\package.json") -Raw | ConvertFrom-Json).version

& (Join-Path $PSScriptRoot "generate-icons.ps1") -OutputDirectory $assetsPath

New-Item -ItemType Directory -Path $buildPath -Force | Out-Null
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$manifestTemplate = Get-Content (Join-Path $teamsAppRoot "manifest.template.json") -Raw
$manifest = $manifestTemplate `
    -replace "{{APP_VERSION}}", [Regex]::Escape($appVersion).Replace("\", "") `
    -replace "{{TEAMS_APP_ID}}", [Regex]::Escape($TeamsAppId).Replace("\", "") `
    -replace "{{BOT_APP_ID}}", [Regex]::Escape($BotAppId).Replace("\", "") `
    -replace "{{FUNCTION_HOSTNAME}}", [Regex]::Escape($FunctionHostname).Replace("\", "")

$manifestPath = Join-Path $buildPath "manifest.json"
Set-Content -Path $manifestPath -Value $manifest -Encoding UTF8

Copy-Item (Join-Path $assetsPath "color.png") (Join-Path $buildPath "color.png") -Force
Copy-Item (Join-Path $assetsPath "outline.png") (Join-Path $buildPath "outline.png") -Force

$zipPath = Join-Path $OutputDirectory "marketplace-learn-monitor-teams-app.zip"
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

Compress-Archive -Path (Join-Path $buildPath "*") -DestinationPath $zipPath
Write-Host "Created Teams app package at $zipPath"

