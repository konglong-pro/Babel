import path from "node:path";
import { createDocumentImportHandlers } from "@babel-apps/platform/imports/document-server";

export const documentImportHandlers = createDocumentImportHandlers({
  originalRoot: () => path.join(
    process.env.KLSCHE_UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.KLSCHE_UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "klsche", "uploads", "notes"),
    "documents",
  ),
});
