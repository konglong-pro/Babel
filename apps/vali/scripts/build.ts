import path from "node:path";
import { fileURLToPath } from "node:url";

import { runIsolatedNextBuild } from "@babel-apps/platform/build/next";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.exitCode = runIsolatedNextBuild({
  appDirectory,
  temporaryPrefix: "babel-vali-build-",
  environmentPaths: {
    VALI_DATABASE_PATH: ["sqlite.db"],
    VALI_UPLOAD_DIRECTORY: ["uploads"],
  },
});
