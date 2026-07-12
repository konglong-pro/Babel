import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

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
