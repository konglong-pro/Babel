import path from "node:path";
import { createDocumentImportHandlers } from "@babel-apps/platform/imports/document-server";

export const documentImportHandlers = createDocumentImportHandlers({
  originalRoot: () => path.join(
    process.env.__APP_ENV_PREFIX___UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.__APP_ENV_PREFIX___UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "__APP_ID__", "uploads", "notes"),
    "documents",
  ),
});
