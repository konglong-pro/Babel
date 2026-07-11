import fs from "node:fs";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";

type CheckpointResult = {
  busy: number;
  checkpointed: number;
  log: number;
};

const configuredDatabasePath = process.env.ESPERANTO_DATABASE_PATH;
const databasePath =
  configuredDatabasePath === undefined
    ? path.resolve(process.cwd(), "..", "..", "data", "esperanto", "sqlite.db")
    : path.resolve(configuredDatabasePath);

if (!fs.existsSync(databasePath)) {
  throw new Error(
    `Database does not exist: ${databasePath}. Run npm run db:migrate first.`,
  );
}

const sqlite = new BetterSqlite3(databasePath, { fileMustExist: true });

try {
  sqlite.pragma("busy_timeout = 5000");
  const [result] = sqlite.pragma("wal_checkpoint(TRUNCATE)") as CheckpointResult[];

  if (!result || result.busy !== 0) {
    throw new Error(
      "Could not checkpoint the Esperanto database. Stop Esperanto and retry.",
    );
  }

  const integrity = sqlite.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") {
    throw new Error(`Database integrity check failed: ${String(integrity)}`);
  }
} finally {
  sqlite.close();
}

console.log(`Checkpointed and verified ${databasePath}.`);
