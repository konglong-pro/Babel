import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const root = path.resolve(import.meta.dirname, "..");
const workerPath = path.join(root, "launcher", "Babel.ps1");
const guiPath = path.join(root, "launcher", "Babel.Gui.ps1");
const xamlPath = path.join(root, "launcher", "Babel.xaml");

const [workerSource, guiSource, xamlSource, rootManifestSource] = await Promise.all([
  readFile(workerPath, "utf8"),
  readFile(guiPath, "utf8"),
  readFile(xamlPath, "utf8"),
  readFile(path.join(root, "package.json"), "utf8"),
]);
const rootManifest = JSON.parse(rootManifestSource) as { engines?: { node?: string } };

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
  if (/\.ShowDialog\(\)/i.test(guiSource)) {
    missingContracts.push("avoid a modal loop that returns as soon as the window is hidden");
  }

  assert.deepEqual(missingContracts, []);
});

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
