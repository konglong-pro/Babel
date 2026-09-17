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
  assert.match(xamlSource, /Content=["']OPEN["']/i);

  const openSource =
    guiSource.match(/function\s+Open-BabelApp\b([\s\S]*?)function\s+[A-Za-z]/i)?.[1] ?? "";
  const completeOpenSource =
    guiSource.match(/function\s+Complete-BabelOpenSuccess\b([\s\S]*?)function\s+[A-Za-z]/i)?.[1] ?? "";
  assert.match(openSource, /Test-AppHealthRecentlyPassed\s+-App\s+\$App/i);
  assert.doesNotMatch(openSource, /Test-AppHealth\s+-App/i);
  assert.match(openSource, /Start-AppHealthProbe\s+-App\s+\$App/i);
  assert.match(openSource, /Complete-BabelOpenSuccess\s+-App\s+\$App/i);
  assert.match(completeOpenSource, /Open-AppIdentity\s+-App\s+\$App/i);
  assert.ok(
    openSource.search(/Test-AppHealthRecentlyPassed\s+-App\s+\$App/i) <
      openSource.search(/Complete-BabelOpenSuccess\s+-App\s+\$App/i),
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
  assert.match(nativeLauncherSource, /"pwsh\.exe"/);
  assert.match(nativeLauncherSource, /-STA/);
  assert.match(nativeLauncherSource, /CreateNoWindow\s*=\s*true/);
  assert.match(nativeLauncherSource, /--encoded-command/);
  assert.doesNotMatch(nativeLauncherSource, /XamlReader/);
  assert.match(nativeLauncherBuildSource, /v4\.0\.30319/i);
  assert.match(nativeLauncherBuildSource, /csc\.exe/i);
  assert.match(nativeLauncherBuildSource, /\/target:winexe/i);
  assert.match(nativeLauncherBuildSource, /\/noconfig/i);
  assert.match(nativeLauncherBuildSource, /\/nostdlib\+/i);
  assert.match(nativeLauncherBuildSource, /\/win32icon:/i);
  assert.doesNotMatch(nativeLauncherBuildSource, /System\.Management\.Automation/i);
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
        "pwsh.exe",
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

test("the launcher edits the shared schema v3 shortcut contract", () => {
  assert.equal(shortcutDefaults.schemaVersion, 3);
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
      ["focusNextPane", "Ctrl+F6"],
      ["focusPreviousPane", "Ctrl+Shift+F6"],
      ["nextTab", "Ctrl+Alt+ArrowRight"],
      ["previousTab", "Ctrl+Alt+ArrowLeft"],
      ["closeTab", "Ctrl+Alt+W"],
      ["quickOpen", "Ctrl+Alt+P"],
      ["help", "Ctrl+Alt+H"],
    ],
  );

  for (const controlName of [
    "LauncherHotkeyBox",
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
  assert.match(guiSource, /Read-BabelLauncherHotkeySettings/i);
  assert.match(guiSource, /Write-BabelLauncherHotkeySettings/i);
  assert.match(guiSource, /reload open application pages/i);
  assert.match(shortcutsXamlSource, /Text=["']Unbound["']/i);
  assert.match(shortcutsXamlSource, /Backspace or Delete/i);
  assert.match(guiSource, /isUnbindGesture/i);
});

test("the launcher owns one configurable global toggle hotkey", () => {
  assert.match(shortcutsHelperSource, /Get-BabelLauncherHotkeySettingsPath/i);
  assert.match(shortcutsHelperSource, /["']launcher\.json["']/i);
  assert.match(shortcutsHelperSource, /Get-BabelDefaultLauncherHotkeyBinding[\s\S]{0,160}Ctrl\+Alt\+B/i);
  assert.match(shortcutsHelperSource, /schemaVersion\s*=\s*1[\s\S]{0,100}toggleLauncher/i);
  assert.match(
    shortcutsHelperSource,
    /\$modifiers\s*=\s*\[uint32\]0x4000/i,
    "RegisterHotKey must include MOD_NOREPEAT",
  );

  assert.match(guiSource, /RegisterHotKey/i);
  assert.match(
    guiSource,
    /RegisterHotKeyWithError[\s\S]{0,520}Marshal\.GetLastWin32Error\(\)/i,
    "registration failures must capture their Win32 code before returning to PowerShell",
  );
  assert.match(guiSource, /UnregisterHotKey/i);
  assert.match(guiSource, /HwndSourceHook/i);
  assert.match(guiSource, /Add_SourceInitialized/i);
  assert.match(guiSource, /\$script:WmHotkey\s*=\s*\[uint32\]0x0312/i);
  assert.match(guiSource, /function\s+Invoke-BabelGlobalHotkeyToggle/i);
  assert.match(
    guiSource,
    /ShortcutDialogWindow[\s\S]{0,240}\.Activate\(\)[\s\S]{0,120}return/i,
    "the global toggle must keep the shortcut modal visible",
  );
  assert.match(
    guiSource,
    /Register-BabelGlobalHotkeyCandidate[\s\S]{0,1600}Write-BabelLauncherHotkeySettings[\s\S]{0,320}Commit-BabelGlobalHotkeyCandidate/i,
    "a replacement must register successfully before it is committed",
  );
  assert.match(guiSource, /Dispose-BabelGlobalHotkeyResources/i);
});

test("the visible launcher supports the complete keyboard loop", () => {
  assert.match(guiSource, /\$script:Window\.Add_PreviewKeyDown/i);
  assert.match(guiSource, /\^D\(\[0-9\]\)\$/i);
  assert.match(guiSource, /\^NumPad\(\[0-9\]\)\$/i);
  assert.match(guiSource, /\$number\s+-eq\s+0[\s\S]{0,80}return\s+9/i);
  assert.match(guiSource, /\[Windows\.Input\.Key\]::Up[\s\S]{0,180}Move-BabelAppSelection\s+-Delta\s+-1/i);
  assert.match(guiSource, /\[Windows\.Input\.Key\]::Down[\s\S]{0,180}Move-BabelAppSelection\s+-Delta\s+1/i);
  assert.match(guiSource, /focusedElement\s+-is\s+\[Windows\.Controls\.Primitives\.TextBoxBase\]/i);
  assert.match(guiSource, /-not\s+\[bool\]\$focusedElement\.IsReadOnly/i);
  assert.doesNotMatch(
    guiSource,
    /\$script:AppsGrid\.IsKeyboardFocusWithin/i,
    "window keyboard commands must not depend on a delayed DataGrid focus transition",
  );
  assert.match(guiSource, /\[Windows\.Input\.Key\]::Return[\s\S]{0,520}Open-BabelApp\s+-App\s+\$app\s+-HideAfterOpen/i);
  assert.match(guiSource, /\[Windows\.Input\.Key\]::Delete[\s\S]{0,520}Get-AppWorkerState\s+-AppId\s+\$app\.Id[\s\S]{0,520}Request-AppWorkerStop/i);
  assert.match(guiSource, /\[Windows\.Input\.Key\]::Escape[\s\S]{0,240}Hide-BabelWindowToTray/i);

  const focusSource =
    guiSource.match(/function\s+Focus-BabelAppList\b([\s\S]*?)function\s+[A-Za-z]/i)?.[1] ?? "";
  assert.ok(
    (focusSource.match(/\$script:AppsGrid\.Focus\(\)/gi)?.length ?? 0) >= 2,
    "list focus must be applied synchronously and reinforced on the Dispatcher",
  );

  for (const content of ["OPEN", "STOP SELECTED", "MINIMIZE TO TRAY"]) {
    assert.match(xamlSource, new RegExp(`Content=["']${content}["']`, "i"));
  }
  for (const removedAccessKey of ["_O", "_T", "_M"]) {
    assert.doesNotMatch(xamlSource, new RegExp(removedAccessKey, "i"));
  }
  assert.doesNotMatch(xamlSource, /IsDefault=["']True["']/i);

  const completeOpenSource =
    guiSource.match(/function\s+Complete-BabelOpenSuccess\b([\s\S]*?)function\s+[A-Za-z]/i)?.[1] ?? "";
  assert.ok(
    completeOpenSource.search(/Open-AppIdentity\s+-App\s+\$App/i) <
      completeOpenSource.search(/Hide-BabelWindowToTray/i),
    "keyboard OPEN may hide only after the browser open succeeds",
  );
  assert.match(guiSource, /function\s+Show-BabelOpenError[\s\S]{0,480}Restore-BabelWindowAfterOpenFailure/i);
});

test("shortcut settings are normalized, validated, and replaced atomically", () => {
  assert.match(shortcutsHelperSource, /SpecialFolder\]::LocalApplicationData/i);
  assert.match(shortcutsHelperSource, /Join-Path[^\r\n]*["']Babel["']/i);
  assert.match(shortcutsHelperSource, /["']shortcuts\.json["']/i);
  assert.match(shortcutsHelperSource, /ConvertTo-BabelShortcutBindingMap/i);
  assert.match(shortcutsHelperSource, /assigned to both/i, "duplicate bindings must be rejected");
  assert.match(shortcutsHelperSource, /must include Ctrl or Alt/i);
  assert.match(shortcutsHelperSource, /safe bare function key/i);
  for (const reservedBinding of [
    "Alt+F4",
    "Ctrl+W",
    "Ctrl+T",
    "Ctrl+L",
    "Ctrl+Shift+T",
    "Ctrl+Alt+ArrowUp",
    "Ctrl+Alt+ArrowDown",
    "F2",
    "F5",
    "F6",
  ]) {
    assert.match(shortcutsHelperSource, new RegExp(`"${reservedBinding.replaceAll("+", "\\+")}"`));
  }
  for (const keyName of [
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "PageUp",
    "PageDown",
  ]) {
    assert.match(shortcutsHelperSource, new RegExp(`"${keyName}"`));
  }
  assert.match(shortcutsHelperSource, /schemaVersion\s*=\s*3[\s\S]{0,100}bindings/i);
  assert.match(shortcutsHelperSource, /migratedBindings[\s\S]{0,900}\$null/i);
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
    const launcherSettingsPath = path.join(temporaryRoot, "launcher.json");
    const powershellSource = String.raw`
$ErrorActionPreference = "Stop"
. ([Environment]::GetEnvironmentVariable("BABEL_TEST_SHORTCUT_HELPER"))
$definitions = @(Get-BabelShortcutDefinitions -Path ([Environment]::GetEnvironmentVariable("BABEL_TEST_SHORTCUT_DEFAULTS")))
$settingsPath = [Environment]::GetEnvironmentVariable("BABEL_TEST_SHORTCUT_SETTINGS")
$launcherSettingsPath = [Environment]::GetEnvironmentVariable("BABEL_TEST_LAUNCHER_SETTINGS")
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
        commandPalette = "Ctrl+Alt+P"
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
    $loaded.Bindings["read"] -ne "Ctrl+R" -or
    $loaded.Bindings["commandPalette"] -ne "Ctrl+Alt+P" -or
    $null -ne $loaded.Bindings["quickOpen"]
) {
    throw "Legacy shortcut settings were not migrated without losing custom bindings."
}
$legacyEscapeSettingsPath = "$settingsPath.legacy-escape"
$legacyEscapeDocument = [ordered]@{
    schemaVersion = 1
    bindings = [ordered]@{
        save = "Escape"
        new = "Ctrl+Alt+N"
        edit = "Ctrl+Alt+E"
        confirm = "Ctrl+Enter"
        cancel = "Ctrl+Alt+C"
        search = "Ctrl+F"
        delete = "Ctrl+Delete"
        commandPalette = "Ctrl+K"
    }
}
[IO.File]::WriteAllText(
    $legacyEscapeSettingsPath,
    ($legacyEscapeDocument | ConvertTo-Json -Depth 4),
    (New-Object Text.UTF8Encoding($false))
)
$legacyEscapeLoaded = Read-BabelShortcutSettings -Definitions $definitions -Path $legacyEscapeSettingsPath
if (
    $legacyEscapeLoaded.Source -ne "User" -or
    $null -ne $legacyEscapeLoaded.Bindings["save"] -or
    $legacyEscapeLoaded.Bindings["cancel"] -ne "Ctrl+Alt+C" -or
    $legacyEscapeLoaded.Bindings["focusNextPane"] -ne "Ctrl+F6"
) {
    throw "A legacy non-cancel Escape owner invalidated more than its own binding."
}
[IO.File]::Delete($legacyEscapeSettingsPath)
$legacyReorderSettingsPath = "$settingsPath.legacy-reorder"
$legacyReorderDocument = [ordered]@{
    schemaVersion = 2
    bindings = [ordered]@{
        save = "Ctrl+Alt+S"
        new = "Ctrl+Alt+N"
        edit = "Ctrl+Alt+E"
        read = "Alt+Control+Down"
        confirm = "Ctrl+Enter"
        cancel = "Escape"
        search = "Ctrl+F"
        delete = "Ctrl+Delete"
        commandPalette = "Ctrl+Alt+P"
    }
}
[IO.File]::WriteAllText(
    $legacyReorderSettingsPath,
    ($legacyReorderDocument | ConvertTo-Json -Depth 4),
    (New-Object Text.UTF8Encoding($false))
)
$legacyReorderLoaded = Read-BabelShortcutSettings -Definitions $definitions -Path $legacyReorderSettingsPath
if (
    $legacyReorderLoaded.Source -ne "User" -or
    $null -ne $legacyReorderLoaded.Bindings["read"] -or
    $legacyReorderLoaded.Bindings["save"] -ne "Ctrl+Alt+S" -or
    $legacyReorderLoaded.Bindings["cancel"] -ne "Escape" -or
    $legacyReorderLoaded.Bindings["focusNextPane"] -ne "Ctrl+F6"
) {
    throw "A legacy fixed-reorder owner invalidated more than its own binding."
}
[void](Write-BabelShortcutSettings -Definitions $definitions -Bindings $legacyReorderLoaded.Bindings -Path $legacyReorderSettingsPath)
$legacyReorderRoundTrip = Get-Content -LiteralPath $legacyReorderSettingsPath -Raw | ConvertFrom-Json
if (
    [int]$legacyReorderRoundTrip.schemaVersion -ne 3 -or
    $null -ne $legacyReorderRoundTrip.bindings.read -or
    $legacyReorderRoundTrip.bindings.save -ne "Ctrl+Alt+S"
) {
    throw "The migrated fixed-reorder binding did not round-trip as schema v3 null."
}
[IO.File]::Delete($legacyReorderSettingsPath)
[void](Write-BabelShortcutSettings -Definitions $definitions -Bindings $loaded.Bindings -Path $settingsPath)
if ((ConvertTo-BabelShortcutBinding -Binding "Ctrl+R") -ne "Ctrl+R") {
    throw "Ctrl+R was not accepted as a Babel shortcut."
}
if ((ConvertTo-BabelShortcutBinding -Binding "Ctrl+Alt+Right") -ne "Ctrl+Alt+ArrowRight") {
    throw "Arrow key aliases were not accepted as Babel shortcuts."
}
if ((ConvertTo-BabelShortcutBinding -Binding "F1") -ne "F1") {
    throw "A safe bare function key was not accepted as a Babel shortcut."
}
foreach ($forbiddenBinding in @("Ctrl", "A", "Shift+S", "Enter", "Ctrl+W", "Ctrl+Alt+ArrowUp", "Ctrl+Alt+ArrowDown", "F2", "F5", "F6", "Shift+F6")) {
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
$defaultLauncherSettings = Read-BabelLauncherHotkeySettings -Path $launcherSettingsPath
if (
    $defaultLauncherSettings.Source -ne "Defaults" -or
    $defaultLauncherSettings.Binding -ne "Ctrl+Alt+B"
) {
    throw "Missing launcher settings did not use the default toggle binding."
}
[IO.File]::WriteAllText(
    $launcherSettingsPath,
    '{"schemaVersion":1,"toggleLauncher":"Ctrl+Alt+B","extra":true}',
    (New-Object Text.UTF8Encoding($false))
)
$invalidLauncherSettings = Read-BabelLauncherHotkeySettings -Path $launcherSettingsPath
if (
    $invalidLauncherSettings.Source -ne "Defaults" -or
    $invalidLauncherSettings.Binding -ne "Ctrl+Alt+B" -or
    [string]::IsNullOrWhiteSpace([string]$invalidLauncherSettings.Warning)
) {
    throw "Invalid launcher settings did not warn and fall back to defaults."
}
$launcherRegistration = ConvertTo-BabelLauncherHotkeyRegistration -Binding "alt + ctrl + b"
if (
    $launcherRegistration.Binding -ne "Ctrl+Alt+B" -or
    $launcherRegistration.Modifiers -ne 0x4003 -or
    $launcherRegistration.VirtualKey -ne 0x42
) {
    throw "Launcher hotkey registration values were not canonical or did not include MOD_NOREPEAT."
}
foreach ($bareLauncherBinding in @("Escape", "F1")) {
    $bareLauncherBindingRejected = $false
    try {
        [void](ConvertTo-BabelLauncherHotkeyRegistration -Binding $bareLauncherBinding)
    } catch {
        $bareLauncherBindingRejected = $true
    }
    if (-not $bareLauncherBindingRejected) {
        throw "The launcher accepted unmodified system-wide hotkey '$bareLauncherBinding'."
    }
}
[void](Write-BabelLauncherHotkeySettings -Binding "Ctrl+Alt+L" -Path $launcherSettingsPath)
$loadedLauncherSettings = Read-BabelLauncherHotkeySettings -Path $launcherSettingsPath
if (
    $loadedLauncherSettings.Source -ne "User" -or
    $loadedLauncherSettings.Binding -ne "Ctrl+Alt+L"
) {
    throw "Launcher hotkey settings did not round-trip."
}
Write-Output "Babel shortcut replacement test passed."
`;

    try {
      const { stdout } = await execFileAsync(
        "pwsh.exe",
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
            BABEL_TEST_LAUNCHER_SETTINGS: launcherSettingsPath,
          },
        },
      );

      assert.match(stdout, /Babel shortcut replacement test passed/i);
      assert.deepEqual((await readdir(temporaryRoot)).sort(), ["launcher.json", "shortcuts.json"]);

      const settingsBytes = await readFile(settingsPath);
      assert.equal(
        settingsBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
        false,
      );
      const savedSettings = JSON.parse(settingsBytes.toString("utf8")) as {
        schemaVersion?: number;
        bindings?: Record<string, string | null>;
      };
      assert.equal(savedSettings.schemaVersion, 3);
      assert.equal(savedSettings.bindings?.save, "Ctrl+Alt+S");
      assert.equal(savedSettings.bindings?.read, "Ctrl+R");
      assert.equal(savedSettings.bindings?.commandPalette, "Ctrl+Alt+P");
      assert.equal(savedSettings.bindings?.quickOpen, null);
      assert.deepEqual(
        Object.keys(savedSettings.bindings ?? {}),
        shortcutDefaults.commands?.map(({ command }) => command),
      );

      const launcherSettingsBytes = await readFile(launcherSettingsPath);
      assert.equal(
        launcherSettingsBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
        false,
      );
      assert.deepEqual(JSON.parse(launcherSettingsBytes.toString("utf8")), {
        schemaVersion: 1,
        toggleLauncher: "Ctrl+Alt+L",
      });
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
      env: { ...process.env, PSExecutionPolicyPreference: "Restricted" },
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    });

    await execFileAsync(nativeLauncherPath, ["-HotkeySmokeTest"], {
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
  "the shortcut editor passes a read-only PowerShell 7 smoke test",
  { skip: process.platform !== "win32" },
  async () => {
    const { stdout } = await execFileAsync(
      "pwsh.exe",
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
    assert.match(stdout, /7 shortcut control\(s\)/i);
    assert.match(stdout, /16 shortcut command\(s\)/i);
  },
);

test(
  "the notebook state machine passes a real PowerShell 7 smoke test",
  { skip: process.platform !== "win32" },
  async () => {
    const { stdout } = await execFileAsync(
      "pwsh.exe",
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
  "the aggregate and independent worker lifecycle passes a real PowerShell 7 smoke test",
  { skip: process.platform !== "win32" },
  async () => {
    const { stdout } = await execFileAsync(
      "pwsh.exe",
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
  "the tray lifecycle passes a real PowerShell 7 smoke test",
  { skip: process.platform !== "win32" },
  async () => {
    const { stdout } = await execFileAsync(
      "pwsh.exe",
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

test(
  "the global hotkey toggle passes a real PowerShell 7 smoke test",
  { skip: process.platform !== "win32" },
  async () => {
    const { stdout } = await execFileAsync(
      "pwsh.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        guiPath,
        "-HotkeySmokeTest",
      ],
      { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true },
    );

    assert.match(stdout, /Babel GUI hotkey smoke test passed/i);
    assert.match(stdout, /WM_HOTKEY restore\/hide toggle/i);
    assert.match(stdout, /resource cleanup/i);
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


test(
  "the native launcher uses PowerShell 7 and propagates worker exit codes",
  { skip: process.platform !== "win32" },
  async () => {
    const invoke = (command: string) => execFileAsync(
      nativeLauncherPath,
      ["--encoded-command", Buffer.from(command, "utf16le").toString("base64")],
      { cwd: root, timeout: 30_000, windowsHide: true },
    );
    await invoke("if ($PSVersionTable.PSEdition -ne 'Core' -or $PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 required' }");
    await assert.rejects(
      invoke("$global:BabelLauncherExitCode = 23"),
      (error: unknown) => (error as { code?: unknown }).code === 23,
    );
  },
);
