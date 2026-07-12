import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectory = mkdtempSync(
  path.join(os.tmpdir(), "babel-herodotus-build-"),
);
const nextCli = createRequire(import.meta.url).resolve("next/dist/bin/next");
let exitCode = 1;

try {
  const result = spawnSync(process.execPath, [nextCli, "build"], {
    cwd: appDirectory,
    env: {
      ...process.env,
      HERODOTUS_DATABASE_PATH: path.join(temporaryDirectory, "sqlite.db"),
      HERODOTUS_UPLOAD_DIRECTORY: path.join(temporaryDirectory, "uploads"),
    },
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error !== undefined) throw result.error;
  if (result.signal !== null) {
    throw new Error(`Next.js build was terminated by ${result.signal}.`);
  }
  exitCode = result.status ?? 1;
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

if (exitCode !== 0) process.exitCode = exitCode;
