import path from "node:path";

import { checkpointDatabase } from "@babel-apps/platform/db/checkpoint";
import { resolveDatabasePath } from "@babel-apps/platform/db/client";

checkpointDatabase({
  appName: "Leviathan",
  databasePath: resolveDatabasePath({
    envVar: "LEVIATHAN_DATABASE_PATH",
    defaultPath: path.resolve(
      process.cwd(),
      "..",
      "..",
      "data",
      "leviathan",
      "sqlite.db",
    ),
  }),
  fileMustExist: true,
});
