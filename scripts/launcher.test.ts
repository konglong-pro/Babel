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
const xamlPath = path.join(root, "launcher", "Babel.xaml");
const shortcutsHelperPath = path.join(root, "launcher", "Babel.Shortcuts.ps1");
const shortcutsXamlPath = path.join(root, "launcher", "Babel.Shortcuts.xaml");
const shortcutDefaultsPath = path.join(root, "packages", "platform", "shortcuts.defaults.json");

const [
  workerSource,
  guiSource,
  xamlSource,
  shortcutsHelperSource,
  shortcutsXamlSource,
  shortcutDefaultsSource,
  rootManifestSource,
] = await Promise.all([
  readFile(workerPath, "utf8"),
  readFile(guiPath, "utf8"),
  readFile(xamlPath, "utf8"),
  readFile(shortcutsHelperPath, "utf8"),
  readFile(shortcutsXamlPath, "utf8"),
  readFile(shortcutDefaultsPath, "utf8"),
  readFile(path.join(root, "package.json"), "utf8"),
]);
const rootManifest = JSON.parse(rootManifestSource) as { engines?: { node?: string } };
const shortcutDefaults = JSON.parse(shortcutDefaultsSource) as {
  schemaVersion?: number;
  commands?: Array<{ command?: string; label?: string; defaultBinding?: string }>;
};

test("the launcher exposes backend URLs without a browser action", () => {
  assert.equal(
    /Start-Process\s+-FilePath\s+\$status\.App\.Url/i.test(workerSource),
    false,
    "the worker must not open an application URL",
  );
  assert.equal(
    /Start-Process\s+-FilePath\s+\$app\.OpenUrl/i.test(guiSource),
    false,
    "the GUI must not open an application URL",
  );
  assert.equal(/\bOpenButton\b/.test(guiSource), false, "the GUI script must not expose an Open button");
  assert.equal(/\bOpenButton\b/.test(xamlSource), false, "the XAML must not expose an Open button");
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

test("the launcher separates internal probes from the public identity URL", () => {
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
    /\bIdentityHealthUrl\s*=\s*\$internalBaseUrl\s*\+\s*\$identityPath/i,
    "identity readiness checks must use the internal loopback URL",
  );
  assert.match(
    workerSource,
    /\bIdentityUrl\s*=\s*\$publicBaseUrl\s*\+\s*\$identityPath/i,
    "the identity URL shown to users must use localhost",
  );
  assert.match(
    appHealthSource,
    /-Uri\s+\$App\.IdentityHealthUrl\b/i,
    "Test-AppHealth must request the internal identity health URL",
  );
  assert.doesNotMatch(
    appHealthSource,
    /-Uri\s+\$App\.IdentityUrl\b/i,
    "Test-AppHealth must not request the public identity URL",
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

test("the launcher edits the shared eight-command shortcut contract", () => {
  assert.equal(shortcutDefaults.schemaVersion, 1);
  assert.deepEqual(
    shortcutDefaults.commands?.map(({ command, defaultBinding }) => [command, defaultBinding]),
    [
      ["save", "Ctrl+S"],
      ["new", "Ctrl+Alt+N"],
      ["edit", "Ctrl+Alt+E"],
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
  for (const reservedBinding of ["Alt+F4", "Ctrl+W", "Ctrl+T", "Ctrl+L", "Ctrl+R", "Ctrl+Shift+T", "F5"]) {
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
$bindings = Get-BabelDefaultShortcutBindings -Definitions $definitions
[void](Write-BabelShortcutSettings -Definitions $definitions -Bindings $bindings -Path $settingsPath)
$bindings["save"] = "Ctrl+Alt+S"
[void](Write-BabelShortcutSettings -Definitions $definitions -Bindings $bindings -Path $settingsPath)
$loaded = Read-BabelShortcutSettings -Definitions $definitions -Path $settingsPath
if ($loaded.Source -ne "User" -or $loaded.Bindings["save"] -ne "Ctrl+Alt+S") {
    throw "Shortcut settings did not survive an atomic replacement round trip."
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
      assert.equal(savedSettings.schemaVersion, 1);
      assert.equal(savedSettings.bindings?.save, "Ctrl+Alt+S");
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
  if (!/\$script:Window\.Add_Closing[\s\S]{0,720}Request-WorkerStop/i.test(guiSource)) {
    missingContracts.push("keep graceful worker shutdown behind the close lifecycle");
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
    assert.match(stdout, /8 shortcut command\(s\)/i);
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
