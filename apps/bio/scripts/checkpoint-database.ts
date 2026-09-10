import path from "node:path";

import { checkpointDatabase } from "@babel-apps/platform/db/checkpoint";
import { resolveDatabasePath } from "@babel-apps/platform/db/client";

checkpointDatabase({
  appName: "Bio",
  databasePath: resolveDatabasePath({
    envVar: "BIO_DATABASE_PATH",
    defaultPath: path.resolve(
      process.cwd(),
      "..",
      "..",
      "data",
      "bio",
      "sqlite.db",
    ),
  }),
  fileMustExist: true,
});
