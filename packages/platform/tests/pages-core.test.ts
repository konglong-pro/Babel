import assert from "node:assert/strict";
import test from "node:test";

import {
  createPageSessionsState,
  pageSessionsReducer,
  parsePageSessions,
  serializePageSessions,
  type PageSessionDescriptor,
} from "@babel-apps/platform/pages/core";

function page(
  key: string,
  patch: Partial<PageSessionDescriptor> = {},
): PageSessionDescriptor {
  return {
    key,
    kind: "Note",
    title: `Page ${key}`,
    href: `/notes?note=${key}`,
    ...patch,
  };
}

test("opening pages deduplicates stable identities and activates the target", () => {
  let state = createPageSessionsState([page("1")]);
  state = pageSessionsReducer(state, { type: "open", page: page("2") });
  state = pageSessionsReducer(state, {
    type: "open",
    page: page("1", { title: "Updated title" }),
  });

  assert.deepEqual(state.pages.map(({ key }) => key), ["1", "2"]);
  assert.equal(state.pages[0]?.title, "Updated title");
  assert.equal(state.activeKey, "1");
});

test("closing the active page selects its right neighbor before its left neighbor", () => {
  let state = createPageSessionsState([page("1"), page("2"), page("3")], "2");
  state = pageSessionsReducer(state, { type: "close", key: "2" });
  assert.equal(state.activeKey, "3");

  state = pageSessionsReducer(state, { type: "close", key: "3" });
  assert.equal(state.activeKey, "1");
});

test("rekeying a draft preserves its position and merges an existing stable page", () => {
  let state = createPageSessionsState(
    [page("1"), page("draft", { restorable: false }), page("2")],
    "draft",
  );
  state = pageSessionsReducer(state, {
    type: "rekey",
    key: "draft",
    page: page("3", { title: "Saved draft" }),
  });
  assert.deepEqual(state.pages.map(({ key }) => key), ["1", "3", "2"]);
  assert.equal(state.activeKey, "3");

  state = pageSessionsReducer(state, {
    type: "rekey",
    key: "3",
    page: page("2", { title: "Merged" }),
  });
  assert.deepEqual(state.pages.map(({ key }) => key), ["1", "2"]);
  assert.equal(state.pages[1]?.title, "Merged");
  assert.equal(state.activeKey, "2");
});

test("serialized sessions omit drafts and transient dirty state", () => {
  const state = createPageSessionsState([
    page("1", { dirty: true, pending: true }),
    page("draft", { restorable: false, dirty: true }),
  ], "draft");

  const restored = parsePageSessions(serializePageSessions(state));
  assert.deepEqual(restored.pages, [
    page("1", { dirty: false, pending: false, restorable: true }),
  ]);
  assert.equal(restored.activeKey, "1");
});

test("moving and closing other pages preserve the requested page", () => {
  let state = createPageSessionsState([page("1"), page("2"), page("3")], "2");
  state = pageSessionsReducer(state, { type: "move", key: "3", toIndex: 0 });
  assert.deepEqual(state.pages.map(({ key }) => key), ["3", "1", "2"]);

  state = pageSessionsReducer(state, { type: "close-others", key: "1" });
  assert.deepEqual(state.pages.map(({ key }) => key), ["1"]);
  assert.equal(state.activeKey, "1");
});
