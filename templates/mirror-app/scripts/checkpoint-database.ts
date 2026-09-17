import path from "node:path";

import { checkpointDatabase } from "@babel-apps/platform/db/checkpoint";
import { resolveDatabasePath } from "@babel-apps/platform/db/client";

checkpointDatabase({
  appName: "__APP_NAME__",
  databasePath: resolveDatabasePath({
    envVar: "__APP_ENV_PREFIX___DATABASE_PATH",
    defaultPath: path.resolve(
      process.cwd(),
      "..",
      "..",
      "data",
      "__APP_ID__",
      "sqlite.db",
    ),
  }),
  fileMustExist: true,
});
