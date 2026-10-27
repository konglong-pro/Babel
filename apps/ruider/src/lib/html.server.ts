import path from "node:path";
import { createHtmlLibraryHandlers } from "@babel-apps/platform/html/server";

export const htmlLibraryHandlers = createHtmlLibraryHandlers({
  root: () => path.join(
    process.env.RUIDER_UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.RUIDER_UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "ruider", "uploads", "notes"),
    "html-library",
  ),
});
