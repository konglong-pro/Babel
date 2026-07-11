import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TEMPLATE_TOKENS = {
  name: "__APP_NAME__",
  id: "__APP_ID__",
  envPrefix: "__APP_ENV_PREFIX__",
  port: "__APP_PORT__",
} as const;

const MIN_APP_PORT = 3000;
const MAX_APP_PORT = 3999;
const DEFAULT_ROOT = path.resolve(import.meta.dirname, "..");

type JsonObject = Record<string, unknown>;

type RegistryDocument = JsonObject & {
  schemaVersion: number;
  apps: JsonObject[];
};

type RootPackage = JsonObject & {
  scripts: Record<string, string>;
};

export type CommandInvocation = {
  command: string;
  args: string[];
  cwd: string;
};

export type CommandRunner = (
  invocation: CommandInvocation,
) => void | Promise<void>;

export type ScaffoldOptions = {
  root?: string;
  templateRoot?: string;
  runCommand?: CommandRunner;
};

export type AppIdentity = {
  name: string;
  id: string;
  envPrefix: string;
};

export type ScaffoldResult = AppIdentity & {
  port: number;
  workspace: string;
};

export function deriveAppIdentity(rawName: string): AppIdentity {
  const name = rawName.trim().replace(/ +/g, " ");
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9 -]*[A-Za-z0-9])?$/.test(name)) {
    throw new Error(
      "Use a safe ASCII app name containing only letters, digits, spaces, and hyphens.",
    );
  }

  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error("The app name did not produce a valid Babel app id.");
  }

  return {
    name,
    id,
    envPrefix: id.toUpperCase().replace(/-/g, "_"),
  };
}

export function findNextFreePort(ports: Iterable<number>): number {
  const used = new Set(ports);
  for (let port = MIN_APP_PORT; port <= MAX_APP_PORT; port += 1) {
    if (!used.has(port)) return port;
  }
  throw new Error(`No free app ports remain in the ${MIN_APP_PORT}-${MAX_APP_PORT} range.`);
}

export async function scaffoldApp(
  rawName: string,
  options: ScaffoldOptions = {},
): Promise<ScaffoldResult> {
  const root = path.resolve(options.root ?? DEFAULT_ROOT);
  const identity = deriveAppIdentity(rawName);
  const lock = await acquireScaffoldLock(root);

  try {
    return await scaffoldAppWithLock(root, identity, options);
  } finally {
    await releaseScaffoldLock(lock);
  }
}

