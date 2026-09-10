import path from "node:path";

import { checkpointDatabase } from "@babel-apps/platform/db/checkpoint";
import { resolveDatabasePath } from "@babel-apps/platform/db/client";

checkpointDatabase({
  appName: "Ruider",
  databasePath: resolveDatabasePath({
    envVar: "RUIDER_DATABASE_PATH",
    defaultPath: path.resolve(
      process.cwd(),
      "..",
      "..",
      "data",
      "ruider",
      "sqlite.db",
    ),
  }),
  fileMustExist: true,
});
