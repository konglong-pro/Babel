#requires -Version 7.0
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$runtimePython = Join-Path $repositoryRoot '.runtime/markitdown/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $runtimePython -PathType Leaf)) {
    throw 'The local converter is not installed. Run npm.cmd run import:setup first.'
}
& $runtimePython -I (Join-Path $PSScriptRoot 'test_worker.py')
exit $LASTEXITCODE
