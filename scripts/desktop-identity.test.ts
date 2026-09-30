import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);

test("notebooks retain their own SVG branding and one favicon source", async () => {
  const apps = await readdir(path.join(root, "apps"), { withFileTypes: true });
  const appDirectories = apps.filter(entry => entry.isDirectory()).map(entry => `apps/${entry.name}`);
  appDirectories.push("templates/mirror-app");
  for (const app of appDirectories) {
    const directory = path.join(root, app, "src/app");
    assert.match(await readFile(path.join(directory, "icon.svg"), "utf8"), /<svg\b/, `${app} must supply its own mark`);
    assert.equal((await readdir(directory)).includes("icon.png"), false, `${app} must not advertise a second icon`);
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
