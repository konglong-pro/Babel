import path from "node:path";
import { createHtmlLibraryHandlers } from "@babel-apps/platform/html/server";

export const htmlLibraryHandlers = createHtmlLibraryHandlers({
  root: () => path.join(
    process.env.KLSCHE_UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.KLSCHE_UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "klsche", "uploads", "notes"),
    "html-library",
  ),
});
