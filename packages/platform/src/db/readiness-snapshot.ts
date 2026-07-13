import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { readMigrationFiles } from "drizzle-orm/migrator";

import { assertLiveDatabaseMigrationsCurrent } from "./readiness";

export type AssertDatabaseMigrationsCurrentOptions = {
  appName: string;
  packageName: string;
  databasePath: string;
  migrationsFolder: string;
  requiredColumns?: Readonly<Record<string, readonly string[]>>;
};

export function assertDatabaseMigrationsCurrent(
  options: AssertDatabaseMigrationsCurrentOptions,
): void {
  const codeMigrations = readMigrationFiles({ migrationsFolder: options.migrationsFolder });
  const latestCodeMigration = codeMigrations.at(-1)?.folderMillis;
  if (latestCodeMigration === undefined) {
    throw new Error(`${options.appName} code migration history is missing.`);
  }

  const snapshot = createDatabaseSnapshot(options.databasePath, options.appName);
  try {
    assertLiveDatabaseMigrationsCurrent({
      appName: options.appName,
      packageName: options.packageName,
      databasePath: snapshot.databasePath,
      expectedMigration: latestCodeMigration,
      requiredColumns: options.requiredColumns,
    });
  } finally {
    rmSync(snapshot.directory, { recursive: true, force: true });
  }
}

function createDatabaseSnapshot(databasePath: string, appName: string): {
  directory: string;
  databasePath: string;
} {
  const directory = mkdtempSync(path.join(os.tmpdir(), "babel-db-readiness-"));
  const snapshotPath = path.join(directory, "sqlite.db");
  try {
    copyFileSync(databasePath, snapshotPath);
    for (const suffix of ["-wal", "-shm"]) {
      const sidecarPath = `${databasePath}${suffix}`;
      if (existsSync(sidecarPath)) {
        copyFileSync(sidecarPath, `${snapshotPath}${suffix}`);
      }
    }
    return { directory, databasePath: snapshotPath };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error(`${appName} database does not exist or cannot be read.`, {
      cause: error,
    });
  }
}
