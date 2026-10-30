import assert from "node:assert/strict";
import test from "node:test";

import { openSearchWindow } from "@babel-apps/platform/search/window";

import {
  documentSearchResultHref,
  valiSearchFocusFromParams,
  valiSearchFocusSourceLine,
} from "@/lib/search-focus";
import type {
  DocumentSearchField,
  DocumentSearchMatchDto,
  DocumentSearchResultDto,
} from "@/lib/types";

function searchMatch(field: DocumentSearchField): DocumentSearchMatchDto {
  return {
    matchedFields: [field],
    title: [{ text: "Result", highlighted: false }],
    tags: [],
    snippet: {
      field,
      parts: [{ text: "needle", highlighted: true }],
      truncatedStart: false,
      truncatedEnd: false,
    },
  };
}

test("search result links preserve a note or reflection locator", () => {
  const note: DocumentSearchResultDto = {
    kind: "note",
    id: 8,
    folderId: 3,
    parentId: null,
    title: "Result",
    tags: [],
    updatedAt: "2040-01-02T03:04:05.000Z",
    match: searchMatch("content"),
  };
  const reflection: DocumentSearchResultDto = {
    kind: "reflection",
    date: "2040-01-02",
    title: "2040-01-02",
    updatedAt: "2040-01-02T03:04:05.000Z",
    match: searchMatch("title"),
  };

  assert.equal(
    documentSearchResultHref(note, " literal needle "),
    "/notes?folder=3&note=8&search=literal+needle&searchField=content",
  );
  assert.equal(
    documentSearchResultHref(reflection, "2040"),
    "/reflection?date=2040-01-02&search=2040&searchField=title",
  );
});

test("search focus accepts known fields and finds a literal Markdown source line", () => {
  assert.deepEqual(
    valiSearchFocusFromParams({ search: " needle ", searchField: "content" }),
    { query: "needle", field: "content" },
  );
  assert.equal(
    valiSearchFocusFromParams({ search: "needle", searchField: "metadata" }),
    null,
  );
  assert.equal(
    valiSearchFocusSourceLine(
      "first\r\nsecond\nformatted **needle** value",
      { query: "needle", field: "content" },
    ),
    3,
  );
  assert.equal(
    valiSearchFocusSourceLine("needle", { query: "needle", field: "title" }),
    undefined,
  );
});

test("Vali search opens separately and clears cloned page sessions", () => {
  const removedStorageKeys: string[] = [];
  let openedDestination = "";
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
    open(destination?: string | URL) {
      openedDestination = String(destination);
      return popup;
    },
  } as Pick<Window, "open">;

  assert.equal(
    openSearchWindow(
      source,
      "/search?q=needle",
      "babel-vali-search",
      { sessionStorageKeys: ["babel:vali:pages"] },
    ),
    true,
  );
  assert.equal(openedDestination, "/search?q=needle");
  assert.deepEqual(removedStorageKeys, ["babel:vali:pages"]);
  assert.equal(popup.opener, null);
});

test("a blocked Vali search window reports failure without a fallback navigation", () => {
  const source = { open: () => null } as unknown as Pick<Window, "open">;
  assert.equal(openSearchWindow(source, "/search?q=needle", "babel-vali-search"), false);
});
