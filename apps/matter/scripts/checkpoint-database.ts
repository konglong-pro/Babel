import path from "node:path";

import { checkpointDatabase } from "@babel-apps/platform/db/checkpoint";
import { resolveDatabasePath } from "@babel-apps/platform/db/client";

checkpointDatabase({
  appName: "Matter",
  databasePath: resolveDatabasePath({
    envVar: "MATTER_DATABASE_PATH",
    defaultPath: path.resolve(
      process.cwd(),
      "..",
      "..",
      "data",
      "matter",
      "sqlite.db",
    ),
  }),
  fileMustExist: false,
});
