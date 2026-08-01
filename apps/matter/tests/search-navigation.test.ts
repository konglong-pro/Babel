import assert from "node:assert/strict";
import test from "node:test";

import { openSearchWindow } from "@babel-apps/platform/search/window";

import {
  archiveSearchFocusFromParams,
  archiveSearchFocusSourceLine,
  archiveSearchResultHref,
} from "@/lib/search-focus";

test("search result URLs preserve a validated field focus", () => {
  assert.equal(
    archiveSearchResultHref("exercise", {
      folderId: 4,
      itemId: 9,
      searchFocus: { query: "unsigned value", field: "solution" },
    }),
    "/exercise?folder=4&item=9&search=unsigned+value&searchField=solution",
  );
  assert.deepEqual(
    archiveSearchFocusFromParams(
      { search: " unsigned value ", searchField: "answer" },
      "exercise",
    ),
    { query: "unsigned value", field: "answer" },
  );
  assert.equal(
    archiveSearchFocusFromParams({ search: "unsigned", searchField: "scratch" }, "exercise"),
    null,
  );
  assert.equal(
    archiveSearchFocusFromParams({ search: "unsigned", searchField: "solution" }, "knowledge"),
    null,
  );
});

test("Markdown focus resolves only inside the matched field", () => {
  const focus = { query: "target", field: "solution" } as const;
  assert.equal(
    archiveSearchFocusSourceLine("first\r\nsecond\ntarget value", focus, "solution"),
    3,
  );
  assert.equal(
    archiveSearchFocusSourceLine("target value", focus, "problem"),
    undefined,
  );
});

test("search opens in its own reusable window and clears cloned page sessions", () => {
  let opened: { destination: string; name: string } | null = null;
  const removedStorageKeys: string[] = [];
  const popup = {
    opener: {},
    sessionStorage: {
      removeItem(key: string) {
        removedStorageKeys.push(key);
      },
    },
    focus() {},
  } as unknown as Window;
  const source = {
    open(destination?: string | URL, name?: string) {
      opened = { destination: String(destination), name: name ?? "" };
      return popup;
    },
  } as Pick<Window, "open">;

  assert.equal(
    openSearchWindow(source, "/search?q=target", "babel-matter-search", {
      sessionStorageKeys: ["babel:matter:pages"],
    }),
    true,
  );
  assert.deepEqual(opened, {
    destination: "/search?q=target",
    name: "babel-matter-search",
  });
  assert.deepEqual(removedStorageKeys, ["babel:matter:pages"]);

  const blocked = { open: () => null } as unknown as Pick<Window, "open">;
  assert.equal(openSearchWindow(blocked, "/search?q=target", "babel-matter-search"), false);
});
