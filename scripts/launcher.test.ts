import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const root = path.resolve(import.meta.dirname, "..");
const workerPath = path.join(root, "launcher", "Babel.ps1");
const guiPath = path.join(root, "launcher", "Babel.Gui.ps1");
const processHelperPath = path.join(root, "launcher", "Babel.Process.ps1");
const xamlPath = path.join(root, "launcher", "Babel.xaml");
const nativeLauncherPath = path.join(root, "launcher", "Babel.exe");
const nativeLauncherSourcePath = path.join(root, "launcher", "Babel.Launcher.cs");
const nativeLauncherBuildPath = path.join(root, "launcher", "Build-BabelExe.ps1");
const shortcutsHelperPath = path.join(root, "launcher", "Babel.Shortcuts.ps1");
const shortcutsXamlPath = path.join(root, "launcher", "Babel.Shortcuts.xaml");
const shortcutDefaultsPath = path.join(root, "packages", "platform", "shortcuts.defaults.json");

const [
  workerSource,
  guiSource,
  processHelperSource,
  xamlSource,
  nativeLauncherSource,
  nativeLauncherBuildSource,
  shortcutsHelperSource,
  shortcutsXamlSource,
  shortcutDefaultsSource,
  rootManifestSource,
] = await Promise.all([
  readFile(workerPath, "utf8"),
  readFile(guiPath, "utf8"),
  readFile(processHelperPath, "utf8"),
  readFile(xamlPath, "utf8"),
  readFile(nativeLauncherSourcePath, "utf8"),
  readFile(nativeLauncherBuildPath, "utf8"),
  readFile(shortcutsHelperPath, "utf8"),
  readFile(shortcutsXamlPath, "utf8"),
  readFile(shortcutDefaultsPath, "utf8"),
  readFile(path.join(root, "package.json"), "utf8"),
]);
const nativeLauncher = await readFile(nativeLauncherPath);
const rootManifest = JSON.parse(rootManifestSource) as { engines?: { node?: string } };
const shortcutDefaults = JSON.parse(shortcutDefaultsSource) as {
  schemaVersion?: number;
  commands?: Array<{ command?: string; label?: string; defaultBinding?: string }>;
};

