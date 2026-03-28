param(
    [string]$ResourceGroupName = "",
    [string]$Location = "eastus",
    [string]$NamePrefix = "marketplacemon",
    [string]$FunctionAppName = "",
    [string]$BotName = "",
    [string]$StorageAccountName = "",
    [string]$SubscriptionId = "",
    [switch]$SkipTeamsChannel,
    [switch]$SkipTeamsPackage
)

$ErrorActionPreference = "Stop"

function New-RandomSuffix {
    $chars = "abcdefghijklmnopqrstuvwxyz0123456789".ToCharArray()
    -join (1..5 | ForEach-Object { $chars[(Get-Random -Minimum 0 -Maximum $chars.Length)] })
}

function Normalize-StorageName {
    param(
        [string]$Value
    )

    $normalized = ($Value.ToLower() -replace "[^a-z0-9]", "")
    if ($normalized.Length -lt 3) {
        $normalized = "$normalized" + "stor"
    }

    if ($normalized.Length -gt 24) {
        $normalized = $normalized.Substring(0, 24)
    }

    return $normalized
}

function Invoke-AzJson {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $result = az @Arguments --output json
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI command failed: az $($Arguments -join ' ')"
    }

    if (-not $result) {
        return $null
    }

    return $result | ConvertFrom-Json
}

function Invoke-Az {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    az @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI command failed: az $($Arguments -join ' ')"
    }
}

function Ensure-ProviderRegistered {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Namespace
    )

    $state = az provider show --namespace $Namespace --query registrationState --output tsv 2>$null
    if ($state -ne "Registered") {
        Write-Host "Registering resource provider $Namespace"
        Invoke-Az -Arguments @("provider", "register", "--namespace", $Namespace, "--output", "none")

        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Seconds 5
            $state = az provider show --namespace $Namespace --query registrationState --output tsv 2>$null
            if ($state -eq "Registered") {
                break
            }
        }
    }

    if ($state -ne "Registered") {
        throw "Resource provider $Namespace did not reach Registered state."
    }
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$artifactsDirectory = Join-Path $root "artifacts"
$stagingDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "marketplace-monitor-deploy"
$zipPath = Join-Path $artifactsDirectory "functionapp-package.zip"

Push-Location $root

