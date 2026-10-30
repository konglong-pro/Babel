import path from "node:path";
import { createDocumentImportHandlers } from "@babel-apps/platform/imports/document-server";

export const documentImportHandlers = createDocumentImportHandlers({
  originalRoot: () => path.join(
    process.env.HERODOTUS_UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.HERODOTUS_UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "herodotus", "uploads", "notes"),
    "documents",
  ),
});