test("the launcher opens a verified notebook in the system browser", () => {
  assert.equal(
    /Start-Process\s+-FilePath\s+\$status\.App\.Url/i.test(workerSource),
    false,
    "the worker must not open an application URL",
  );
  assert.match(
    guiSource,
    /Start-Process\s+-FilePath\s+\$App\.IdentityUrl/i,
    "the GUI must hand the registered identity URL to the system browser",
  );
  assert.match(guiSource, /\bOpenSelectedButton\b/i);
  assert.match(xamlSource, /x:Name=["']OpenSelectedButton["']/i);
  assert.match(xamlSource, /Content=["']OPEN \(_O\)["']/i);

  const openSource =
    guiSource.match(/function\s+Open-BabelApp\b([\s\S]*?)function\s+[A-Za-z]/i)?.[1] ?? "";
  assert.match(openSource, /Test-AppHealthRecentlyPassed\s+-App\s+\$App/i);
  assert.doesNotMatch(openSource, /Test-AppHealth\s+-App/i);
  assert.match(openSource, /Start-AppHealthProbe\s+-App\s+\$App/i);
  assert.match(openSource, /Open-AppIdentity\s+-App\s+\$App/i);
  assert.ok(
    openSource.search(/Test-AppHealthRecentlyPassed\s+-App\s+\$App/i) <
      openSource.search(/Open-AppIdentity\s+-App\s+\$App/i),
    "OPEN must verify health and identity before opening the browser",
  );
});

test("the previous control-panel visual shell keeps the current launcher contract", () => {
  assert.match(xamlSource, /Text=["']Attention Iteration["']/i);
  assert.match(xamlSource, /<DataGrid\s+[\s\S]*?x:Name=["']AppsGrid["']/i);
  assert.doesNotMatch(xamlSource, /<ListBox\s+[\s\S]*?x:Name=["']AppsGrid["']/i);
  assert.match(xamlSource, /C\s+O\s+M\s+M\s+A\s+N\s+D\s+S/i);
  assert.match(xamlSource, /S\s+E\s+S\s+S\s+I\s+O\s+N\s+L\s+O\s+G/i);
  assert.match(xamlSource, /x:Name=["']OpenSelectedButton["']/i);
  assert.match(xamlSource, /x:Name=["']AdvancedExpander["'][\s\S]{0,120}IsExpanded=["']True["']/i);
});

test("Babel.exe is a reproducible STA PowerShell host", () => {
  assert.equal(nativeLauncher.subarray(0, 2).toString("ascii"), "MZ");
  assert.ok(nativeLauncher.length > 1_024, "the checked-in launcher must contain a PE executable");
  const peOffset = nativeLauncher.readUInt32LE(0x3c);
  assert.equal(nativeLauncher.subarray(peOffset, peOffset + 4).toString("binary"), "PE\0\0");
  assert.equal(
    nativeLauncher.readUInt16LE(peOffset + 24 + 68),
    2,
    "Babel.exe must use the Windows GUI subsystem and avoid a console window",
  );
  assert.match(nativeLauncherSource, /\[STAThread\]/);
  assert.match(nativeLauncherSource, /"Babel\.Gui\.ps1"/);
  assert.match(nativeLauncherSource, /Directory\.SetCurrentDirectory\(repositoryRoot\)/);
  assert.match(nativeLauncherSource, /RunspaceFactory\.CreateRunspace\(\)/);
  assert.match(nativeLauncherSource, /ApartmentState\s*=\s*ApartmentState\.STA/);
  assert.match(nativeLauncherSource, /PSThreadOptions\.UseNewThread/);
  assert.match(nativeLauncherSource, /--encoded-command/);
  assert.doesNotMatch(nativeLauncherSource, /XamlReader/);
  assert.match(nativeLauncherBuildSource, /v4\.0\.30319/i);
  assert.match(nativeLauncherBuildSource, /csc\.exe/i);
  assert.match(nativeLauncherBuildSource, /\/target:winexe/i);
  assert.match(nativeLauncherBuildSource, /\/noconfig/i);
  assert.match(nativeLauncherBuildSource, /\/nostdlib\+/i);
  assert.match(nativeLauncherBuildSource, /\/win32icon:/i);
  assert.match(nativeLauncherBuildSource, /System\.Management\.Automation\.dll/i);
  assert.match(nativeLauncherBuildSource, /Babel\.Launcher\.cs/i);
});

test(
  "the native launcher rebuilds with the Windows framework compiler",
  { skip: process.platform !== "win32" },
  async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "babel-launcher-exe-"));
    const outputPath = path.join(temporaryRoot, "Babel.exe");
    try {
      await execFileAsync(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          nativeLauncherBuildPath,
          "-OutputPath",
          outputPath,
        ],
        { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true },
      );

      const rebuiltLauncher = await readFile(outputPath);
      assert.equal(rebuiltLauncher.subarray(0, 2).toString("ascii"), "MZ");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  },
);

test("the GUI verifies application identity from the lightweight health response", () => {
  for (const field of ["healthPath", "identityPath", "identityText"]) {
    assert.match(
      guiSource,
      new RegExp(`foreach \\(\\$propertyName in @\\([^)]*"${field}"`, "is"),
      `the GUI registry loader must require ${field}`,
    );
  }
  assert.match(guiSource, /\bHealthUrl\s*=\s*\$internalBaseUrl\s*\+\s*\$healthPath/i);
  assert.match(guiSource, /\bIdentityUrl\s*=\s*\$publicBaseUrl\s*\+\s*\$identityPath/i);
  assert.match(guiSource, /\bIdentityText\s*=\s*\$identityText/i);

  const appHealthSource =
    guiSource.match(/function\s+Test-AppHealth\b([\s\S]*?)function\s+[A-Za-z]/i)?.[1] ?? "";
  assert.match(appHealthSource, /-Uri\s+\$App\.HealthUrl\b/i);
  assert.match(appHealthSource, /ConvertFrom-Json/i);
  assert.match(appHealthSource, /\$health\.app\s+-ieq\s+\[string\]\$App\.IdentityText/i);
  assert.match(appHealthSource, /\$App\.IdentityText/i);
  assert.doesNotMatch(appHealthSource, /IdentityHealthUrl|IdentityUrl/i);

  const statusRefreshSource =
    guiSource.match(/function\s+Refresh-AppStatuses\b([\s\S]*?)function\s+Update-LogView/i)?.[1] ?? "";
  assert.doesNotMatch(
    statusRefreshSource,
    /Test-AppHealth/i,
    "periodic probes must not block the WPF Dispatcher with synchronous HTTP",
  );
  assert.match(guiSource, /RunspaceFactory\]::CreateRunspacePool/i);
  assert.match(guiSource, /\$probePowerShell\.BeginInvoke\(\)/i);
  assert.match(guiSource, /\$script:ProbeGenerationById/i);

  const startAllSource =
    guiSource.match(/function\s+Start-AllNotebookWorkers\b([\s\S]*?)if\s*\(\$LifecycleSmokeTest\)/i)?.[1] ?? "";
  assert.doesNotMatch(startAllSource, /Test-AppHealth\s+-App/i);
  assert.match(startAllSource, /Start-BabelWorker\s+-Selection\s+["']All["']\s+-Mode\s+["']Start["']/i);
  assert.equal(
    startAllSource.match(/Start-BabelWorker/gi)?.length ?? 0,
    1,
    "START ALL must create exactly one aggregate worker",
  );
});

test("managed workers survive transient listener probe failures", () => {
  const waitForStopSource =
    workerSource.match(
      /function\s+Wait-ForStopRequest\b([\s\S]*?)\$babelRoot\s*=/i,
    )?.[1] ?? "";

  assert.match(
    waitForStopSource,
    /\$entry\.RootProcess\.Refresh\(\)[\s\S]*?\$entry\.RootProcess\.HasExited/i,
    "the worker must still detect an exited managed process",
  );
  assert.doesNotMatch(
    waitForStopSource,
    /Test-TcpPort|Test-AppHealth|stopped listening unexpectedly/i,
    "a transient probe miss must not trigger destructive worker cleanup",
  );
});

test("the GUI bounds background status probe frequency", () => {
  const statusRefreshSource =
    guiSource.match(
      /function\s+Refresh-AppStatuses\b([\s\S]*?)function\s+Update-LogView/i,
    )?.[1] ?? "";

  assert.match(
    statusRefreshSource,
    /\.TotalSeconds\s+-ge[\s\S]{0,100}\$script:HealthProbeIntervalSeconds/i,
    "background HTTP health probes must be spaced out",
  );
  assert.match(guiSource, /\$script:HealthProbeIntervalSeconds\s*=\s*30\b/i);
  assert.match(guiSource, /CreateRunspacePool\(1,\s*\$healthProbeConcurrency\)/i);
  assert.match(guiSource, /\$healthProbeConcurrency\s*=\s*\[Math\]::Min\(2,/i);
  assert.match(
    guiSource,
    /\$script:StatusPollIntervalSeconds\s*=\s*5\b/i,
  );
  assert.match(
    guiSource,
    /\$timer\.Interval\s*=\s*\[TimeSpan\]::FromSeconds\(\$script:StatusPollIntervalSeconds\)/i,
    "GUI status polling must leave breathing room for notebook processes",
  );
});

test("START ALL has one aggregate worker while OPEN retains independent workers", () => {
  assert.match(guiSource, /\$script:WorkersById\s*=\s*@\{\}/i);
  assert.match(guiSource, /\$script:AllWorker\s*=\s*\$null/i);
  assert.match(guiSource, /\bManagesAll\s*=\s*\$isAllStart/i);
  assert.match(guiSource, /function\s+Get-AllWorkerState\b/i);
  assert.match(guiSource, /\$independentStartActive\s*=\s*@\(/i);
  assert.match(guiSource, /\$script:StopSelectedButton\.IsEnabled[\s\S]{0,160}\$selectedWorker/i);
  assert.match(guiSource, /function\s+Get-AppDisplayStatus\b/i);
  for (const status of ["Stopped", "Starting", "Ready", "Unhealthy", "External"]) {
    assert.match(guiSource, new RegExp(`return ["']${status}["']`, "i"));
    assert.match(xamlSource, new RegExp(`Value=["']${status}["']`, "i"));
  }
  assert.match(xamlSource, /x:Name=["']AdvancedExpander["']/i);
  assert.match(xamlSource, /x:Name=["']StartAllButton["']/i);
  assert.match(xamlSource, /x:Name=["']VerifyButton["']/i);
  assert.match(xamlSource, /x:Name=["']LogTextBox["']/i);
});

test("diagnostics keep bounded history and log tails", () => {
  const updateLogSource =
    guiSource.match(/function\s+Update-LogView\b([\s\S]*?)function\s+Request-WorkerStop/i)?.[1] ?? "";

  assert.match(guiSource, /\$script:MaximumWorkerHistory\s*=\s*20\b/i);
  assert.match(guiSource, /\$script:MaximumLogCharactersPerStream\s*=\s*131072\b/i);
  assert.match(guiSource, /\$script:MaximumRenderedLogCharacters\s*=\s*1048576\b/i);
  assert.match(guiSource, /function\s+Trim-WorkerHistory\b/i);
  assert.match(guiSource, /function\s+Remove-WorkerSessionDirectory\b/i);
  assert.match(updateLogSource, /Read-WorkerLogTail\s+-Path/i);
  assert.doesNotMatch(updateLogSource, /Get-Content[^\r\n]*-Raw/i);
});

test("notebook processes run without allocating console hosts", () => {
  const startProcessSource =
    workerSource.match(/function\s+Start-AppProcess\b([\s\S]*?)function\s+Wait-AppReady/i)?.[1] ?? "";

  assert.match(workerSource, /\.\s+\$processHelperPath/i);
  assert.match(guiSource, /\.\s+\$processHelperPath/i);
  assert.match(startProcessSource, /Start-BabelDetachedProcess/i);
  assert.match(guiSource, /-FilePath\s+\$nativeLauncherPath/i);
  assert.match(guiSource, /--encoded-command\s+\$encodedCommand/i);
  assert.match(processHelperSource, /DetachedProcessFlag\s*=\s*0x00000008/i);
  assert.match(processHelperSource, /CreateProcessW\(/i);
  assert.doesNotMatch(startProcessSource, /CreateNoWindow/i);
});

test("the tray menu exposes every registered notebook", () => {
  assert.match(guiSource, /\$script:TrayAppMenuItems\s*=\s*@\{\}/i);
  assert.match(guiSource, /foreach\s*\(\$app\s+in\s+\$script:RegisteredApps\)[\s\S]{0,900}ToolStripMenuItem/i);
  assert.match(guiSource, /\$trayAppMenuItem\.Tag\s*=\s*\$app\.Id/i);
  assert.match(guiSource, /\$trayAppMenuItem\.Add_Click/i);
  assert.match(guiSource, /Open-BabelApp/i);
});

test("ready messages publish the registered identity URL", () => {
  const readyUrlProperties = Array.from(
    workerSource.matchAll(/Write-Host\s+"\[ready\][^"\r\n]*\$\(\$App\.(\w+)\)[^"\r\n]*"/gi),
    (match) => match[1],
  );

  assert.deepEqual(
    [...new Set(readyUrlProperties)],
    ["IdentityUrl"],
    "every ready message must give the user the registered identity URL",
  );
});

test("the launcher separates lightweight internal identity probes from the public URL", () => {
  const appHealthSource =
    workerSource.match(/function\s+Test-AppHealth\b([\s\S]*?)function\s+Get-NewestInputTimeUtc\b/i)?.[1] ?? "";

  assert.match(
    workerSource,
    /\$internalBaseUrl\s*=\s*"http:\/\/127\.0\.0\.1:\$port"/i,
    "the launcher must define its internal base URL on explicit IPv4 loopback",
  );
  assert.match(
    workerSource,
    /\$publicBaseUrl\s*=\s*"http:\/\/localhost:\$port"/i,
    "the launcher must publish a localhost base URL for browser use",
  );
  assert.match(
    workerSource,
    /\bHealthUrl\s*=\s*\$internalBaseUrl\s*\+\s*\$healthPath/i,
    "health checks must use the internal loopback URL",
  );
  assert.match(
    workerSource,
    /\bIdentityUrl\s*=\s*\$publicBaseUrl\s*\+\s*\$identityPath/i,
    "the identity URL shown to users must use localhost",
  );
  assert.match(
    appHealthSource,
    /-Uri\s+\$App\.HealthUrl\b/i,
    "Test-AppHealth must request the internal health URL",
  );
  assert.match(appHealthSource, /ConvertFrom-Json/i);
  assert.match(appHealthSource, /\$health\.app\s+-ieq\s+\[string\]\$App\.IdentityText/i);
  assert.doesNotMatch(
    appHealthSource,
    /IdentityHealthUrl|\$App\.IdentityUrl/i,
    "Test-AppHealth must not render the public identity page",
  );
  assert.match(
    workerSource,
    /StartArguments\s*=\s*@\([\s\S]{0,320}"-H"\s*,\s*"127\.0\.0\.1"/i,
    "Next.js must remain bound to explicit IPv4 loopback",
  );
});

test("the launcher checks database migrations after preflight and before starting an app", () => {
  const startOrReuseSource =
    workerSource.match(
      /function\s+Start-OrReuseApp\b([\s\S]*?)function\s+Stop-ProcessTree\b/i,
    )?.[1] ?? "";
  const databaseCheckSource =
    workerSource.match(
      /function\s+Assert-AppDatabaseReady\b([\s\S]*?)function\s+[A-Za-z]/i,
    )?.[1] ?? "";

  assert.match(
    workerSource,
    /DatabaseCheckArguments\s*=\s*@\("run",\s*"db:check",\s*"-w",\s*\$expectedPackageName\)/i,
    "registered apps with db:check must expose the workspace check command",
  );
  assert.match(
    startOrReuseSource,
    /Test-TcpPort[\s\S]*?Wait-ExistingAppReady[\s\S]*?return[\s\S]*?Assert-AppPreflight\s+-App\s+\$App[\s\S]*?Assert-AppDatabaseReady\s+-App\s+\$App[\s\S]*?Ensure-AppBuild/i,
    "existing apps must use health checks, while new starts validate paths and dependencies before the database gate",
  );
  assert.match(
    databaseCheckSource,
    /DatabaseCheckArguments/i,
    "the database gate must invoke only the configured db:check arguments",
  );
  assert.doesNotMatch(
    databaseCheckSource,
    /&[^\r\n]*db:migrate/i,
    "the launcher must never invoke a database migration",
  );
  assert.match(databaseCheckSource, /Review the diagnostic output above/i);
  assert.doesNotMatch(
    databaseCheckSource,
    /data:backup|db:migrate/i,
    "only the stale-schema diagnostic may recommend a migration",
  );
});

test("shared platform changes invalidate application builds", () => {
  const buildInputPathsSource =
    workerSource.match(/\$buildInputPaths\s*=\s*@\(([\s\S]*?)\r?\n\s*\)/i)?.[1] ?? "";

  assert.match(
    buildInputPathsSource,
    /Join-Path\s+\$RootPath\s+["']packages\\markdown["']/i,
    "the launcher must rebuild apps after the shared Markdown package changes",
  );
  assert.match(
    buildInputPathsSource,
    /Join-Path\s+\$RootPath\s+["']packages\\platform["']/i,
    "the launcher must rebuild apps after the shared shortcut contract changes",
  );
});

test("the launcher edits the shared nine-command shortcut contract", () => {
  assert.equal(shortcutDefaults.schemaVersion, 2);
  assert.deepEqual(
    shortcutDefaults.commands?.map(({ command, defaultBinding }) => [command, defaultBinding]),
    [
      ["save", "Ctrl+S"],
      ["new", "Ctrl+Alt+N"],
      ["edit", "Ctrl+Alt+E"],
      ["read", "Ctrl+R"],
      ["confirm", "Ctrl+Enter"],
      ["cancel", "Escape"],
      ["search", "Ctrl+F"],
      ["delete", "Ctrl+Delete"],
      ["commandPalette", "Ctrl+K"],
    ],
  );

  for (const controlName of [
    "ShortcutGrid",
    "ShortcutErrorText",
    "ShortcutStatusText",
    "RestoreDefaultsButton",
    "CancelShortcutsButton",
    "SaveShortcutsButton",
  ]) {
    assert.match(shortcutsXamlSource, new RegExp(`x:Name=["']${controlName}["']`, "i"));
  }
  assert.match(xamlSource, /x:Name=["']ShortcutsButton["']/i);
  assert.match(guiSource, /\.\s*\$shortcutHelperPath/i, "the GUI must dot-source the shortcut helper");
  assert.match(guiSource, /Add_PreviewKeyDown/i, "the modal must capture complete WPF key combinations");
  assert.match(guiSource, /Read-BabelShortcutSettings/i);
  assert.match(guiSource, /Write-BabelShortcutSettings/i);
  assert.match(guiSource, /reload open application pages/i);
});

test("shortcut settings are normalized, validated, and replaced atomically", () => {
  assert.match(shortcutsHelperSource, /SpecialFolder\]::LocalApplicationData/i);
  assert.match(shortcutsHelperSource, /Join-Path[^\r\n]*["']Babel["']/i);
  assert.match(shortcutsHelperSource, /["']shortcuts\.json["']/i);
  assert.match(shortcutsHelperSource, /ConvertTo-BabelShortcutBindingMap/i);
  assert.match(shortcutsHelperSource, /assigned to both/i, "duplicate bindings must be rejected");
  assert.match(shortcutsHelperSource, /must include Ctrl or Alt/i);
  assert.match(shortcutsHelperSource, /Only Escape may be used without a modifier/i);
  for (const reservedBinding of ["Alt+F4", "Ctrl+W", "Ctrl+T", "Ctrl+L", "Ctrl+Shift+T", "F5"]) {
    assert.match(shortcutsHelperSource, new RegExp(`"${reservedBinding.replaceAll("+", "\\+")}"`));
  }
  assert.match(shortcutsHelperSource, /Write-Warning/i, "missing or invalid user settings must warn");
  assert.match(shortcutsHelperSource, /Text\.UTF8Encoding\(\$false\)/i, "settings must use UTF-8 without a BOM");
  assert.match(shortcutsHelperSource, /\[IO\.File\]::Replace\(/i, "an existing settings file must be replaced atomically");
  assert.match(shortcutsHelperSource, /\.tmp["']/i, "the replacement must be staged beside the settings file");
});

test(
  "shortcut settings round-trip and replace atomically outside LocalAppData",
  { skip: process.platform !== "win32" },
  async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "babel-launcher-shortcuts-"));
    const settingsPath = path.join(temporaryRoot, "shortcuts.json");
    const powershellSource = String.raw`
$ErrorActionPreference = "Stop"
. ([Environment]::GetEnvironmentVariable("BABEL_TEST_SHORTCUT_HELPER"))
$definitions = @(Get-BabelShortcutDefinitions -Path ([Environment]::GetEnvironmentVariable("BABEL_TEST_SHORTCUT_DEFAULTS")))
$settingsPath = [Environment]::GetEnvironmentVariable("BABEL_TEST_SHORTCUT_SETTINGS")
$legacyDocument = [ordered]@{
    schemaVersion = 1
    bindings = [ordered]@{
        save = "Ctrl+Alt+S"
        new = "Ctrl+Alt+N"
        edit = "Ctrl+Alt+E"
        confirm = "Ctrl+Enter"
        cancel = "Escape"
        search = "Ctrl+F"
        delete = "Ctrl+Delete"
        commandPalette = "Ctrl+K"
    }
}
[IO.File]::WriteAllText(
    $settingsPath,
    ($legacyDocument | ConvertTo-Json -Depth 4),
    (New-Object Text.UTF8Encoding($false))
)
$loaded = Read-BabelShortcutSettings -Definitions $definitions -Path $settingsPath
if (
    $loaded.Source -ne "User" -or
    $loaded.Bindings["save"] -ne "Ctrl+Alt+S" -or
    $loaded.Bindings["read"] -ne "Ctrl+R"
) {
    throw "Legacy shortcut settings were not migrated without losing custom bindings."
}
[void](Write-BabelShortcutSettings -Definitions $definitions -Bindings $loaded.Bindings -Path $settingsPath)
if ((ConvertTo-BabelShortcutBinding -Binding "Ctrl+R") -ne "Ctrl+R") {
    throw "Ctrl+R was not accepted as a Babel shortcut."
}
foreach ($forbiddenBinding in @("Ctrl", "A", "Shift+S", "Enter", "Ctrl+W", "F5")) {
    $wasRejected = $false
    try {
        [void](ConvertTo-BabelShortcutBinding -Binding $forbiddenBinding)
    } catch {
        $wasRejected = $true
    }
    if (-not $wasRejected) {
        throw "Forbidden shortcut was accepted: $forbiddenBinding"
    }
}
Write-Output "Babel shortcut replacement test passed."
`;

    try {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-EncodedCommand",
          Buffer.from(powershellSource, "utf16le").toString("base64"),
        ],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 30_000,
          windowsHide: true,
          env: {
            ...process.env,
            BABEL_TEST_SHORTCUT_HELPER: shortcutsHelperPath,
            BABEL_TEST_SHORTCUT_DEFAULTS: shortcutDefaultsPath,
            BABEL_TEST_SHORTCUT_SETTINGS: settingsPath,
          },
        },
      );

      assert.match(stdout, /Babel shortcut replacement test passed/i);
      assert.deepEqual(await readdir(temporaryRoot), ["shortcuts.json"]);

      const settingsBytes = await readFile(settingsPath);
      assert.equal(
        settingsBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
        false,
      );
      const savedSettings = JSON.parse(settingsBytes.toString("utf8")) as {
        schemaVersion?: number;
        bindings?: Record<string, string>;
      };
      assert.equal(savedSettings.schemaVersion, 2);
      assert.equal(savedSettings.bindings?.save, "Ctrl+Alt+S");
      assert.equal(savedSettings.bindings?.read, "Ctrl+R");
      assert.deepEqual(
        Object.keys(savedSettings.bindings ?? {}),
        shortcutDefaults.commands?.map(({ command }) => command),
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  },
);

test("the launcher can minimize to the system tray and restore safely", () => {
  const missingContracts: string[] = [];
  if (!/x:Name=["']MinimizeToTrayButton["']/i.test(xamlSource)) {
    missingContracts.push("offer a minimize-to-tray command");
  }
  if (!/Windows\.Forms\.NotifyIcon/i.test(guiSource)) {
    missingContracts.push("create a Windows notification-area icon");
  }
  if (!/\$script:Window\.Hide\(\)/i.test(guiSource)) {
    missingContracts.push("hide the WPF window without stopping its worker");
  }
  if (!/\$script:Window\.Show\(\)/i.test(guiSource)) {
    missingContracts.push("restore the WPF window from the tray");
  }
  if (!/\$script:NotifyIcon\.Visible\s*=\s*\$true/i.test(guiSource)) {
    missingContracts.push("show the tray icon while the window is hidden");
  }
  if (!/\$script:MinimizeToTrayButton\.Add_Click[\s\S]{0,240}Hide-BabelWindowToTray/i.test(guiSource)) {
    missingContracts.push("connect the tray command to the hide lifecycle");
  }
  if (!/\$script:NotifyIcon\.Add_MouseClick[\s\S]{0,360}Restore-BabelWindowFromTray/i.test(guiSource)) {
    missingContracts.push("restore from a left click on the tray icon");
  }
  if (!/\$script:TrayOpenMenuItem\.Add_Click[\s\S]{0,240}Restore-BabelWindowFromTray/i.test(guiSource)) {
    missingContracts.push("restore from the tray Open command");
  }
  if (!/function\s+Restore-BabelWindowFromTray[\s\S]{0,720}\$script:Window\.WindowState\s*=\s*\[Windows\.WindowState\]::Normal[\s\S]{0,240}\$script:Window\.Activate\(\)[\s\S]{0,240}\$script:NotifyIcon\.Visible\s*=\s*\$false/i.test(guiSource)) {
    missingContracts.push("restore, activate, and hide the tray icon");
  }
  if (!/function\s+Dispose-BabelTrayResources[\s\S]{0,320}\$script:NotifyIcon\.Visible\s*=\s*\$false[\s\S]{0,160}\$script:NotifyIcon\.Dispose\(\)/i.test(guiSource)) {
    missingContracts.push("hide and dispose the tray icon on final exit");
  }
  if (!/\$script:TrayExitMenuItem\.Add_Click[\s\S]{0,240}\$script:Window\.Close\(\)/i.test(guiSource)) {
    missingContracts.push("route the tray Exit command through the window close lifecycle");
  }
  if (!/\$script:Window\.Add_Closing[\s\S]{0,720}Request-AllWorkersStop/i.test(guiSource)) {
    missingContracts.push("keep graceful multi-worker shutdown behind the close lifecycle");
  }
  if (!/New-Object\s+Windows\.Application[\s\S]{0,240}\.Run\(\$script:Window\)/i.test(guiSource)) {
    missingContracts.push("keep the WPF message loop alive while the window is hidden");
  }
  if (/\$script:Window\.ShowDialog\(\)/i.test(guiSource)) {
    missingContracts.push("avoid a modal loop that returns as soon as the window is hidden");
  }

  assert.deepEqual(missingContracts, []);
});

test(
  "the native launcher forwards a read-only GUI smoke test",
  { skip: process.platform !== "win32" },
  async () => {
    await execFileAsync(nativeLauncherPath, ["-SmokeTest"], {
      cwd: os.tmpdir(),
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    });

    await assert.rejects(
      execFileAsync(nativeLauncherPath, ["-SmokeTest", "-StateSmokeTest"], {
        cwd: os.tmpdir(),
        encoding: "utf8",
        timeout: 30_000,
        windowsHide: true,
      }),
      (error: unknown) => {
        const exitCode = (error as { code?: unknown }).code;
        return typeof exitCode === "number" && exitCode !== 0;
      },
      "Babel.exe must propagate a non-zero GUI script exit code without showing a modal error",
    );
  },
);

test(
  "the shortcut editor passes a read-only Windows PowerShell smoke test",
  { skip: process.platform !== "win32" },
  async () => {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        guiPath,
        "-SmokeTest",
      ],
      { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true },
    );

    assert.match(stdout, /Babel GUI smoke test passed/i);
    assert.match(stdout, /6 shortcut control\(s\)/i);
    assert.match(stdout, /9 shortcut command\(s\)/i);
  },
);

test(
  "the notebook state machine passes a real Windows PowerShell smoke test",
  { skip: process.platform !== "win32" },
  async () => {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        guiPath,
        "-StateSmokeTest",
      ],
      { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true },
    );

    assert.match(stdout, /Babel GUI state smoke test passed/i);
    for (const status of ["Stopped", "Starting", "Ready", "Unhealthy", "External"]) {
      assert.match(stdout, new RegExp(`\\b${status}\\b`, "i"));
    }
    assert.match(stdout, /foreign listener rejected/i);
    assert.match(stdout, /aggregate Start All/i);
    assert.match(stdout, /independent OPEN workers/i);
  },
);

test(
  "the aggregate and independent worker lifecycle passes a real Windows PowerShell smoke test",
  { skip: process.platform !== "win32" },
  async () => {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        guiPath,
        "-LifecycleSmokeTest",
      ],
      { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true },
    );

    assert.match(stdout, /Babel GUI lifecycle smoke test passed/i);
    assert.match(stdout, /asynchronous health probe/i);
    assert.match(stdout, /stale result rejection/i);
    assert.match(stdout, /aggregate Start All/i);
    assert.match(stdout, /independent OPEN workers/i);
    assert.match(stdout, /STOP ALL ownership/i);
    assert.match(stdout, /bounded diagnostics cleanup/i);
    assert.match(stdout, /closing gate/i);
    assert.match(stdout, /pending OPEN cancellation/i);
    assert.match(stdout, /failed-stop cancellation/i);
    assert.match(stdout, /worker cleanup/i);
  },
);

test(
  "the tray lifecycle passes a real Windows PowerShell smoke test",
  { skip: process.platform !== "win32" },
  async () => {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        guiPath,
        "-TraySmokeTest",
      ],
      { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true },
    );

    assert.match(stdout, /Babel GUI tray smoke test passed/i);
  },
);

test("the launcher resolves a Node executable compatible with the root engine", () => {
  const requiredNodeRange = rootManifest.engines?.node;
  assert.equal(typeof requiredNodeRange, "string", "the root package must declare engines.node");
  assert.notEqual(requiredNodeRange?.trim(), "", "the root engines.node range must not be empty");

  const missingContracts: string[] = [];
  if (!/\.engines\.node|\[\s*["']engines["']\s*\][\s\S]{0,120}\[\s*["']node["']\s*\]/i.test(workerSource)) {
    missingContracts.push("read package.json#engines.node");
  }
  if (!/--version/i.test(workerSource)) {
    missingContracts.push("probe each Node candidate's version");
  }
  if (!/\bFNM_DIR\b/i.test(workerSource)) {
    missingContracts.push("consider FNM_DIR");
  }
  if (!/aliases[\s\S]{0,120}default[\s\S]{0,120}node\.exe/i.test(workerSource)) {
    missingContracts.push("consider fnm's aliases/default/node.exe");
  }
  if (/StartCommand\s*=\s*["']node\.exe["']/i.test(workerSource)) {
    missingContracts.push("avoid a PATH-only StartCommand");
  }
  if (!/\$nodeRuntime\.Directory[\s\S]{0,240}["']PATH["']/i.test(workerSource)) {
    missingContracts.push("put the selected runtime first on child-process PATH");
  }

  assert.deepEqual(
    missingContracts,
    [],
    `Node resolution must satisfy the root engine range ${requiredNodeRange}`,
  );
});
