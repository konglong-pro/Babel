import path from "node:path";
import { createPdfLibraryHandlers } from "@babel-apps/platform/pdf/server";

export const pdfLibraryHandlers = createPdfLibraryHandlers({
  root: () => path.join(
    process.env.MATTER_NOTE_UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.MATTER_NOTE_UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "matter", "uploads", "notes"),
    "pdf-library",
  ),
});
