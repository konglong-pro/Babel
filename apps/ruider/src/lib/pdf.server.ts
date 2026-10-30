import path from "node:path";
import { createPdfLibraryHandlers } from "@babel-apps/platform/pdf/server";

export const pdfLibraryHandlers = createPdfLibraryHandlers({
  root: () => path.join(
    process.env.RUIDER_UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.RUIDER_UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "ruider", "uploads", "notes"),
    "pdf-library",
  ),
});
