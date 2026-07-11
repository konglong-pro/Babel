import { readFile } from "node:fs/promises";
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
  requireText(app.healthPath, `${app.name}.healthPath`);
  requireText(app.identityPath, `${app.name}.identityPath`);
  requireText(app.identityText, `${app.name}.identityText`);
  if (!Number.isInteger(app.port) || app.port < 3000 || app.port > 3999) {
    throw new Error(`${app.name}.port must be an integer in the 3000-3999 range`);
  }
  if (!Number.isInteger(app.readyTimeoutSeconds) || app.readyTimeoutSeconds < 1) {
    throw new Error(`${app.name}.readyTimeoutSeconds must be a positive integer`);
  }
  addUnique(names, app.name.toLowerCase(), "app name");
  addUnique(ids, app.id.toLowerCase(), "app id");
  addUnique(ports, app.port, "port");

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

  if (!Array.isArray(app.requiredDataPaths) || app.requiredDataPaths.length === 0) {
    throw new Error(`${app.name}.requiredDataPaths must not be empty`);
  }
  for (const dataPath of app.requiredDataPaths) {
    const resolved = resolveInsideRoot(dataPath, `${app.name}.requiredDataPaths`);
    if (!resolved.startsWith(path.join(root, "data") + path.sep)) {
      throw new Error(`${app.name} required data path must live under data/`);
    }
  }
  for (const [key, value] of Object.entries(app.env)) {
    requireText(key, `${app.name}.env key`);
    resolveInsideRoot(value, `${app.name}.env.${key}`);
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
