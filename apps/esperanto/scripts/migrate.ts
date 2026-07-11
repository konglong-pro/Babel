import path from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { db, sqlite } from "../src/lib/db/client";

const migrationsFolder = path.resolve(process.cwd(), "drizzle");
migrate(db, { migrationsFolder });
sqlite.close();

console.log("Esperanto database is up to date.");
