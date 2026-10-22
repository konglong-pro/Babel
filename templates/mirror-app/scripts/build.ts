import path from "node:path";
import { fileURLToPath } from "node:url";

import { runIsolatedNextBuild } from "@babel-apps/platform/build/next";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.exitCode = runIsolatedNextBuild({
  appDirectory,
  temporaryPrefix: "babel-__APP_ID__-build-",
  environmentPaths: {
    __APP_ENV_PREFIX___DATABASE_PATH: ["sqlite.db"],
    __APP_ENV_PREFIX___UPLOAD_DIRECTORY: ["uploads"],
  },
});
