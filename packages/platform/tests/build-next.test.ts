import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveIsolatedEnvironmentPaths } from "../src/build/next";

test("isolated Next build paths share one temporary root", () => {
  const root = path.resolve("temporary-build-root");
  assert.deepEqual(
    resolveIsolatedEnvironmentPaths(root, {
      APP_DATABASE_PATH: ["sqlite.db"],
      APP_UPLOAD_DIRECTORY: ["uploads", "notes"],
    }),
    {
      APP_DATABASE_PATH: path.join(root, "sqlite.db"),
      APP_UPLOAD_DIRECTORY: path.join(root, "uploads", "notes"),
    },
  );
});

test("isolated Next build paths reject empty and escaping paths", () => {
  assert.throws(
    () => resolveIsolatedEnvironmentPaths("temporary-build-root", {
      APP_DATABASE_PATH: [],
    }),
    /require a name and path/i,
  );
  assert.throws(
    () => resolveIsolatedEnvironmentPaths("temporary-build-root", {
      APP_DATABASE_PATH: ["..", "sqlite.db"],
    }),
    /escapes its temporary root/i,
  );
});
