[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectId = 'studywnoteflix'
$region = 'us-central1'
$serviceName = 'noteflix-openai-mcp'
$secretName = 'noteflix-openai-mcp-apps-challenge'
$runtimeServiceAccount = 'noteflix-openai-mcp@studywnoteflix.iam.gserviceaccount.com'
$publicOrigin = 'https://chatgpt.noteflix.com'
$challengePath = '/.well-known/openai-apps-challenge'
$reviewedImage = 'us-central1-docker.pkg.dev/studywnoteflix/cloud-run-source-deploy/noteflix-openai-mcp@sha256:7300861d875efc2e4a63c77f13e480011d88c735e1f2af870019eccf2c15e6d5'

$challengeToken = $null
$challengeTokenSecure = $null
$tokenFile = $null
$previousRevision = $null
$newRevision = $null
$trafficPromoted = $false
$tag = $null
$configurationMode = $null
$challengeVersion = $null

function Invoke-Gcloud {
    param(
        [Parameter(Mandatory)]
        [string[]] $Arguments,

        [switch] $AllowFailure
    )

    $output = & gcloud @Arguments
    $exitCode = $LASTEXITCODE
    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "gcloud failed with exit code $exitCode."
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = @($output)
    }
}

function Test-ChallengeEndpoint {
    param(
        [Parameter(Mandatory)]
        [string] $Origin,

        [Parameter(Mandatory)]
        [string] $ExpectedToken
    )

    $uri = "$($Origin.TrimEnd('/'))$challengePath"
    try {
        $response = Invoke-WebRequest -Uri $uri -Method Get -TimeoutSec 30 -MaximumRedirection 0
    }
    catch {
        return $false
    }

    if ($response.StatusCode -ne 200) {
        return $false
    }

    if ([string]$response.Content -cne $ExpectedToken) {
        return $false
    }

    $contentType = [string]$response.Headers['Content-Type']
    if ($contentType -notmatch '^text/plain(?:;|$)') {
        return $false
    }

    $cacheControl = [string]$response.Headers['Cache-Control']
    if ($cacheControl -notmatch '(?:^|,\s*)no-store(?:\s*,|$)') {
        return $false
    }

    return $true
}

function Remove-TrafficTag {
    param(
        [string] $TrafficTag,
        [switch] $BestEffort
    )

    if ([string]::IsNullOrWhiteSpace($TrafficTag)) {
        return
    }

    $removeResult = Invoke-Gcloud -AllowFailure -Arguments @(
        'run', 'services', 'update-traffic', $serviceName,
        '--project', $projectId,
        '--region', $region,
        '--remove-tags', $TrafficTag,
        '--quiet'
    )
    if ($removeResult.ExitCode -ne 0) {
        if ($BestEffort) {
            return
        }
        throw 'Could not remove the temporary staged-traffic tag.'
    }

    $verifyResult = Invoke-Gcloud -AllowFailure -Arguments @(
        'run', 'services', 'describe', $serviceName,
        '--project', $projectId,
        '--region', $region,
        '--format=json'
    )
    if ($verifyResult.ExitCode -ne 0) {
        if ($BestEffort) {
            return
        }
        throw 'Could not verify removal of the temporary staged-traffic tag.'
    }

    $verifiedService = ($verifyResult.Output -join "`n") | ConvertFrom-Json
    if (@($verifiedService.status.traffic) | Where-Object { $_.tag -eq $TrafficTag }) {
        if ($BestEffort) {
            return
        }
        throw 'The temporary staged-traffic tag still exists after cleanup.'
    }
}

