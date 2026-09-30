import path from "node:path";

import { checkpointDatabase } from "@babel-apps/platform/db/checkpoint";
import { resolveDatabasePath } from "@babel-apps/platform/db/client";

checkpointDatabase({
  appName: "Herodotus",
  databasePath: resolveDatabasePath({
    envVar: "HERODOTUS_DATABASE_PATH",
    defaultPath: path.resolve(
      process.cwd(),
      "..",
      "..",
      "data",
      "herodotus",
      "sqlite.db",
    ),
  }),
  fileMustExist: true,
});