async function scaffoldAppWithLock(
  root: string,
  identity: AppIdentity,
  options: ScaffoldOptions,
): Promise<ScaffoldResult> {
  const templateRoot = path.resolve(
    options.templateRoot ?? path.join(root, "templates", "mirror-app"),
  );
  const workspace = `apps/${identity.id}`;
  const targetRoot = path.join(root, "apps", identity.id);
  const registryPath = path.join(root, "babel.apps.json");
  const packagePath = path.join(root, "package.json");
  const lockPath = path.join(root, "package-lock.json");

  await requireDirectory(templateRoot, "Mirror app template");
  if (await pathExists(targetRoot)) {
    throw new Error(`App workspace already exists: ${workspace}`);
  }

  const [registryBytes, packageBytes, lockBytes] = await Promise.all([
    readFile(registryPath),
    readFile(packagePath),
    readFile(lockPath),
  ]);
  const registry = parseRegistry(registryBytes);
  const rootPackage = parseRootPackage(packageBytes);
  assertUniqueIdentity(registry, identity);

  const devScriptName = `dev:${identity.id}`;
  if (Object.hasOwn(rootPackage.scripts, devScriptName)) {
    throw new Error(`Root package script already exists: ${devScriptName}`);
  }

  const port = findNextFreePort(
    registry.apps.map((app) => requireRegistryPort(app)),
  );
  const tokenValues: Record<(typeof TEMPLATE_TOKENS)[keyof typeof TEMPLATE_TOKENS], string> = {
    [TEMPLATE_TOKENS.name]: identity.name,
    [TEMPLATE_TOKENS.id]: identity.id,
    [TEMPLATE_TOKENS.envPrefix]: identity.envPrefix,
    [TEMPLATE_TOKENS.port]: String(port),
  };
  const databasePath = `data/${identity.id}/sqlite.db`;
  const uploadPath = `data/${identity.id}/uploads/notes`;
  const registryEntry: JsonObject = {
    name: identity.name,
    id: identity.id,
    workspace,
    port,
    healthPath: "/api/health",
    identityPath: "/notes",
    identityText: identity.name,
    readyTimeoutSeconds: 60,
    env: {
      [`${identity.envPrefix}_DATABASE_PATH`]: databasePath,
      [`${identity.envPrefix}_UPLOAD_DIRECTORY`]: uploadPath,
    },
    requiredDataPaths: [databasePath, uploadPath],
  };

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const runCommand = options.runCommand ?? defaultCommandRunner;
  let targetCreated = false;

  try {
    await mkdir(targetRoot);
    targetCreated = true;
    await copyRenderedEntries(templateRoot, targetRoot, tokenValues);

    registry.apps.push(registryEntry);
    rootPackage.scripts[devScriptName] = `npm run dev -w @babel-apps/${identity.id}`;
    await writeJson(registryPath, registry);
    await writeJson(packagePath, rootPackage);

    await runCommand({
      command: npmCommand,
      args: [
        "install",
        "--package-lock-only",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      cwd: root,
    });
    await runCommand({
      command: npmCommand,
      args: ["run", "registry:check"],
      cwd: root,
    });
  } catch (error) {
    await rollbackScaffold(
      error,
      targetCreated ? targetRoot : undefined,
      [
        [registryPath, registryBytes],
        [packagePath, packageBytes],
        [lockPath, lockBytes],
      ],
    );
    throw error;
  }

  return { ...identity, port, workspace };
}

async function acquireScaffoldLock(root: string) {
  const filename = path.join(root, ".new-app.lock");
  let handle;
  try {
    handle = await open(filename, "wx");
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new Error(
        `Another new-app command is already running. If it is not, remove the stale lock: ${filename}`,
        { cause: error },
      );
    }
    throw error;
  }

  try {
    await handle.writeFile(
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
      "utf8",
    );
  } catch (error) {
    await handle.close();
    await rm(filename, { force: true });
    throw error;
  }
  return { filename, handle };
}

async function releaseScaffoldLock(
  lock: Awaited<ReturnType<typeof acquireScaffoldLock>>,
): Promise<void> {
  await lock.handle.close();
  await rm(lock.filename, { force: true });
}

async function copyRenderedEntries(
  sourceRoot: string,
  targetRoot: string,
  values: Readonly<Record<string, string>>,
): Promise<void> {
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    const renderedName = renderTemplateText(
      entry.name,
      values,
      path.join(sourceRoot, entry.name),
    );
    if (
      renderedName === "" ||
      renderedName === "." ||
      renderedName === ".." ||
      renderedName.includes("/") ||
      renderedName.includes("\\")
    ) {
      throw new Error(`Template entry rendered to an unsafe name: ${entry.name}`);
    }

    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(targetRoot, renderedName);
    if (entry.isDirectory()) {
      await mkdir(targetPath);
      await copyRenderedEntries(sourcePath, targetPath, values);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Mirror app templates may contain only files and directories: ${sourcePath}`);
    }

    const sourceBytes = await readFile(sourcePath);
    const renderedBytes = renderTemplateBytes(sourceBytes, values, sourcePath);
    await writeFile(targetPath, renderedBytes, { flag: "wx" });
    const sourceStat = await lstat(sourcePath);
    await chmod(targetPath, sourceStat.mode & 0o777);
  }
}

function renderTemplateBytes(
  source: Buffer,
  values: Readonly<Record<string, string>>,
  sourcePath: string,
): Buffer {
  const containsToken = source.includes(Buffer.from("__APP_"));
  if (!containsToken) return source;

  const text = source.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(source)) {
    throw new Error(`Template token found in a non-UTF-8 file: ${sourcePath}`);
  }
  return Buffer.from(renderTemplateText(text, values, sourcePath), "utf8");
}

function renderTemplateText(
  source: string,
  values: Readonly<Record<string, string>>,
  sourcePath: string,
): string {
  let rendered = source;
  for (const [token, value] of Object.entries(values)) {
    rendered = rendered.replaceAll(token, () => value);
  }
  const unresolved = /__APP_[A-Z0-9_]+__/.exec(rendered)?.[0];
  if (unresolved !== undefined) {
    throw new Error(`Unresolved template token ${unresolved}: ${sourcePath}`);
  }
  return rendered;
}

function parseRegistry(source: Buffer): RegistryDocument {
  const parsed = parseJsonObject(source, "babel.apps.json");
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.apps)) {
    throw new Error("babel.apps.json must use schemaVersion 1 and contain an apps array.");
  }
  for (const app of parsed.apps) {
    if (!isJsonObject(app)) {
      throw new Error("babel.apps.json contains an invalid app entry.");
    }
    requireRegistryText(app, "name");
    requireRegistryText(app, "id");
    requireRegistryPort(app);
  }
  return parsed as RegistryDocument;
}

function parseRootPackage(source: Buffer): RootPackage {
  const parsed = parseJsonObject(source, "package.json");
  if (!isJsonObject(parsed.scripts)) {
    throw new Error("Root package.json must contain a scripts object.");
  }
  for (const value of Object.values(parsed.scripts)) {
    if (typeof value !== "string") {
      throw new Error("Root package.json scripts must be strings.");
    }
  }
  return parsed as RootPackage;
}

function parseJsonObject(source: Buffer, label: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`, { cause: error });
  }
  if (!isJsonObject(parsed)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  return parsed;
}

