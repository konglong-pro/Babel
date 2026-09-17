import path from "node:path";

import { checkpointDatabase } from "@babel-apps/platform/db/checkpoint";
import { resolveDatabasePath } from "@babel-apps/platform/db/client";

checkpointDatabase({
  appName: "Vali",
  databasePath: resolveDatabasePath({
    envVar: "VALI_DATABASE_PATH",
    defaultPath: path.resolve(
      process.cwd(),
      "..",
      "..",
      "data",
      "vali",
      "sqlite.db",
    ),
  }),
  fileMustExist: true,
});
