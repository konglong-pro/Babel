import assert from "node:assert/strict";
import test from "node:test";

import { openSearchWindow } from "@babel-apps/platform/search/window";

test("search opens in a reusable standalone window", () => {
  let opened: { destination: string; name: string; features: string } | null = null;
  let focused = false;
  const removedStorageKeys: string[] = [];
  const popup = {
    opener: {},
    sessionStorage: {
      removeItem(key: string) {
        removedStorageKeys.push(key);
      },
    },
    focus() {
      focused = true;
    },
  } as unknown as Window;
  const source = {
    open(destination?: string | URL, name?: string, features?: string) {
      opened = {
        destination: String(destination),
        name: name ?? "",
        features: features ?? "",
      };
      return popup;
    },
  } as Pick<Window, "open">;

  assert.equal(
    openSearchWindow(
      source,
      "/search?q=unsigned",
      "babel-neum-search",
      { sessionStorageKeys: ["babel:neum:pages"] },
    ),
    true,
  );
  assert.deepEqual(opened, {
    destination: "/search?q=unsigned",
    name: "babel-neum-search",
    features: "popup=yes,width=1240,height=900,resizable=yes,scrollbars=yes",
  });
  assert.equal(popup.opener, null);
  assert.equal(focused, true);
  assert.deepEqual(removedStorageKeys, ["babel:neum:pages"]);
});

test("a blocked search window leaves the current workspace untouched", () => {
  const source = { open: () => null } as unknown as Pick<Window, "open">;
  assert.equal(openSearchWindow(source, "/search?q=unsigned", "babel-neum-search"), false);
});
