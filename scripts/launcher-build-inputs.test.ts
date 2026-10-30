import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const powershell = process.env.BABEL_TEST_PWSH ?? (process.platform === "win32" ? "pwsh.exe" : "pwsh");
const available = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-Command", "exit 0"], { windowsHide: true }).status === 0;

test("launcher rebuilds after shared sources change and ignores generated files", {
  skip: available ? false : "PowerShell 7 is required to exercise launcher build inputs.",
}, async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "babel-launcher-build-inputs-"));
  try {
    const packageNames = (await readdir(path.join(root, "packages"), { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && existsSync(path.join(root, "packages", entry.name, "package.json")))
      .map(entry => entry.name);
    await mkdir(path.join(temporaryRoot, "apps", "fixture"), { recursive: true });
    await writeFile(path.join(temporaryRoot, "babel.apps.json"), JSON.stringify({
      schemaVersion: 1,
      apps: [{
        name: "Fixture", id: "fixture", workspace: "apps/fixture", port: 3000,
        healthPath: "/api/health", identityPath: "/notes", identityText: "Fixture", readyTimeoutSeconds: 60,
        env: { FIXTURE_DATABASE_PATH: "data/fixture/sqlite.db" }, requiredDataPaths: ["data/fixture/sqlite.db"],
      }],
    }));
    await writeFile(path.join(temporaryRoot, "apps", "fixture", "package.json"), JSON.stringify({ name: "@babel-apps/fixture" }));
    for (const name of packageNames) {
      const directory = path.join(temporaryRoot, "packages", name, "src");
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "input.ts"), "fixture");
    }
    const junctionType = process.platform === "win32" ? "junction" : "dir";
    const generatedDirectory = path.join(temporaryRoot, "untracked-generated");
    await mkdir(generatedDirectory);
    await symlink(generatedDirectory, path.join(temporaryRoot, "packages", "typst", "src", "linked-output"), junctionType);
    await symlink(path.join(temporaryRoot, "packages", "typst"), path.join(temporaryRoot, "packages", "typst", "src", "loop"), junctionType);
    const script = String.raw`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($env:BABEL_TEST_WORKER, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { throw ($errors.Message -join '; ') }
foreach ($name in @('Test-ObjectProperty', 'Resolve-BabelRelativePath', 'Get-BabelApps', 'Get-NewestInputTimeUtc', 'Test-BuildRequired')) {
    $definition = $ast.Find({ param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
    }, $true)
    if ($null -eq $definition) { throw "Missing launcher function: $name" }
    . ([scriptblock]::Create($definition.Extent.Text))
}
function Resolve-NodeRuntime {
    param($RootPath)
    return [pscustomobject]@{
        NodePath = $env:BABEL_TEST_NODE; NpmPath = $env:BABEL_TEST_NODE
        Directory = [IO.Path]::GetDirectoryName($env:BABEL_TEST_NODE); Version = [Version]'24.0.0'
    }
}
$fixtureRoot = $env:BABEL_TEST_DIRECTORY
$app = @(Get-BabelApps -RootPath $fixtureRoot)[0]
$sourcePaths = @(Get-ChildItem -LiteralPath (Join-Path $fixtureRoot 'packages') -Directory | ForEach-Object {
    Join-Path $_.FullName 'src/input.ts'
})
$sourcePaths += @('packages/typst/assets/fonts/fixture.otf', 'packages/typst/scripts/sync-public-assets.ts') |
    ForEach-Object { Join-Path $fixtureRoot $_ }
$generatedPaths = @(
    'packages/typst/node_modules/runtime/generated.js', 'packages/typst/.next/cache/entry',
    'packages/katex/tsconfig.tsbuildinfo', 'packages/katex/build.log',
    'apps/fixture/public/_typst/compiler.wasm', 'apps/fixture/public/_pdf/worker.js',
    'untracked-generated/output.js'
) | ForEach-Object { Join-Path $fixtureRoot $_ }
foreach ($filename in @($sourcePaths) + @($generatedPaths) + @($app.BuildRequiredOutputs)) {
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($filename))
    [IO.File]::WriteAllText($filename, 'fixture')
}
$baseline = [DateTime]::UtcNow.AddMinutes(-3)
foreach ($entry in Get-ChildItem -LiteralPath $fixtureRoot -Recurse -Force) { $entry.LastWriteTimeUtc = $baseline }
[IO.File]::SetLastWriteTimeUtc($app.BuildMarker, $baseline.AddMinutes(1))
if (Test-BuildRequired -App $app) { throw 'The unchanged fixture should reuse its build.' }
foreach ($filename in $sourcePaths) {
    [IO.File]::SetLastWriteTimeUtc($filename, $baseline.AddMinutes(2))
    if (-not (Test-BuildRequired -App $app)) { throw "Shared source did not invalidate the build: $filename" }
    [IO.File]::SetLastWriteTimeUtc($filename, $baseline)
}
foreach ($filename in $generatedPaths) { [IO.File]::SetLastWriteTimeUtc($filename, $baseline.AddMinutes(2)) }
foreach ($relative in @('packages/typst/node_modules', 'packages/typst/.next', 'apps/fixture/public/_typst', 'apps/fixture/public/_pdf')) {
    [IO.Directory]::SetLastWriteTimeUtc((Join-Path $fixtureRoot $relative), $baseline.AddMinutes(2))
}
if (Test-BuildRequired -App $app) { throw 'Generated outputs must not invalidate the build.' }
Remove-Item -LiteralPath (Join-Path $fixtureRoot 'packages/platform/src/input.ts')
# NTFS may defer directory timestamp updates; model the completed deletion.
[IO.Directory]::SetLastWriteTimeUtc((Join-Path $fixtureRoot 'packages/platform/src'), $baseline.AddMinutes(2))
if (-not (Test-BuildRequired -App $app)) { throw 'Deleting a source file must invalidate the build.' }
Write-Output 'Launcher shared build inputs passed.'
`;
    const { stdout } = await execFileAsync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      cwd: root,
      env: {
        ...process.env,
        BABEL_TEST_WORKER: path.join(root, "launcher", "Babel.ps1"),
        BABEL_TEST_DIRECTORY: temporaryRoot,
        BABEL_TEST_NODE: process.execPath,
      },
      timeout: 30_000,
      windowsHide: true,
    });
    assert.match(stdout, /Launcher shared build inputs passed/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
