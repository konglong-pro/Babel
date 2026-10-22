import path from "node:path";
import { fileURLToPath } from "node:url";

import { runIsolatedNextBuild } from "@babel-apps/platform/build/next";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.exitCode = runIsolatedNextBuild({
  appDirectory,
  temporaryPrefix: "babel-herodotus-build-",
  environmentPaths: {
    HERODOTUS_DATABASE_PATH: ["sqlite.db"],
    HERODOTUS_UPLOAD_DIRECTORY: ["uploads"],
  },
});
