import path from "node:path";
import { createHtmlLibraryHandlers } from "@babel-apps/platform/html/server";

export const htmlLibraryHandlers = createHtmlLibraryHandlers({
  root: () => path.join(
    process.env.ESPERANTO_UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.ESPERANTO_UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "esperanto", "uploads", "notes"),
    "html-library",
  ),
});
