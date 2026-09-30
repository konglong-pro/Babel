import path from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { db, sqlite } from "../src/lib/db/client";
import {
  finalizeLegacyExerciseProblems,
  prepareLegacyExerciseProblems,
} from "../src/lib/db/exercise-problem-migration";

async function main(): Promise<void> {
  try {
    const prepared = await prepareLegacyExerciseProblems(sqlite);
    sqlite.pragma("foreign_keys = OFF");
    migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });

    const violations = sqlite.pragma("foreign_key_check") as unknown[];
    if (violations.length > 0) {
      throw new Error(
        `ReTex migration created ${violations.length} foreign-key violation(s). Restore the backup before retrying.`,
      );
    }
    sqlite.pragma("foreign_keys = ON");

    const finalized = await finalizeLegacyExerciseProblems(sqlite);
    console.log(
      `ReTex database is up to date. Prepared ${prepared} and finalized ${finalized} legacy exercise problem image(s).`,
    );
  } finally {
    if (sqlite.open) {
      sqlite.pragma("foreign_keys = ON");
      sqlite.close();
    }
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