function assertUniqueIdentity(registry: RegistryDocument, identity: AppIdentity): void {
  const nameKey = identity.name.toLowerCase();
  const idKey = identity.id.toLowerCase();
  for (const app of registry.apps) {
    if (
      requireRegistryText(app, "name").toLowerCase() === nameKey ||
      requireRegistryText(app, "id").toLowerCase() === idKey
    ) {
      throw new Error(`App name or id is already registered: ${identity.name}`);
    }
  }
}

function requireRegistryText(app: JsonObject, field: "name" | "id"): string {
  const value = app[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Registry app ${field} must be a non-empty string.`);
  }
  return value;
}

function requireRegistryPort(app: JsonObject): number {
  const port = app.port;
  if (!Number.isInteger(port) || (port as number) < MIN_APP_PORT || (port as number) > MAX_APP_PORT) {
    throw new Error(`Registry app port must be an integer in the ${MIN_APP_PORT}-${MAX_APP_PORT} range.`);
  }
  return port as number;
}

async function requireDirectory(filename: string, label: string): Promise<void> {
  let stat;
  try {
    stat = await lstat(filename);
  } catch (error) {
    throw new Error(`${label} is missing: ${filename}`, { cause: error });
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory: ${filename}`);
  }
}

async function pathExists(filename: string): Promise<boolean> {
  try {
    await lstat(filename);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

async function writeJson(filename: string, value: unknown): Promise<void> {
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function rollbackScaffold(
  originalError: unknown,
  targetRoot: string | undefined,
  snapshots: ReadonlyArray<readonly [string, Buffer]>,
): Promise<void> {
  const rollbackErrors: unknown[] = [];
  if (targetRoot !== undefined) {
    try {
      await rm(targetRoot, { recursive: true, force: true });
    } catch (error) {
      rollbackErrors.push(error);
    }
  }
  for (const [filename, bytes] of snapshots) {
    try {
      await writeFile(filename, bytes);
    } catch (error) {
      rollbackErrors.push(error);
    }
  }
  if (rollbackErrors.length > 0) {
    throw new AggregateError(
      [originalError, ...rollbackErrors],
      "App scaffolding failed and rollback was incomplete.",
    );
  }
}

function defaultCommandRunner({ command, args, cwd }: CommandInvocation): void {
  const result = spawnSync(command, args, {
    cwd,
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(`Could not run ${command}.`, { cause: result.error });
  }
  if (result.status !== 0) {
    const suffix = result.signal ? ` (signal ${result.signal})` : "";
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${String(result.status)}${suffix}.`);
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  const modulePath = path.resolve(fileURLToPath(import.meta.url));
  const invokedPath = path.resolve(process.argv[1]);
  return process.platform === "win32"
    ? modulePath.toLowerCase() === invokedPath.toLowerCase()
    : modulePath === invokedPath;
}

async function runCli(): Promise<void> {
  const result = await scaffoldApp(process.argv.slice(2).join(" "));
  console.log(`Created ${result.name} at ${result.workspace} on port ${result.port}.`);
  console.log("No private data was created. Provision its database and uploads before launch or backup.");
}

if (isMainModule()) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
