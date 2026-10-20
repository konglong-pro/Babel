import path from "node:path";
import { createPdfLibraryHandlers } from "@babel-apps/platform/pdf/server";

export const pdfLibraryHandlers = createPdfLibraryHandlers({
  root: () => path.join(
    process.env.LEVIATHAN_UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.LEVIATHAN_UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "leviathan", "uploads", "notes"),
    "pdf-library",
  ),
});
