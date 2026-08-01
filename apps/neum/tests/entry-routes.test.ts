import assert from "node:assert/strict";
import test from "node:test";

import {
  entryUnitLabel,
  entryUnitPath,
  entryWorkspaceHref,
} from "@/lib/entry-routes";
import {
  entrySearchFocusFromParams,
  entrySearchFocusSourceLine,
} from "@/lib/search-focus";

test("entry units expose stable workspace routes", () => {
  assert.equal(entryUnitPath("knowledge"), "/knowledge");
  assert.equal(entryUnitPath("snippet"), "/code");
  assert.equal(entryUnitLabel("knowledge"), "Knowledge");
  assert.equal(entryUnitLabel("snippet"), "Code");
  assert.equal(
    entryWorkspaceHref("knowledge", { folderId: 3, entryId: 8 }),
    "/knowledge?folder=3&entry=8",
  );
  assert.equal(entryWorkspaceHref("snippet"), "/code");
  assert.equal(
    entryWorkspaceHref("knowledge", {
      folderId: 3,
      entryId: 8,
      searchFocus: { query: "unsigned value", field: "notesMd" },
    }),
    "/knowledge?folder=3&entry=8&search=unsigned+value&searchField=notesMd",
  );
  assert.deepEqual(
    entrySearchFocusFromParams({ search: " unsigned value ", searchField: "notesMd" }),
    { query: "unsigned value", field: "notesMd" },
  );
  assert.equal(
    entrySearchFocusFromParams({ search: "unsigned", searchField: "unknown" }),
    null,
  );
  assert.equal(
    entrySearchFocusSourceLine(
      "first\r\nsecond\nformatted **unsigned** value",
      { query: "unsigned", field: "notesMd" },
    ),
    3,
  );
  assert.equal(
    entrySearchFocusSourceLine("unsigned", { query: "unsigned", field: "code" }),
    undefined,
  );
});
