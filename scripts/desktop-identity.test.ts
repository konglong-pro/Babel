import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);

test("every notebook and the scaffold use the existing Babel icon bytes", async () => {
  const icon = await readFile(path.join(root, "launcher/assets/Babel.png"));
  const apps = await readdir(path.join(root, "apps"), { withFileTypes: true });
  const appDirectories = apps.filter(entry => entry.isDirectory()).map(entry => `apps/${entry.name}`);
  appDirectories.push("templates/mirror-app");
  for (const app of appDirectories) {
    const directory = path.join(root, app, "src/app");
    assert.deepEqual(await readFile(path.join(directory, "icon.png")), icon, `${app} must use Babel's icon`);
    assert.equal((await readdir(directory)).includes("icon.svg"), false, `${app} must not advertise a second icon`);
  }
});

test("Babel windows expose their own taskbar identity and relaunch properties", {
  skip: process.platform !== "win32",
  timeout: 30_000,
}, async () => {
  const { stdout, stderr } = await execFileAsync("pwsh.exe", [
    "-NoLogo", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "launcher/Test-BabelIdentity.ps1"),
  ], { timeout: 28_000 });
  assert.equal(stderr, "");
  assert.match(stdout, /PASS Babel process identity/);
});
