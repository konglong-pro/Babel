import { openDatabase, type ValiDatabase } from "../db/client";
import { valiDatabasePath } from "../db/paths";
import { createValiVault } from "./module";
import type { ValiVault } from "./types";

interface ValiRuntime {
  database: ValiDatabase;
  filename: string;
  vault: ValiVault;
}

const globalForVali = globalThis as typeof globalThis & {
  __valiRuntime?: ValiRuntime;
};

export function getValiVault(): ValiVault {
  const filename = valiDatabasePath();
  const current = globalForVali.__valiRuntime;
  if (current) {
    if (current.filename !== filename) {
      throw new Error("Vali database path changed after initialization");
    }
    return current.vault;
  }

  const database = openDatabase(filename);
  try {
    const vault = createValiVault(database);
    globalForVali.__valiRuntime = { database, filename, vault };
    return vault;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function getInitializedValiDatabase(): ValiDatabase | undefined {
  const current = globalForVali.__valiRuntime;
  if (!current) {
    return undefined;
  }
  if (current.filename !== valiDatabasePath()) {
    throw new Error("Vali database path changed after initialization");
  }
  return current.database;
}
