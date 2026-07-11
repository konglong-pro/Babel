import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import Database from "better-sqlite3";

type RegisteredApp = {
  name: string;
  port: number;
  env: Record<string, string>;
};

type Registry = {
  apps: RegisteredApp[];
};

const root = path.resolve(import.meta.dirname, "..");
const dataRoot = path.join(root, "data");
const registry = JSON.parse(
  await readFile(path.join(root, "babel.apps.json"), "utf8"),
) as Registry;

const listening = (
  await Promise.all(
    registry.apps.map(async (app) => ({ app, open: await isPortOpen(app.port) })),
  )
).filter(({ open }) => open);
if (listening.length > 0) {
  throw new Error(
    `Refusing to back up while apps are listening: ${listening
      .map(({ app }) => `${app.name}:${app.port}`)
      .join(", ")}`,
  );
}

assertDataRepository();

for (const app of registry.apps) {
  const databaseEntry = Object.entries(app.env).find(([name]) =>
    name.endsWith("_DATABASE_PATH"),
  );
  if (!databaseEntry) {
    throw new Error(`${app.name} has no *_DATABASE_PATH registry entry`);
  }
  const filename = resolveInsideRoot(databaseEntry[1]);
  if (!existsSync(filename)) {
    throw new Error(`${app.name} database is missing: ${filename}`);
  }

  const database = new Database(filename, { fileMustExist: true });
  try {
    database.pragma("busy_timeout = 5000");
    const [checkpoint] = database.pragma("wal_checkpoint(TRUNCATE)") as Array<{
      busy: number;
    }>;
    if (!checkpoint || checkpoint.busy !== 0) {
      throw new Error(`${app.name} database is busy; checkpoint did not finish`);
    }
    const integrity = database.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") {
      throw new Error(`${app.name} integrity_check failed: ${String(integrity)}`);
    }
  } finally {
    database.close();
  }
  console.log(`[database] ${app.name} checkpointed and verified`);
}

runGit(["add", "-A"]);
const staged = runGit(["diff", "--cached", "--name-only"], true).trim();
const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
if (staged !== "") {
  runGit(["commit", "-m", `backup ${timestamp}`]);
} else {
  console.log("[git] No data changes to commit");
}
runGit(["push"]);

function assertDataRepository(): void {
  if (!existsSync(path.join(dataRoot, ".git"))) {
    throw new Error(`data/ is not an independent Git repository: ${dataRoot}`);
  }
  const topLevel = runGit(["rev-parse", "--show-toplevel"], true).trim();
  if (realpathSync.native(topLevel).toLowerCase() !== realpathSync.native(dataRoot).toLowerCase()) {
    throw new Error(`Unexpected data repository root: ${topLevel}`);
  }
  const origin = runGit(["remote", "get-url", "origin"], true).trim();
  if (origin === "") {
    throw new Error("data repository has no origin remote");
  }
}

function resolveInsideRoot(relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Registry data path must be relative: ${relativePath}`);
  }
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Registry data path escapes Babel root: ${relativePath}`);
  }
  return resolved;
}

function runGit(args: string[], capture = false): string {
  const result = spawnSync("git", ["-C", dataRoot, ...args], {
    encoding: "utf8",
    shell: false,
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed${result.stderr ? `: ${result.stderr.trim()}` : ""}`,
    );
  }
  return result.stdout ?? "";
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(400);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}
