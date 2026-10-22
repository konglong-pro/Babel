import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const powershell = process.env.BABEL_TEST_PWSH ?? (process.platform === "win32" ? "pwsh.exe" : "pwsh");
const available = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-Command", "exit 0"]).status === 0;

test("launcher observes pending starts promptly and returns to idle polling", {
  skip: available ? false : "PowerShell 7 is required to exercise launcher polling.",
}, async () => {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($env:BABEL_TEST_GUI, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { throw ($errors.Message -join '; ') }
foreach ($name in @('Get-BabelStatusPollInterval', 'Open-BabelApp')) {
    $definition = $ast.Find({ param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
    }, $true)
    if ($null -eq $definition) { throw "Missing launcher function: $name" }
    . ([scriptblock]::Create($definition.Extent.Text))
}
function Assert-Interval([double]$Expected, [TimeSpan]$Actual) {
    if ($Actual.TotalMilliseconds -ne $Expected) {
        throw "Expected $Expected ms polling, got $($Actual.TotalMilliseconds) ms."
    }
}
$worker = [pscustomobject]@{ OpenPending = $false; StopRequested = $false; ReadyObserved = $true }
Assert-Interval 5000 (Get-BabelStatusPollInterval)
Assert-Interval 5000 (Get-BabelStatusPollInterval -ActiveWorkers @($worker))
$worker.ReadyObserved = $false
Assert-Interval 250 (Get-BabelStatusPollInterval -ActiveWorkers @($worker))
$worker.ReadyObserved = $true
$worker.OpenPending = $true
Assert-Interval 250 (Get-BabelStatusPollInterval -ActiveWorkers @($worker))
$worker.OpenPending = $false
$worker.StopRequested = $true
Assert-Interval 250 (Get-BabelStatusPollInterval -ActiveWorkers @($worker))
$worker.StopRequested = $false
Assert-Interval 250 (Get-BabelStatusPollInterval -PendingOpenCount 1)
Assert-Interval 250 (Get-BabelStatusPollInterval -HealthProbeCount 1)
Assert-Interval 250 (Get-BabelStatusPollInterval -Closing $true)
Assert-Interval 5000 (Get-BabelStatusPollInterval -ActiveWorkers @($worker))
Assert-Interval 10000 (Get-BabelStatusPollInterval -IdleSeconds 10)

# OPEN must reschedule the existing idle timer immediately, including the
# path that reuses a healthy service instead of creating another worker.
$script:StatusTimer = [pscustomobject]@{ Interval = [TimeSpan]::FromSeconds(5) }
$script:CloseRequested = $false
$script:LastPortOpenById = @{}
$script:Opened = $false
function Test-AppHealthRecentlyPassed { param($App) return $true }
function Set-AppReadyObserved { param($AppId) }
function Complete-BabelOpenSuccess { param($App) $script:Opened = $true }
Open-BabelApp -App ([pscustomobject]@{ Id = 'fixture' })
Assert-Interval 250 $script:StatusTimer.Interval
if (-not $script:Opened) { throw 'OPEN failed to reuse the healthy fixture service.' }
Write-Output 'Launcher startup polling passed.'
`;
  const { stdout } = await execFileAsync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    cwd: root,
    env: { ...process.env, BABEL_TEST_GUI: path.join(root, "launcher/Babel.Gui.ps1") },
    timeout: 30_000,
  });
  assert.match(stdout, /Launcher startup polling passed/);
});
