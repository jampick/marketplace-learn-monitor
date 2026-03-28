param(
    [string]$FunctionAppName = ""
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$artifactsDirectory = Join-Path $root "artifacts"
$deploymentOutputPath = Join-Path $artifactsDirectory "deployment-output.json"

if (-not $FunctionAppName -and (Test-Path $deploymentOutputPath)) {
    $previous = Get-Content $deploymentOutputPath -Raw | ConvertFrom-Json
    $FunctionAppName = $previous.functionAppName
}

if (-not $FunctionAppName) {
    throw "No previous deployment found. Run 'npm run deploy' first, or pass -FunctionAppName."
}

$stagingDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "marketplace-monitor-redeploy"

Push-Location $root
try {
    Write-Host "Building"
    npm run build | Out-Host

    Write-Host "Staging deployment package"
    if (Test-Path $stagingDirectory) {
        Remove-Item $stagingDirectory -Recurse -Force
    }
    New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null

    Copy-Item ".\dist" $stagingDirectory -Recurse -Force
    Copy-Item ".\package.json" $stagingDirectory -Force
    Copy-Item ".\host.json" $stagingDirectory -Force

    Push-Location $stagingDirectory
    try {
        npm install --omit=dev --ignore-scripts --no-audit --no-fund 2>&1 | Out-Null
    }
    finally {
        Pop-Location
    }

    & (Join-Path $PSScriptRoot "sanitize-runtime-package.ps1") -PackageRoot $stagingDirectory

    Write-Host "Publishing to $FunctionAppName"
    Push-Location $stagingDirectory
    try {
        func azure functionapp publish $FunctionAppName --javascript
        if ($LASTEXITCODE -ne 0) {
            throw "Publish failed."
        }
    }
    finally {
        Pop-Location
    }

    $healthUrl = "https://$FunctionAppName.azurewebsites.net/api/health"
    Write-Host ""
    Write-Host "Redeploy complete. Health: $healthUrl"
}
finally {
    Pop-Location
}
