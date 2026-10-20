import path from "node:path";
import { createPdfLibraryHandlers } from "@babel-apps/platform/pdf/server";

export const pdfLibraryHandlers = createPdfLibraryHandlers({
  root: () => path.join(
    process.env.NEUM_UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.NEUM_UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "neum", "uploads", "entries"),
    "pdf-library",
  ),
});
