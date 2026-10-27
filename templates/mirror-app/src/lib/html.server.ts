import path from "node:path";
import { createHtmlLibraryHandlers } from "@babel-apps/platform/html/server";

export const htmlLibraryHandlers = createHtmlLibraryHandlers({
  root: () => path.join(
    process.env.__APP_ENV_PREFIX___UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.__APP_ENV_PREFIX___UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "__APP_ID__", "uploads", "notes"),
    "html-library",
  ),
});
