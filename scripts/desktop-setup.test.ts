import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const setupScript = path.resolve(import.meta.dirname, "../launcher/Install-BabelDesktop.ps1");
const sdkVersion = "1.0.3537.50";
const offlinePackage = process.env.BABEL_WEBVIEW2_TEST_PACKAGE;
const windowsOnly = process.platform !== "win32" ? "The desktop setup uses PowerShell 7 on Windows." : false;

function runSetup(cache: string, packagePath: string) {
  return execFileAsync("pwsh.exe", [
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", setupScript,
    "-CacheDirectory", cache, "-PackagePath", packagePath,
  ], { timeout: 60_000 });
}

test("desktop setup rejects an unverified archive and cleans only its own staging directory", { skip: windowsOnly }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "babel-desktop-setup-"));
  try {
    const cache = path.join(directory, "cache");
    const archive = path.join(directory, "wrong-sdk.zip");
    await mkdir(cache);
    await writeFile(path.join(cache, "keep.txt"), "keep existing cache contents");
    await writeFile(archive, "not an official package");
    await assert.rejects(runSetup(cache, archive), /SHA256 mismatch/);
    assert.deepEqual(await readdir(cache), ["keep.txt"]);
    assert.equal(await readFile(archive, "utf8"), "not an official package");
    assert.equal(await readFile(path.join(cache, "keep.txt"), "utf8"), "keep existing cache contents");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("desktop setup refuses to overwrite an incomplete installed SDK", { skip: windowsOnly }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "babel-desktop-setup-"));
  try {
    const cache = path.join(directory, "cache");
    const install = path.join(cache, sdkVersion);
    await mkdir(install, { recursive: true });
    await writeFile(path.join(install, "keep.txt"), "previous installation");
    await assert.rejects(runSetup(cache, path.join(directory, "unused.zip")), /incomplete or modified/);
    assert.deepEqual(await readdir(cache), [sdkVersion]);
    assert.equal(await readFile(path.join(install, "keep.txt"), "utf8"), "previous installation");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("desktop setup installs the pinned offline SDK, reuses it, and detects later corruption", {
  skip: windowsOnly || (!offlinePackage ? "Set BABEL_WEBVIEW2_TEST_PACKAGE to the official pinned NuGet archive for the offline integration check." : false),
}, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "babel-desktop-setup-"));
  try {
    const cache = path.join(directory, "cache");
    const install = path.join(cache, sdkVersion);
    const first = await runSetup(cache, offlinePackage!);
    assert.match(first.stdout, /WebView2 SDK 1\.0\.3537\.50 is ready:/);
    const wpf = path.join(install, "lib_manual/netcoreapp3.0/Microsoft.Web.WebView2.Wpf.dll");
    const core = path.join(install, "lib_manual/netcoreapp3.0/Microsoft.Web.WebView2.Core.dll");
    assert.ok((await stat(core)).size > 0);
    for (const architecture of ["x64", "x86", "arm64"]) {
      assert.ok((await stat(path.join(install, `runtimes/win-${architecture}/native/WebView2Loader.dll`))).size > 0);
    }
    const original = await stat(wpf);
    const second = await runSetup(cache, path.join(directory, "unavailable-after-install.zip"));
    assert.match(second.stdout, /is ready:/);
    assert.equal((await stat(wpf)).mtimeMs, original.mtimeMs);
    assert.deepEqual(await readdir(cache), [sdkVersion]);
    await writeFile(wpf, "damaged SDK file");
    await assert.rejects(runSetup(cache, offlinePackage!), /incomplete or modified/);
    assert.equal(await readFile(wpf, "utf8"), "damaged SDK file");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
