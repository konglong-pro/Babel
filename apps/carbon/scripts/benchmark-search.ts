import path from "node:path";

import { runStandardNoteSearchBenchmark } from "../../../scripts/standard-note-search-benchmark";

async function main(): Promise<void> {
  await runStandardNoteSearchBenchmark({
    app: "carbon",
    workspace: "@babel-apps/carbon",
    databaseEnv: "CARBON_DATABASE_PATH",
    uploadEnv: "CARBON_UPLOAD_DIRECTORY",
    migrationsFolder: path.resolve(import.meta.dirname, "..", "drizzle"),
    importDatabase: () => import("../src/lib/db/client"),
    importRepositories: () => import("../src/lib/repositories"),
  });
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
