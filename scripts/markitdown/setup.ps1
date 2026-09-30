#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$Python = 'python',
    [string]$Uv = 'uv'
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$repositoryRoot = Split-Path (Split-Path $projectRoot -Parent) -Parent
$runtimeRoot = Join-Path $repositoryRoot '.runtime/markitdown'
$previousEnvironment = [Environment]::GetEnvironmentVariable('UV_PROJECT_ENVIRONMENT', 'Process')
try {
    $pythonCommand = (Get-Command $Python -ErrorAction Stop).Source
    $uvCommand = (Get-Command $Uv -ErrorAction Stop).Source
    $pythonVersion = & $pythonCommand -I -c 'import sys; print(".".join(map(str, sys.version_info[:2])))'
    if ($LASTEXITCODE -ne 0 -or [version]$pythonVersion -lt [version]'3.10' -or [version]$pythonVersion -ge [version]'3.14') {
        throw 'Babel document import requires Python 3.10, 3.11, 3.12 or 3.13.'
    }
    [Environment]::SetEnvironmentVariable('UV_PROJECT_ENVIRONMENT', $runtimeRoot, 'Process')
    & $uvCommand sync --locked --no-dev --no-python-downloads --python $pythonCommand --project $projectRoot
    if ($LASTEXITCODE -ne 0) { throw 'Pinned MarkItDown SDK installation failed.' }
    $runtimePython = Join-Path $runtimeRoot 'Scripts/python.exe'
    & $runtimePython -I (Join-Path $projectRoot 'worker.py') --probe
    if ($LASTEXITCODE -ne 0) { throw 'Installed MarkItDown SDK did not pass its readiness check.' }
    Write-Host "Babel document converter installed at $runtimeRoot"
}
finally {
    [Environment]::SetEnvironmentVariable('UV_PROJECT_ENVIRONMENT', $previousEnvironment, 'Process')
}
