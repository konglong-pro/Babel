import assert from "node:assert/strict";
import test from "node:test";

import { openSearchWindow } from "../src/search/window";

test("search opens a named window and clears copied page sessions", () => {
  const removed: string[] = [];
  let focused = false;
  const popup = {
    opener: {},
    sessionStorage: { removeItem: (key: string) => removed.push(key) },
    focus: () => { focused = true; },
  } as unknown as Window;
  let call: string[] = [];
  const source = {
    open: (destination?: string | URL, name?: string, features?: string) => {
      call = [String(destination), name ?? "", features ?? ""];
      return popup;
    },
  } as Pick<Window, "open">;

  assert.equal(openSearchWindow(source, "/search?q=x", "babel-search", {
    sessionStorageKeys: ["babel:pages"],
  }), true);
  assert.deepEqual(call, [
    "/search?q=x",
    "babel-search",
    "popup=yes,width=1240,height=900,resizable=yes,scrollbars=yes",
  ]);
  assert.deepEqual(removed, ["babel:pages"]);
  assert.equal(popup.opener, null);
  assert.equal(focused, true);
});

test("blocked search windows do not navigate the source window", () => {
  const source = { open: () => null } as unknown as Pick<Window, "open">;
  assert.equal(openSearchWindow(source, "/search?q=x", "babel-search"), false);
});
