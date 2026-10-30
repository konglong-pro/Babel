import path from "node:path";
import { createHtmlLibraryHandlers } from "@babel-apps/platform/html/server";

export const htmlLibraryHandlers = createHtmlLibraryHandlers({
  root: () => path.join(
    process.env.LEVIATHAN_UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.LEVIATHAN_UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "leviathan", "uploads", "notes"),
    "html-library",
  ),
});
