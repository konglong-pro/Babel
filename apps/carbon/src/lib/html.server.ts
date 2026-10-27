import path from "node:path";
import { createHtmlLibraryHandlers } from "@babel-apps/platform/html/server";

export const htmlLibraryHandlers = createHtmlLibraryHandlers({
  root: () => path.join(
    process.env.CARBON_UPLOAD_DIRECTORY
      ? path.resolve(/* turbopackIgnore: true */ process.env.CARBON_UPLOAD_DIRECTORY!)
      : path.resolve(process.cwd(), "..", "..", "data", "carbon", "uploads", "notes"),
    "html-library",
  ),
});
