import path from "node:path";
import { createHtmlLibraryHandlers } from "@babel-apps/platform/html/server";

export const htmlLibraryHandlers = createHtmlLibraryHandlers({
  root: () => path.join(
    process.env.MATTER_NOTE_UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.MATTER_NOTE_UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "matter", "uploads", "notes"),
    "html-library",
  ),
});
