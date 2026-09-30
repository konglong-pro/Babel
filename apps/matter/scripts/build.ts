import path from "node:path";
import { fileURLToPath } from "node:url";

import { runIsolatedNextBuild } from "@babel-apps/platform/build/next";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.exitCode = runIsolatedNextBuild({
  appDirectory,
  temporaryPrefix: "babel-matter-build-",
  environmentPaths: {
    MATTER_DATABASE_PATH: ["sqlite.db"],
    MATTER_NOTE_UPLOAD_DIRECTORY: ["uploads", "notes"],
  },
});
