import { existsSync } from "node:fs";
import Database from "better-sqlite3";

/** Called only after every registered app has stopped, before staging private data. */
export function verifyPdfMetadataForBackup(filename: string, appName: string): boolean {
  if (!existsSync(filename)) return false;
  const database = new Database(filename, { fileMustExist: true });
  try {
    database.pragma("busy_timeout = 5000");
    // Opening and reading also recovers any hot rollback journal after a crash.
    const mode = database.pragma("journal_mode = DELETE", { simple: true });
    if (mode !== "delete") throw new Error(`${appName} PDF metadata is busy; journal recovery did not finish`);
    const integrity = database.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error(`${appName} PDF integrity_check failed: ${String(integrity)}`);
  } finally { database.close(); }
  return true;
}
