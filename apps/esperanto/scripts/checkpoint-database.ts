import path from "node:path";

import { checkpointDatabase } from "@babel-apps/platform/db/checkpoint";
import { resolveDatabasePath } from "@babel-apps/platform/db/client";

checkpointDatabase({
  appName: "Esperanto",
  databasePath: resolveDatabasePath({
    envVar: "ESPERANTO_DATABASE_PATH",
    defaultPath: path.resolve(
      process.cwd(),
      "..",
      "..",
      "data",
      "esperanto",
      "sqlite.db",
    ),
  }),
  fileMustExist: true,
});
