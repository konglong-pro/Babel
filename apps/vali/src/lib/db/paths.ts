import { existsSync } from "node:fs";
import path from "node:path";

const VALI_PACKAGE_PATH = path.join("apps", "vali", "package.json");

export function resolveBabelRoot(startDirectory: string = process.cwd()): string {
  let candidate = path.resolve(startDirectory);

  while (true) {
    if (existsSync(path.join(candidate, VALI_PACKAGE_PATH))) {
      return candidate;
    }

    const parent = path.dirname(candidate);
    if (parent === candidate) {
      throw new Error(`Unable to locate the Babel monorepo root from ${startDirectory}`);
    }
    candidate = parent;
  }
}

export function defaultValiDatabasePath(): string {
  return path.join(resolveBabelRoot(), "data", "vali", "sqlite.db");
}

export function valiDatabasePath(): string {
  return process.env.VALI_DATABASE_PATH || defaultValiDatabasePath();
}

export function valiMigrationsPath(): string {
  return path.join(resolveBabelRoot(), "apps", "vali", "drizzle");
}
