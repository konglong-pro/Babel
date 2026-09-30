import path from "node:path";

import { checkpointDatabase } from "@babel-apps/platform/db/checkpoint";
import { resolveDatabasePath } from "@babel-apps/platform/db/client";

checkpointDatabase({
  appName: "KLsche",
  databasePath: resolveDatabasePath({
    envVar: "KLSCHE_DATABASE_PATH",
    defaultPath: path.resolve(
      process.cwd(),
      "..",
      "..",
      "data",
      "klsche",
      "sqlite.db",
    ),
  }),
  fileMustExist: true,
});
