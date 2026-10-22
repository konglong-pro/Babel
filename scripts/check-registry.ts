import { access, readFile } from "node:fs/promises";
import path from "node:path";

type RegisteredApp = {
  name: string;
  id: string;
  workspace: string;
  port: number;
  healthPath: string;
  identityPath: string;
  identityText: string;
  readyTimeoutSeconds: number;
  env: Record<string, string>;
  requiredDataPaths: string[];
};

type Registry = {
  schemaVersion: number;
  apps: RegisteredApp[];
};

const root = path.resolve(import.meta.dirname, "..");
const registry = JSON.parse(
  await readFile(path.join(root, "babel.apps.json"), "utf8"),
) as Registry;
const rootPackage = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
) as { scripts?: Record<string, string> };

if (registry.schemaVersion !== 1) {
  throw new Error(`Unsupported registry schemaVersion: ${registry.schemaVersion}`);
}
if (!Array.isArray(registry.apps) || registry.apps.length === 0) {
  throw new Error("babel.apps.json must register at least one app");
}

const names = new Set<string>();
const ids = new Set<string>();
const ports = new Set<number>();

for (const app of registry.apps) {
  requireText(app.name, "name");
  requireText(app.id, `${app.name}.id`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(app.id)) {
    throw new Error(`${app.name}.id must use lowercase letters, digits, and hyphens`);
  }
  requireText(app.healthPath, `${app.name}.healthPath`);
  requireText(app.identityPath, `${app.name}.identityPath`);
  requireText(app.identityText, `${app.name}.identityText`);
  requireRoutePath(app.healthPath, `${app.name}.healthPath`);
  requireRoutePath(app.identityPath, `${app.name}.identityPath`);
  if (!Number.isInteger(app.port) || app.port < 3000 || app.port > 3999) {
    throw new Error(`${app.name}.port must be an integer in the 3000-3999 range`);
  }
  if (
    !Number.isInteger(app.readyTimeoutSeconds) ||
    app.readyTimeoutSeconds < 1 ||
    app.readyTimeoutSeconds > 600
  ) {
    throw new Error(`${app.name}.readyTimeoutSeconds must be an integer from 1 to 600`);
  }
  addUnique(names, app.name.toLowerCase(), "app name");
  addUnique(ids, app.id.toLowerCase(), "app id");
  addUnique(ports, app.port, "port");

  if (app.workspace !== `apps/${app.id}`) {
    throw new Error(`${app.name}.workspace must be apps/${app.id}`);
  }
  const workspace = resolveInsideRoot(app.workspace, `${app.name}.workspace`);
  const packageJson = JSON.parse(
    await readFile(path.join(workspace, "package.json"), "utf8"),
  ) as { name?: string; scripts?: Record<string, string> };
  if (packageJson.name !== `@babel-apps/${app.id}`) {
    throw new Error(
      `${app.name} workspace package must be named @babel-apps/${app.id}`,
    );
  }
  for (const scriptName of ["dev", "start"] as const) {
    const script = packageJson.scripts?.[scriptName];
    if (!script || !new RegExp(`(?:-p|--port)\\s+${app.port}(?:\\s|$)`).test(script)) {
      throw new Error(
        `${app.name} ${scriptName} script must use registry port ${app.port}`,
      );
    }
  }
  for (const scriptName of ["build", "db:check", "db:migrate"] as const) {
    requireText(
      packageJson.scripts?.[scriptName],
      `${app.name} workspace script ${scriptName}`,
    );
  }
  const rootDevScript = rootPackage.scripts?.[`dev:${app.id}`];
  if (rootDevScript !== `npm run dev -w @babel-apps/${app.id}`) {
    throw new Error(
      `Root package script dev:${app.id} must launch @babel-apps/${app.id}`,
    );
  }
  await requireSourceEntry(
    workspace,
    app.healthPath,
    "route.ts",
    `${app.name}.healthPath`,
  );
  await requireSourceEntry(
    workspace,
    app.identityPath,
    "page.tsx",
    `${app.name}.identityPath`,
  );

  if (!Array.isArray(app.requiredDataPaths) || app.requiredDataPaths.length === 0) {
    throw new Error(`${app.name}.requiredDataPaths must not be empty`);
  }
  for (const dataPath of app.requiredDataPaths) {
    const resolved = resolveInsideRoot(dataPath, `${app.name}.requiredDataPaths`);
    const appDataRoot = path.join(root, "data", app.id) + path.sep;
    if (!resolved.startsWith(appDataRoot)) {
      throw new Error(
        `${app.name} required data path must live under data/${app.id}/`,
      );
    }
  }
  const requiredDataPaths = new Set(app.requiredDataPaths);
  for (const [key, value] of Object.entries(app.env)) {
    requireText(key, `${app.name}.env key`);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`${app.name}.env key is not a valid environment variable: ${key}`);
    }
    resolveInsideRoot(value, `${app.name}.env.${key}`);
    if (!requiredDataPaths.has(value)) {
      throw new Error(
        `${app.name}.env.${key} must also appear in requiredDataPaths`,
      );
    }
  }
}

console.log(
  `Registry OK: ${registry.apps.map((app) => `${app.name}:${app.port}`).join(", ")}`,
);

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function addUnique<T>(set: Set<T>, value: T, label: string): void {
  if (set.has(value)) {
    throw new Error(`Duplicate ${label}: ${String(value)}`);
  }
  set.add(value);
}

function resolveInsideRoot(relativePath: string, label: string): string {
  requireText(relativePath, label);
  if (path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be relative to the Babel root`);
  }
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the Babel root`);
  }
  return resolved;
}

function requireRoutePath(value: string, label: string): void {
  if (
    !value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    value.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(`${label} must be an absolute application route path`);
  }
}

async function requireSourceEntry(
  workspace: string,
  routePath: string,
  filename: "route.ts" | "page.tsx",
  label: string,
): Promise<void> {
  const segments = routePath.split("/").filter(Boolean);
  const sourcePath = path.join(workspace, "src", "app", ...segments, filename);
  try {
    await access(sourcePath);
  } catch {
    throw new Error(`${label} does not resolve to ${path.relative(root, sourcePath)}`);
  }
}
