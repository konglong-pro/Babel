import path from "node:path";
import { createHtmlLibraryHandlers } from "@babel-apps/platform/html/server";

export const htmlLibraryHandlers = createHtmlLibraryHandlers({
  root: () => path.join(
    process.env.HERODOTUS_UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.HERODOTUS_UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "herodotus", "uploads", "notes"),
    "html-library",
  ),
});