try {
    if ($SubscriptionId) {
        az account set --subscription $SubscriptionId | Out-Null
    }

    $account = Invoke-AzJson -Arguments @("account", "show")
    if (-not $account) {
        throw "Azure CLI is not authenticated. Run 'az login' and try again."
    }

    $suffix = New-RandomSuffix
    if (-not $ResourceGroupName) {
        $ResourceGroupName = "rg-$NamePrefix-$suffix"
    }

    if (-not $FunctionAppName) {
        $FunctionAppName = ("$NamePrefix-$suffix-func").ToLower()
    }

    if (-not $BotName) {
        $BotName = ("$NamePrefix-$suffix-bot").ToLower()
    }

    if (-not $StorageAccountName) {
        $StorageAccountName = Normalize-StorageName -Value "$NamePrefix$suffix"
    }

    $botDisplayName = "Marketplace Learn Monitor"
    $aadAppDisplayName = "$botDisplayName $suffix"
    $appVersion = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version

    Ensure-ProviderRegistered -Namespace "Microsoft.Storage"
    Ensure-ProviderRegistered -Namespace "Microsoft.Web"
    Ensure-ProviderRegistered -Namespace "Microsoft.Insights"
    Ensure-ProviderRegistered -Namespace "Microsoft.BotService"

    Write-Host "Creating resource group $ResourceGroupName in $Location"
    Invoke-Az -Arguments @("group", "create", "--name", $ResourceGroupName, "--location", $Location, "--output", "none")

    Write-Host "Creating storage account $StorageAccountName"
    Invoke-Az -Arguments @(
        "storage", "account", "create",
        "--name", $StorageAccountName,
        "--resource-group", $ResourceGroupName,
        "--location", $Location,
        "--sku", "Standard_LRS",
        "--kind", "StorageV2",
        "--allow-blob-public-access", "false",
        "--output", "none"
    )

    $storageConnectionString = az storage account show-connection-string `
        --name $StorageAccountName `
        --resource-group $ResourceGroupName `
        --query connectionString `
        --output tsv

    Write-Host "Creating Azure Function App $FunctionAppName"
    Invoke-Az -Arguments @(
        "functionapp", "create",
        "--resource-group", $ResourceGroupName,
        "--name", $FunctionAppName,
        "--storage-account", $StorageAccountName,
        "--consumption-plan-location", $Location,
        "--functions-version", "4",
        "--runtime", "node",
        "--runtime-version", "20",
        "--os-type", "Linux",
        "--output", "none"
    )

    Write-Host "Creating Microsoft Entra app registration"
    $appRegistration = Invoke-AzJson -Arguments @(
        "ad", "app", "create",
        "--display-name", $aadAppDisplayName,
        "--sign-in-audience", "AzureADMyOrg"
    )
    if (-not $appRegistration) {
        throw "Failed to create Microsoft Entra app registration."
    }

    $credential = Invoke-AzJson -Arguments @(
        "ad", "app", "credential", "reset",
        "--id", $appRegistration.appId,
        "--append",
        "--display-name", "marketplace-monitor-bot-secret",
        "--years", "2"
    )
    if (-not $credential) {
        throw "Failed to create Microsoft Entra app secret."
    }

    Invoke-Az -Arguments @("ad", "sp", "create", "--id", $appRegistration.appId, "--output", "none")

    $endpoint = "https://$FunctionAppName.azurewebsites.net/api/messages"
    Write-Host "Creating Azure Bot registration $BotName"
    Invoke-Az -Arguments @(
        "bot", "create",
        "--resource-group", $ResourceGroupName,
        "--name", $BotName,
        "--appid", $appRegistration.appId,
        "--tenant-id", $account.tenantId,
        "--app-type", "SingleTenant",
        "--endpoint", $endpoint,
        "--display-name", $botDisplayName,
        "--description", "Monitors Microsoft Marketplace docs and sends Teams digests.",
        "--sku", "F0",
        "--output", "none"
    )

    if (-not $SkipTeamsChannel) {
        Write-Host "Enabling Microsoft Teams channel on the bot"
        Invoke-Az -Arguments @(
            "bot", "msteams", "create",
            "--resource-group", $ResourceGroupName,
            "--name", $BotName,
            "--output", "none"
        )
    }

    $appSettings = @(
        "AzureWebJobsStorage=$storageConnectionString",
        "FUNCTIONS_WORKER_RUNTIME=node",
        "WEBSITE_NODE_DEFAULT_VERSION=~20",
        "WEBSITE_RUN_FROM_PACKAGE=1",
        "MicrosoftAppType=SingleTenant",
        "MicrosoftAppId=$($appRegistration.appId)",
        "MicrosoftAppPassword=$($credential.password)",
        "MicrosoftAppTenantId=$($account.tenantId)",
        "MARKETPLACE_LANDING_URL=https://learn.microsoft.com/en-us/partner-center/marketplace-offers/?accept=text/markdown",
        "PARTNER_CENTER_TOC_URL=https://learn.microsoft.com/en-us/partner-center/toc.json",
        "ALLOWED_DOC_PREFIXES=https://learn.microsoft.com/en-us/partner-center/",
        "DIGEST_SCHEDULE=0 0 14 * * *",
        "SEND_EMPTY_DIGESTS=false",
        "MAX_ANNOUNCEMENT_PAGES=6",
        "MONITOR_STORAGE_CONTAINER=marketplace-monitor"
    )

    foreach ($key in "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_DEPLOYMENT", "AZURE_OPENAI_API_VERSION") {
        $envValue = [Environment]::GetEnvironmentVariable($key)
        if ($envValue) {
            $appSettings += "$key=$envValue"
        }
    }

    Write-Host "Applying Function App settings"
    $appSettingsArguments = @(
        "functionapp", "config", "appsettings", "set",
        "--resource-group", $ResourceGroupName,
        "--name", $FunctionAppName,
        "--settings"
    )
    $appSettingsArguments += $appSettings
    $appSettingsArguments += @("--output", "none")

    Invoke-Az -Arguments $appSettingsArguments

    Write-Host "Building the project"
    npm run build | Out-Host

    Write-Host "Preparing deployment package"
    if (Test-Path $stagingDirectory) {
        Remove-Item $stagingDirectory -Recurse -Force
    }
    if (Test-Path $zipPath) {
        Remove-Item $zipPath -Force
    }

    New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null
    New-Item -ItemType Directory -Path $artifactsDirectory -Force | Out-Null

    Write-Host "  Copying dist, host.json, package.json"
    Copy-Item ".\dist" $stagingDirectory -Recurse -Force
    Copy-Item ".\package.json" $stagingDirectory -Force
    Copy-Item ".\host.json" $stagingDirectory -Force

    Write-Host "  Installing production dependencies (this replaces copying node_modules)"
    Push-Location $stagingDirectory
    try {
        npm install --omit=dev --ignore-scripts --no-audit --no-fund 2>&1 | Out-Null
    }
    finally {
        Pop-Location
    }

    Write-Host "  Sanitizing package"
    & (Join-Path $PSScriptRoot "sanitize-runtime-package.ps1") -PackageRoot $stagingDirectory

    $fileCount = (Get-ChildItem $stagingDirectory -Recurse -File).Count
    Write-Host "  Package contains $fileCount files"

    Write-Host "  Creating zip"
    Compress-Archive -Path (Join-Path $stagingDirectory "*") -DestinationPath $zipPath
    $zipSizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
    Write-Host "  Package size: ${zipSizeMB} MB"

    Write-Host "Deploying package to Azure Function App (this may take 1-3 minutes)"
    Invoke-Az -Arguments @(
        "functionapp", "deployment", "source", "config-zip",
        "--resource-group", $ResourceGroupName,
        "--name", $FunctionAppName,
        "--src", $zipPath,
        "--timeout", "1200",
        "--output", "none"
    )

    if (-not $SkipTeamsPackage) {
        Write-Host "Packaging Teams app manifest"
        & (Join-Path $PSScriptRoot "package-teams-app.ps1") `
            -BotAppId $appRegistration.appId `
            -TeamsAppId $appRegistration.appId `
            -FunctionHostname "$FunctionAppName.azurewebsites.net" `
            -OutputDirectory $artifactsDirectory
    }

    $deploymentOutput = [ordered]@{
        appVersion          = $appVersion
        subscriptionId      = $account.id
        tenantId            = $account.tenantId
        resourceGroupName   = $ResourceGroupName
        location            = $Location
        functionAppName     = $FunctionAppName
        functionEndpoint    = $endpoint
        botName             = $BotName
        botAppId            = $appRegistration.appId
        teamsPackagePath    = if ($SkipTeamsPackage) { $null } else { (Join-Path $artifactsDirectory "marketplace-learn-monitor-teams-app.zip") }
        healthUrl           = "https://$FunctionAppName.azurewebsites.net/api/health"
    }

    $deploymentOutputPath = Join-Path $artifactsDirectory "deployment-output.json"
    $deploymentOutput | ConvertTo-Json -Depth 5 | Set-Content -Path $deploymentOutputPath -Encoding UTF8

    Write-Host ""
    Write-Host "Deployment complete."
    Write-Host "Function endpoint: $endpoint"
    Write-Host "Health endpoint: https://$FunctionAppName.azurewebsites.net/api/health"
    Write-Host "Teams package: $(if ($SkipTeamsPackage) { 'skipped' } else { Join-Path $artifactsDirectory 'marketplace-learn-monitor-teams-app.zip' })"
    Write-Host "Deployment metadata saved to $deploymentOutputPath"
}
finally {
    Pop-Location
}
