import path from "node:path";
import { createPdfLibraryHandlers } from "@babel-apps/platform/pdf/server";

export const pdfLibraryHandlers = createPdfLibraryHandlers({
  root: () => path.join(
    process.env.RETEX_NOTE_UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.RETEX_NOTE_UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "retex", "uploads", "notes"),
    "pdf-library",
  ),
});
