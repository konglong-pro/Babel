import fs from "node:fs";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";

type WalCheckpointResult = {
  busy: number;
  checkpointed: number;
  log: number;
};

export type CheckpointDatabaseOptions = {
  appName: string;
  databasePath: string;
  fileMustExist?: boolean;
};

export function checkpointDatabase(options: CheckpointDatabaseOptions): void {
  const databasePath = path.resolve(options.databasePath);
  if (!fs.existsSync(databasePath)) {
    throw new Error(
      `Database does not exist: ${databasePath}. Run npm run db:migrate first.`,
    );
  }

  const sqlite =
    options.fileMustExist === true
      ? new BetterSqlite3(databasePath, { fileMustExist: true })
      : new BetterSqlite3(databasePath);

  try {
    sqlite.pragma("busy_timeout = 5000");
    const [result] = sqlite.pragma("wal_checkpoint(TRUNCATE)") as WalCheckpointResult[];

    if (!result || result.busy !== 0) {
      throw new Error(
        `Could not checkpoint the ${options.appName} database. Stop ${options.appName} and retry.`,
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
}
