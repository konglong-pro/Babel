import BetterSqlite3 from "better-sqlite3";

export type AssertLiveDatabaseMigrationsCurrentOptions = {
  appName: string;
  packageName: string;
  databasePath: string;
  expectedMigration: number;
  requiredColumns?: Readonly<Record<string, readonly string[]>>;
  requiredSchemaObjects?: readonly RequiredSchemaObject[];
};

export type RequiredSchemaObject = {
  type: "table" | "trigger";
  name: string;
  sqlIncludes?: readonly string[];
};

export type AssertOpenDatabaseMigrationsCurrentOptions = Omit<
  AssertLiveDatabaseMigrationsCurrentOptions,
  "databasePath"
> & {
  sqlite: BetterSqlite3.Database;
};

export function assertLiveDatabaseMigrationsCurrent(
  options: AssertLiveDatabaseMigrationsCurrentOptions,
): void {
  let sqlite: BetterSqlite3.Database;
  try {
    sqlite = new BetterSqlite3(options.databasePath, {
      readonly: true,
      fileMustExist: true,
    });
  } catch (error) {
    throw new Error(`${options.appName} database does not exist or cannot be opened.`, {
      cause: error,
    });
  }

  try {
    assertOpenDatabaseMigrationsCurrent({
      ...options,
      sqlite,
    });
  } finally {
    sqlite.close();
  }
}

export function assertOpenDatabaseMigrationsCurrent(
  options: AssertOpenDatabaseMigrationsCurrentOptions,
): void {
  const latestDatabaseMigration = readLatestDatabaseMigration(options.sqlite, options.appName);
  if (latestDatabaseMigration < options.expectedMigration) {
    throw new Error(
      `${options.appName} database migration is stale. Stop all Babel apps, run ` +
        '`npm.cmd run data:backup`, then run ' +
        `\`npm.cmd run db:migrate -w ${options.packageName}\`.`,
    );
  }
  if (latestDatabaseMigration > options.expectedMigration) {
    throw new Error(
      `${options.appName} database migration is ahead of this code ` +
        `(database: ${latestDatabaseMigration}; code: ${options.expectedMigration}).`,
    );
  }

  assertRequiredColumns(options.sqlite, options.appName, options.requiredColumns);
  assertRequiredSchemaObjects(
    options.sqlite,
    options.appName,
    options.requiredSchemaObjects,
  );
}

function assertRequiredSchemaObjects(
  sqlite: BetterSqlite3.Database,
  appName: string,
  requiredSchemaObjects: readonly RequiredSchemaObject[] | undefined,
): void {
  const statement = sqlite.prepare(
    "SELECT sql FROM sqlite_master WHERE type = ? AND name = ?",
  );
  for (const object of requiredSchemaObjects ?? []) {
    const row = statement.get(object.type, object.name) as
      | { sql: string | null }
      | undefined;
    if (row === undefined) {
      throw new Error(
        `${appName} database is missing required ${object.type}: ${object.name}.`,
      );
    }
    const actualSql = row.sql?.toLowerCase() ?? "";
    for (const fragment of object.sqlIncludes ?? []) {
      if (!actualSql.includes(fragment.toLowerCase())) {
        throw new Error(
          `${appName} database ${object.type} ${object.name} does not match the required schema.`,
        );
      }
    }
  }
}

function readLatestDatabaseMigration(
  sqlite: BetterSqlite3.Database,
  appName: string,
): number {
  let latest: unknown;
  try {
    latest = sqlite
      .prepare('SELECT max("created_at") FROM "__drizzle_migrations"')
      .pluck()
      .get();
  } catch (error) {
    throw new Error(`${appName} database migration history is missing.`, {
      cause: error,
    });
  }
  if (typeof latest !== "number" || !Number.isFinite(latest)) {
    throw new Error(`${appName} database migration history is missing.`);
  }
  return latest;
}

function assertRequiredColumns(
  sqlite: BetterSqlite3.Database,
  appName: string,
  requiredColumns: Readonly<Record<string, readonly string[]>> | undefined,
): void {
  for (const [table, columns] of Object.entries(requiredColumns ?? {})) {
    const escapedTable = table.replaceAll('"', '""');
    const actualColumns = new Set(
      (
        sqlite.prepare(`PRAGMA table_info("${escapedTable}")`).all() as Array<{
          name: string;
        }>
      ).map(({ name }) => name),
    );
    for (const column of columns) {
      if (!actualColumns.has(column)) {
        throw new Error(`${appName} database is missing required column: ${table}.${column}.`);
      }
    }
  }
}
