import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

export interface IsolatedNextBuildOptions {
  appDirectory: string;
  temporaryPrefix: string;
  environmentPaths: Readonly<Record<string, readonly string[]>>;
}

export function runIsolatedNextBuild(
  options: IsolatedNextBuildOptions,
): number {
  const appDirectory = path.resolve(options.appDirectory);
  const temporaryDirectory = mkdtempSync(
    path.join(os.tmpdir(), options.temporaryPrefix),
  );

  try {
    const nextCli = createRequire(path.join(appDirectory, "package.json"))
      .resolve("next/dist/bin/next");
    const result = spawnSync(process.execPath, [nextCli, "build"], {
      cwd: appDirectory,
      env: {
        ...process.env,
        ...resolveIsolatedEnvironmentPaths(
          temporaryDirectory,
          options.environmentPaths,
        ),
      },
      stdio: "inherit",
      windowsHide: true,
    });

    if (result.error !== undefined) throw result.error;
    if (result.signal !== null) {
      throw new Error(`Next.js build was terminated by ${result.signal}.`);
    }
    return result.status ?? 1;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export function resolveIsolatedEnvironmentPaths(
  temporaryDirectory: string,
  environmentPaths: Readonly<Record<string, readonly string[]>>,
): Record<string, string> {
  const root = path.resolve(temporaryDirectory);
  const resolved: Record<string, string> = {};
  for (const [name, segments] of Object.entries(environmentPaths)) {
    if (!name || segments.length === 0) {
      throw new Error("Isolated build environment paths require a name and path.");
    }
    const target = path.resolve(root, ...segments);
    const relative = path.relative(root, target);
    if (
      relative === "" ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      throw new Error(`Isolated build path escapes its temporary root: ${name}.`);
    }
    resolved[name] = target;
  }
  return resolved;
}
