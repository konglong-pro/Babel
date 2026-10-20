import path from "node:path";
import { createPdfLibraryHandlers } from "@babel-apps/platform/pdf/server";

export const pdfLibraryHandlers = createPdfLibraryHandlers({
  root: () => path.join(
    process.env.__APP_ENV_PREFIX___UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.__APP_ENV_PREFIX___UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "__APP_ID__", "uploads", "notes"),
    "pdf-library",
  ),
});
