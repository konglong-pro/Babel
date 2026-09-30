import path from "node:path";
import { createDocumentImportHandlers } from "@babel-apps/platform/imports/document-server";

export const documentImportHandlers = createDocumentImportHandlers({
  originalRoot: () => path.join(
    process.env.RETEX_NOTE_UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.RETEX_NOTE_UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "retex", "uploads", "notes"),
    "documents",
  ),
});
