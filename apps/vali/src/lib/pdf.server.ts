import path from "node:path";
import { createPdfLibraryHandlers } from "@babel-apps/platform/pdf/server";

export const pdfLibraryHandlers = createPdfLibraryHandlers({
  root: () => path.join(
    process.env.VALI_UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.VALI_UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "vali", "uploads", "notes"),
    "pdf-library",
  ),
});
