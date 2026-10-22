import path from "node:path";

import { checkpointDatabase } from "@babel-apps/platform/db/checkpoint";
import { resolveDatabasePath } from "@babel-apps/platform/db/client";

checkpointDatabase({
  appName: "Neum",
  databasePath: resolveDatabasePath({
    envVar: "NEUM_DATABASE_PATH",
    defaultPath: path.resolve(
      process.cwd(),
      "..",
      "..",
      "data",
      "neum",
      "sqlite.db",
    ),
  }),
  fileMustExist: true,
});
