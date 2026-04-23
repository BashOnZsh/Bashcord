param(
    [switch]$Push,
    [string]$Branch = "main",
    [string]$UpstreamRemote = "upstream",
    [string]$UpstreamUrl = "https://github.com/Equicord/Equicord.git"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)

    & git @Args
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Args -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Test-ProtectedPath {
    param(
        [string]$File,
        [string[]]$ProtectedPaths
    )

    foreach ($path in $ProtectedPaths) {
        if ($File -eq $path -or $File.StartsWith("$path/")) {
            return $true
        }
    }

    return $false
}

function Get-ProtectedPathsFromFile {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return @()
    }

    $lines = Get-Content -LiteralPath $Path
    $result = @()

    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed)) {
            continue
        }

        if ($trimmed.StartsWith("#")) {
            continue
        }

        $result += $trimmed
    }

    return $result
}

$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoRoot)) {
    throw "This script must be run inside a git repository."
}

Set-Location $repoRoot.Trim()

$workingTree = (& git status --porcelain)
if ($LASTEXITCODE -ne 0) {
    throw "Failed to read git status."
}

if (-not [string]::IsNullOrWhiteSpace(($workingTree -join ""))) {
    throw "Working tree is not clean. Commit/stash changes before syncing upstream."
}

$protectedConfigPath = ".sync-upstream-protected"
$protectedLocalConfigPath = ".sync-upstream-protected.local"

$protectedPaths = @(
    (Get-ProtectedPathsFromFile -Path $protectedConfigPath),
    (Get-ProtectedPathsFromFile -Path $protectedLocalConfigPath)
)

if ($protectedPaths.Count -eq 0) {
    throw "No protected paths found. Configure .sync-upstream-protected (and optional .sync-upstream-protected.local)."
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("bashcord-sync-" + [Guid]::NewGuid().ToString("N"))
$backupRoot = Join-Path $tempRoot "protected"
$states = @()

New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

try {
    foreach ($path in $protectedPaths) {
        $exists = Test-Path -LiteralPath $path
        $states += [PSCustomObject]@{
            Path   = $path
            Exists = $exists
        }

        if ($exists) {
            $destination = Join-Path $backupRoot $path
            $destinationParent = Split-Path -Parent $destination
            if (-not [string]::IsNullOrWhiteSpace($destinationParent)) {
                New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
            }
            Copy-Item -LiteralPath $path -Destination $destination -Recurse -Force
        }
    }

    $remoteUrl = (& git remote get-url $UpstreamRemote 2>$null)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($remoteUrl)) {
        Invoke-Git remote add $UpstreamRemote $UpstreamUrl
    }

    Invoke-Git fetch $UpstreamRemote
    Invoke-Git checkout $Branch

    & git rebase "$UpstreamRemote/$Branch"
    $rebaseStatus = $LASTEXITCODE

    while ($rebaseStatus -ne 0) {
        $conflictedFiles = (& git diff --name-only --diff-filter=U) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

        if (-not $conflictedFiles -or $conflictedFiles.Count -eq 0) {
            throw "Rebase failed without merge conflicts."
        }

        foreach ($file in $conflictedFiles) {
            if (Test-ProtectedPath -File $file -ProtectedPaths $protectedPaths) {
                Invoke-Git checkout --ours -- $file
                Invoke-Git add -A -- $file
            }
            else {
                & git cat-file -e ":3:$file" 2>$null
                if ($LASTEXITCODE -eq 0) {
                    Invoke-Git checkout --theirs -- $file
                    Invoke-Git add -A -- $file
                }
                else {
                    & git rm -f -- $file 2>$null
                    if ($LASTEXITCODE -ne 0) {
                        throw "Failed to remove conflicted file '$file'."
                    }
                }
            }
        }

        & git rebase --continue
        $rebaseStatus = $LASTEXITCODE
    }

    foreach ($state in $states) {
        if (Test-Path -LiteralPath $state.Path) {
            Remove-Item -LiteralPath $state.Path -Recurse -Force
        }

        if ($state.Exists) {
            $backupPath = Join-Path $backupRoot $state.Path
            if (Test-Path -LiteralPath $backupPath) {
                $parent = Split-Path -Parent $state.Path
                if (-not [string]::IsNullOrWhiteSpace($parent)) {
                    New-Item -ItemType Directory -Path $parent -Force | Out-Null
                }
                Copy-Item -LiteralPath $backupPath -Destination $state.Path -Recurse -Force
            }
        }
    }

    Invoke-Git add -A

    & git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
        Invoke-Git commit -m "chore: restore protected files after upstream sync"
    }

    if ($Push) {
        Invoke-Git push --force origin $Branch
    }

    Write-Host "Upstream sync completed successfully."
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}