try {
    if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
        throw 'gcloud is not available on PATH.'
    }

    $challengeTokenSecure = Read-Host 'Marketplace challenge token' -AsSecureString
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($challengeTokenSecure)
    try {
        $challengeToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    }

    if ([string]::IsNullOrWhiteSpace($challengeToken)) {
        throw 'The challenge token cannot be empty.'
    }

    if ($challengeToken.Length -gt 512 -or $challengeToken -ne $challengeToken.Trim() -or $challengeToken.Contains("`r") -or $challengeToken.Contains("`n")) {
        throw 'The challenge token must be one trimmed line no longer than 512 characters.'
    }

    $serviceResult = Invoke-Gcloud -Arguments @(
        'run', 'services', 'describe', $serviceName,
        '--project', $projectId,
        '--region', $region,
        '--format=json'
    )
    $service = ($serviceResult.Output -join "`n") | ConvertFrom-Json

    $previousRevision = @($service.status.traffic) |
        Where-Object { $_.percent -eq 100 -and -not [string]::IsNullOrWhiteSpace($_.revisionName) } |
        Select-Object -First 1 -ExpandProperty revisionName
    if ([string]::IsNullOrWhiteSpace($previousRevision)) {
        $previousRevision = [string]$service.status.latestReadyRevisionName
    }
    if ([string]::IsNullOrWhiteSpace($previousRevision)) {
        throw 'Could not determine the currently serving revision.'
    }

    $servingTraffic = @($service.status.traffic) | Where-Object { [int]$_.percent -gt 0 }
    if ($servingTraffic.Count -ne 1 -or [int]$servingTraffic[0].percent -ne 100 -or [string]$servingTraffic[0].revisionName -cne $previousRevision) {
        throw 'This rollout requires exactly one explicitly named revision serving 100 percent of traffic.'
    }

    $previousImage = [string]$service.spec.template.spec.containers[0].image
    if ([string]::IsNullOrWhiteSpace($previousImage)) {
        throw 'Could not determine the currently configured container image.'
    }
    if ($previousImage -cne $reviewedImage) {
        throw 'Production is not running the immutable image digest reviewed for this marketplace submission.'
    }

    $secretCheck = Invoke-Gcloud -AllowFailure -Arguments @(
        'secrets', 'describe', $secretName,
        '--project', $projectId,
        '--format=value(name)'
    )
    if ($secretCheck.ExitCode -ne 0) {
        if (($secretCheck.Output -join "`n") -notmatch 'NOT_FOUND') {
            throw 'Could not inspect the challenge-token secret; refusing to treat the failure as a missing secret.'
        }
        $null = Invoke-Gcloud -Arguments @(
            'secrets', 'create', $secretName,
            '--project', $projectId,
            '--replication-policy=automatic',
            '--quiet'
        )
    }

    $iamResult = Invoke-Gcloud -AllowFailure -Arguments @(
        'secrets', 'add-iam-policy-binding', $secretName,
        '--project', $projectId,
        '--member', "serviceAccount:$runtimeServiceAccount",
        '--role', 'roles/secretmanager.secretAccessor',
        '--quiet'
    )

    if ($iamResult.ExitCode -eq 0) {
        $configurationMode = 'secret-manager'
        $tokenFile = Join-Path ([IO.Path]::GetTempPath()) ("noteflix-marketplace-challenge-{0}.txt" -f [guid]::NewGuid().ToString('N'))
        [IO.File]::WriteAllText($tokenFile, $challengeToken, [Text.UTF8Encoding]::new($false))

        $versionResult = Invoke-Gcloud -Arguments @(
            'secrets', 'versions', 'add', $secretName,
            '--project', $projectId,
            '--data-file', $tokenFile,
            '--format=value(name)'
        )
        $versionResource = [string](($versionResult.Output | Select-Object -Last 1).Trim())
        $challengeVersion = $versionResource.Split('/')[-1]
        if ($challengeVersion -notmatch '^\d+$') {
            throw 'Could not determine the new numeric secret version.'
        }
    }
    else {
        # The domain-verification token is intentionally served verbatim from a public
        # well-known endpoint. If this deployer cannot edit Secret Manager IAM, keep
        # the same staged/verified rollout while storing the public token directly in
        # the Cloud Run revision environment instead of weakening project IAM.
        $configurationMode = 'public-env'
    }

    $suffix = "challenge$(Get-Date -Format 'yyyyMMddHHmmss')"
    $tag = $suffix
    $updateArguments = @(
        'run', 'services', 'update', $serviceName,
        '--project', $projectId,
        '--region', $region,
        '--revision-suffix', $suffix,
        '--no-traffic',
        '--tag', $tag,
        '--quiet'
    )
    if ($configurationMode -eq 'secret-manager') {
        $updateArguments += @('--update-secrets', "OPENAI_APPS_CHALLENGE_TOKEN=$secretName`:$challengeVersion")
    }
    else {
        $updateArguments += @('--update-env-vars', "OPENAI_APPS_CHALLENGE_TOKEN=$challengeToken")
    }
    $null = Invoke-Gcloud -Arguments $updateArguments

    $updatedResult = Invoke-Gcloud -Arguments @(
        'run', 'services', 'describe', $serviceName,
        '--project', $projectId,
        '--region', $region,
        '--format=json'
    )
    $updatedService = ($updatedResult.Output -join "`n") | ConvertFrom-Json
    $tagTraffic = @($updatedService.status.traffic) | Where-Object { $_.tag -eq $tag } | Select-Object -First 1
    $newRevision = [string]$tagTraffic.revisionName
    $taggedOrigin = [string]$tagTraffic.url
    if ([string]::IsNullOrWhiteSpace($newRevision)) {
        $newRevision = [string]$updatedService.status.latestCreatedRevisionName
    }
    if ([string]::IsNullOrWhiteSpace($newRevision) -or [string]::IsNullOrWhiteSpace($taggedOrigin)) {
        throw 'Could not resolve the staged revision and tagged URL.'
    }

    $revisionResult = Invoke-Gcloud -Arguments @(
        'run', 'revisions', 'describe', $newRevision,
        '--project', $projectId,
        '--region', $region,
        '--format=json'
    )
    $revision = ($revisionResult.Output -join "`n") | ConvertFrom-Json
    $newImage = [string]$revision.spec.containers[0].image
    if ($newImage -cne $previousImage) {
        throw 'The staged revision does not use the exact previously reviewed container image.'
    }

    if (-not (Test-ChallengeEndpoint -Origin $taggedOrigin -ExpectedToken $challengeToken)) {
        throw 'The staged challenge endpoint did not pass the exact response checks.'
    }

    $null = Invoke-Gcloud -Arguments @(
        'run', 'services', 'update-traffic', $serviceName,
        '--project', $projectId,
        '--region', $region,
        '--to-revisions', "$newRevision=100",
        '--quiet'
    )
    $trafficPromoted = $true

    $publicVerified = $false
    for ($attempt = 1; $attempt -le 8; $attempt++) {
        if (Test-ChallengeEndpoint -Origin $publicOrigin -ExpectedToken $challengeToken) {
            $publicVerified = $true
            break
        }

        if ($attempt -lt 8) {
            Start-Sleep -Seconds 2
        }
    }
    if (-not $publicVerified) {
        throw 'The public challenge endpoint did not pass the exact response checks after promotion.'
    }

    Remove-TrafficTag -TrafficTag $tag
    $tag = $null

    [pscustomobject]@{
        status = 'verified'
        project = $projectId
        region = $region
        service = $serviceName
        previousRevision = $previousRevision
        revision = $newRevision
        image = $newImage
        configurationMode = $configurationMode
        secretVersion = $challengeVersion
        publicEndpoint = "$publicOrigin$challengePath"
    } | ConvertTo-Json -Compress
}
catch {
    $originalFailure = $_.Exception.Message
    $rollbackRequired = $trafficPromoted
    if (-not [string]::IsNullOrWhiteSpace($newRevision)) {
        $observedResult = Invoke-Gcloud -AllowFailure -Arguments @(
            'run', 'services', 'describe', $serviceName,
            '--project', $projectId,
            '--region', $region,
            '--format=json'
        )
        if ($observedResult.ExitCode -eq 0) {
            $observedService = ($observedResult.Output -join "`n") | ConvertFrom-Json
            $rollbackRequired = [bool](@($observedService.status.traffic) | Where-Object { $_.revisionName -eq $newRevision -and [int]$_.percent -gt 0 })
        }
    }

    if ($rollbackRequired -and -not [string]::IsNullOrWhiteSpace($previousRevision)) {
        $rollbackResult = Invoke-Gcloud -AllowFailure -Arguments @(
             'run', 'services', 'update-traffic', $serviceName,
             '--project', $projectId,
             '--region', $region,
             '--to-revisions', "$previousRevision=100",
             '--quiet'
         )
        $rollbackVerified = $false
        if ($rollbackResult.ExitCode -eq 0) {
            $rollbackCheck = Invoke-Gcloud -AllowFailure -Arguments @(
                'run', 'services', 'describe', $serviceName,
                '--project', $projectId,
                '--region', $region,
                '--format=json'
            )
            if ($rollbackCheck.ExitCode -eq 0) {
                $rolledBackService = ($rollbackCheck.Output -join "`n") | ConvertFrom-Json
                $rollbackVerified = [bool](@($rolledBackService.status.traffic) | Where-Object { $_.revisionName -eq $previousRevision -and [int]$_.percent -eq 100 })
            }
        }
        if (-not $rollbackVerified) {
            Remove-TrafficTag -TrafficTag $tag -BestEffort
            throw "Deployment failed ($originalFailure), and traffic rollback could not be verified."
        }
    }

    Remove-TrafficTag -TrafficTag $tag -BestEffort
    throw $originalFailure
}
finally {
    if (-not [string]::IsNullOrWhiteSpace($tokenFile) -and (Test-Path -LiteralPath $tokenFile)) {
        try {
            $fileLength = (Get-Item -LiteralPath $tokenFile).Length
            if ($fileLength -gt 0) {
                $zeroes = [byte[]]::new($fileLength)
                [IO.File]::WriteAllBytes($tokenFile, $zeroes)
            }
        }
        finally {
            Remove-Item -LiteralPath $tokenFile -Force -ErrorAction SilentlyContinue
        }
    }

    $challengeToken = $null
    $challengeTokenSecure = $null
}
