import path from "node:path";

import { runStandardNoteSearchBenchmark } from "../../../scripts/standard-note-search-benchmark";

async function main(): Promise<void> {
  await runStandardNoteSearchBenchmark({
    app: "__APP_ID__",
    workspace: "@babel-apps/__APP_ID__",
    databaseEnv: "__APP_ENV_PREFIX___DATABASE_PATH",
    uploadEnv: "__APP_ENV_PREFIX___UPLOAD_DIRECTORY",
    migrationsFolder: path.resolve(import.meta.dirname, "..", "drizzle"),
    importDatabase: () => import("../src/lib/db/client"),
    importRepositories: () => import("../src/lib/repositories"),
  });
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
