import path from "node:path";
import { createDocumentImportHandlers } from "@babel-apps/platform/imports/document-server";

export const documentImportHandlers = createDocumentImportHandlers({
  originalRoot: () => path.join(
    process.env.BIO_UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.BIO_UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "bio", "uploads", "notes"),
    "documents",
  ),
});
