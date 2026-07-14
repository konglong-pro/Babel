import assert from "node:assert/strict";
import test from "node:test";

import {
  entryUnitLabel,
  entryUnitPath,
  entryWorkspaceHref,
} from "@/lib/entry-routes";

test("entry units expose stable workspace routes", () => {
  assert.equal(entryUnitPath("knowledge"), "/knowledge");
  assert.equal(entryUnitPath("snippet"), "/code");
  assert.equal(entryUnitLabel("knowledge"), "Knowledge");
  assert.equal(entryUnitLabel("snippet"), "Code");
  assert.equal(
    entryWorkspaceHref("knowledge", { folderId: 3, entryId: 8 }),
    "/knowledge?folder=3&entry=8",
  );
  assert.equal(
    entryWorkspaceHref("snippet", { trashId: 5 }),
    "/code?view=trash&trash=5",
  );
});
