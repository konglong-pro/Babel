import path from "node:path";
import { createDocumentImportHandlers } from "@babel-apps/platform/imports/document-server";

export const documentImportHandlers = createDocumentImportHandlers({
  originalRoot: () => path.join(
    process.env.MATTER_NOTE_UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.MATTER_NOTE_UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "matter", "uploads", "notes"),
    "documents",
  ),
});
