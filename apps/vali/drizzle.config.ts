import { defineConfig } from "drizzle-kit";

import { valiDatabasePath } from "./src/lib/db/paths";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: valiDatabasePath(),
  },
});
