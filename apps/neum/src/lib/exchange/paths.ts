import { fileURLToPath } from "node:url";
import path from "node:path";

const babelRoot = fileURLToPath(new URL("../../../../../", import.meta.url));

export function defaultNeumDatabasePath(): string {
  return path.resolve(
    process.env.NEUM_DATABASE_PATH ??
      path.join(babelRoot, "data", "neum", "sqlite.db"),
  );
}

export function defaultNeumUploadDirectory(): string {
  return path.resolve(
    process.env.NEUM_UPLOAD_DIRECTORY ??
      path.join(babelRoot, "data", "neum", "uploads", "entries"),
  );
}
