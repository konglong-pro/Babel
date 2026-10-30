import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");

test("launcher preserves Windows arguments when starting from a path with spaces", {
  skip: process.platform !== "win32",
}, async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "babel process arguments 中文-"));
  try {
    const fixturePath = path.join(temporaryRoot, "fixture script.cjs");
    const argumentsPath = path.join(temporaryRoot, "arguments.json");
    const outputPath = path.join(temporaryRoot, "received.json");
    const expected = [
      "plain", "with spaces", "", "tab\tvalue", 'quoted "value"',
      'backslashes\\\\"before quote', "trailing\\", "spaces and trailing\\\\",
      "\\\\server\\share\\", "中文路径", "& | < > ^ % ! $ ` ' ( )",
    ];
    await writeFile(argumentsPath, JSON.stringify(expected));
    await writeFile(fixturePath, `
setTimeout(() => {
  require("node:fs").writeFileSync(process.env.BABEL_TEST_ARGUMENTS_OUTPUT, JSON.stringify(process.argv.slice(2)));
}, 300);
`);
    const script = String.raw`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
. (Join-Path $env:BABEL_TEST_REPOSITORY 'launcher/Babel.Process.ps1')
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $env:BABEL_TEST_REPOSITORY 'launcher/Babel.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { throw ($errors.Message -join '; ') }
foreach ($name in @('Set-TemporaryEnvironment', 'Restore-Environment', 'Start-AppProcess')) {
    $definition = $ast.Find({ param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
    }, $true)
    if ($null -eq $definition) { throw "Missing launcher function: $name" }
    . ([scriptblock]::Create($definition.Extent.Text))
}
$fixtureArguments = @(Get-Content -LiteralPath $env:BABEL_TEST_ARGUMENTS -Raw | ConvertFrom-Json)
$app = [pscustomobject]@{
    Name = 'Argument fixture'
    StartCommand = $env:BABEL_TEST_NODE
    StartArguments = @($env:BABEL_TEST_FIXTURE) + $fixtureArguments
    StartWorkingDirectory = $env:BABEL_TEST_DIRECTORY
    Environment = @{ BABEL_TEST_ARGUMENTS_OUTPUT = $env:BABEL_TEST_OUTPUT }
}
$process = Start-AppProcess -App $app
try {
    if (-not $process.WaitForExit(10000)) { throw 'Argument fixture did not exit.' }
    if ($process.ExitCode -ne 0) { throw "Argument fixture exited with code $($process.ExitCode)." }
} finally {
    if (-not $process.HasExited) { $process.Kill(); $null = $process.WaitForExit(5000) }
    $process.Dispose()
}
Write-Output 'Windows process arguments passed.'
`;
    const { stdout } = await execFileAsync("pwsh.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      cwd: root,
      env: {
        ...process.env,
        BABEL_TEST_REPOSITORY: root,
        BABEL_TEST_NODE: process.execPath,
        BABEL_TEST_FIXTURE: fixturePath,
        BABEL_TEST_ARGUMENTS: argumentsPath,
        BABEL_TEST_DIRECTORY: temporaryRoot,
        BABEL_TEST_OUTPUT: outputPath,
      },
      timeout: 30_000,
      windowsHide: true,
    });
    assert.match(stdout, /Windows process arguments passed/);
    assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), expected);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
