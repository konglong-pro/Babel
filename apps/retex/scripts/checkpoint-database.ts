import path from "node:path";

import { checkpointDatabase } from "@babel-apps/platform/db/checkpoint";
import { resolveDatabasePath } from "@babel-apps/platform/db/client";

checkpointDatabase({
  appName: "ReTex",
  databasePath: resolveDatabasePath({
    envVar: "RETEX_DATABASE_PATH",
    defaultPath: path.resolve(
      process.cwd(),
      "..",
      "..",
      "data",
      "retex",
      "sqlite.db",
    ),
  }),
  fileMustExist: false,
});
