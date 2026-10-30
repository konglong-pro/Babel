import path from "node:path";
import { createPdfLibraryHandlers } from "@babel-apps/platform/pdf/server";

export const pdfLibraryHandlers = createPdfLibraryHandlers({
  root: () => path.join(
    process.env.BIO_UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.BIO_UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "bio", "uploads", "notes"),
    "pdf-library",
  ),
});
