#requires -Version 7.2

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string] $ReviewerUid,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string] $ReviewerEmail,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string] $ExpectedReviewerDisplayName,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string] $ReviewerSecretName,

    [ValidateNotNullOrEmpty()]
    [string] $ProjectId = 'studywnoteflix'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$secretName = $ReviewerSecretName
$reviewerId = $ReviewerUid
$reviewerDisplayName = $ExpectedReviewerDisplayName
$confirmation = 'ROTATE_DEDICATED_REVIEWER_ONLY'
$lookupUri = "https://identitytoolkit.googleapis.com/v1/projects/$projectId/accounts:lookup"
$updateUri = "https://identitytoolkit.googleapis.com/v1/projects/$projectId/accounts:update"

$password = $null
$passwordSecure = $null

function Get-AccessHeaders {
    $token = (& gcloud auth print-access-token).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($token)) {
        throw 'Could not obtain a Google Cloud access token.'
    }

    return @{
        Authorization = "Bearer $token"
        'x-goog-user-project' = $projectId
    }
}

function Get-ReviewerAccount {
    param([hashtable] $Headers)

    $request = @{
        localId = @($reviewerId)
    } | ConvertTo-Json -Compress
    $response = Invoke-RestMethod -Method Post -Uri $lookupUri -Headers $Headers -ContentType 'application/json' -Body $request
    $matches = @($response.users) | Where-Object { $null -ne $_ }
    if ($matches.Count -ne 1 -or [string]$matches[0].localId -cne $reviewerId) {
        throw 'The dedicated reviewer account could not be resolved by its exact UID.'
    }

    return $matches[0]
}

function Get-MfaCount {
    param($Account)

    return @($Account.mfaInfo).Where({ $null -ne $_ }).Count
}

function Assert-ReviewerProfile {
    param($Account)

    if (
        [string]$Account.localId -cne $reviewerId -or
        [string]$Account.email -cne $reviewerEmail -or
        [string]$Account.displayName -cne $reviewerDisplayName
    ) {
        throw 'The resolved account does not match the dedicated reviewer profile.'
    }
}

function Assert-PasswordOnlyProvider {
    param($Account)

    $providerIds = @(
        $Account.providerUserInfo |
            Where-Object { $null -ne $_ } |
            ForEach-Object { [string]$_.providerId }
    )
    if ($providerIds.Count -ne 1 -or $providerIds[0] -cne 'password') {
        throw 'The dedicated reviewer account must use the password provider only.'
    }
}

try {
    if ($env:NOTEFLIX_REVIEWER_ROTATION_CONFIRMATION -cne $confirmation) {
        throw 'The exact dedicated-reviewer rotation confirmation is required.'
    }
    if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
        throw 'gcloud is not available on PATH.'
    }
    $secretResource = (& gcloud secrets describe $secretName --project $projectId --format='value(name)').Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($secretResource)) {
        throw 'The dedicated reviewer secret is missing or cannot be read.'
    }

    $passwordSecure = Read-Host 'New dedicated reviewer password' -AsSecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordSecure)
    try {
        $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    if (
        [string]::IsNullOrWhiteSpace($password) -or
        $password.Length -lt 24 -or
        $password.Length -gt 128 -or
        $password -ne $password.Trim() -or
        $password.Contains("`r") -or
        $password.Contains("`n")
    ) {
        throw 'The generated reviewer password must be one trimmed line between 24 and 128 characters.'
    }

    $headers = Get-AccessHeaders
    $reviewer = Get-ReviewerAccount -Headers $headers
    Assert-ReviewerProfile -Account $reviewer
    if ([bool]$reviewer.disabled -or -not [bool]$reviewer.emailVerified) {
        throw 'The dedicated reviewer account must already be enabled and email-verified.'
    }
    Assert-PasswordOnlyProvider -Account $reviewer

    $previousMfaCount = Get-MfaCount -Account $reviewer
    if ($previousMfaCount -ne 0) {
        throw 'The dedicated reviewer account must have no MFA factors before rotation.'
    }
    $updateRequest = @{
        localId = [string]$reviewer.localId
        password = $password
    } | ConvertTo-Json -Compress
    $null = Invoke-RestMethod -Method Post -Uri $updateUri -Headers $headers -ContentType 'application/json' -Body $updateRequest

    $secretPayload = @{
        email = [string]$reviewer.email
        password = $password
    } | ConvertTo-Json -Compress
    $versionOutput = $secretPayload | & gcloud secrets versions add $secretName --project $projectId --data-file=- --format='value(name)'
    if ($LASTEXITCODE -ne 0) {
        throw 'The reviewer account was rotated, but its Secret Manager version could not be synchronized.'
    }
    $versionResource = [string](($versionOutput | Select-Object -Last 1).Trim())
    $secretVersion = $versionResource.Split('/')[-1]
    if ($secretVersion -notmatch '^\d+$') {
        throw 'Could not determine the synchronized reviewer-secret version.'
    }

    $verified = Get-ReviewerAccount -Headers $headers
    Assert-ReviewerProfile -Account $verified
    Assert-PasswordOnlyProvider -Account $verified
    if (
        [string]$verified.localId -cne [string]$reviewer.localId -or
        [bool]$verified.disabled -or
        -not [bool]$verified.emailVerified -or
        (Get-MfaCount -Account $verified) -ne 0
    ) {
        throw 'Post-rotation reviewer-account verification failed.'
    }

    $emailParts = [string]$verified.email -split '@', 2
    $emailLocal = $emailParts[0]
    $maskedLocal = if ($emailLocal.Length -le 5) {
        $emailLocal.Substring(0, 1) + '***'
    }
    else {
        $emailLocal.Substring(0, 3) + '***' + $emailLocal.Substring($emailLocal.Length - 2)
    }
    [pscustomobject]@{
        status = 'rotated'
        maskedEmail = "$maskedLocal@$($emailParts[1])"
        previousMfaCount = $previousMfaCount
        currentMfaCount = Get-MfaCount -Account $verified
        emailVerified = [bool]$verified.emailVerified
        disabled = [bool]$verified.disabled
        secret = $secretName
        secretVersion = $secretVersion
    } | ConvertTo-Json -Compress
}
finally {
    $password = $null
    $passwordSecure = $null
}
