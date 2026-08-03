import assert from "node:assert/strict";
import test from "node:test";

import {
  createPageSessionsState,
  pageSessionsReducer,
  parsePageSessions,
  scopedPageKey,
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

test("closing the active page prefers a neighbor in the same scope", () => {
  let state = createPageSessionsState([
    page("knowledge-1", { scope: "knowledge" }),
    page("code-1", { scope: "code" }),
    page("knowledge-2", { scope: "knowledge" }),
    page("code-2", { scope: "code" }),
    page("knowledge-3", { scope: "knowledge" }),
  ], "knowledge-2");

  state = pageSessionsReducer(state, { type: "close", key: "knowledge-2" });
  assert.equal(state.activeKey, "knowledge-3");

  state = pageSessionsReducer(state, { type: "close", key: "knowledge-3" });
  assert.equal(state.activeKey, "knowledge-1");
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
    page("1", { scope: "notes", dirty: true, pending: true }),
    page("draft", { restorable: false, dirty: true }),
  ], "draft");

  const restored = parsePageSessions(serializePageSessions(state));
  assert.deepEqual(restored.pages, [
    page("1", {
      scope: "notes",
      dirty: false,
      pending: false,
      restorable: true,
    }),
  ]);
  assert.equal(restored.activeKey, "1");
});

test("parsing legacy serialized sessions does not require a scope", () => {
  const restored = parsePageSessions(JSON.stringify({
    version: 1,
    activeKey: "legacy",
    pages: [{
      key: "legacy",
      kind: "Note",
      title: "Legacy page",
      href: "/notes?note=legacy",
    }],
  }));

  assert.deepEqual(restored.pages, [{
    key: "legacy",
    kind: "Note",
    title: "Legacy page",
    href: "/notes?note=legacy",
    restorable: true,
    dirty: false,
    pending: false,
  }]);
  assert.equal(restored.activeKey, "legacy");
});

test("page scopes are normalized and must not be empty", () => {
  assert.equal(
    createPageSessionsState([page("1", { scope: " notes " })]).pages[0]?.scope,
    "notes",
  );
  assert.throws(
    () => createPageSessionsState([page("1", { scope: " " })]),
    /optional scope/,
  );
});

test("scoped keys prevent pages in different processes from sharing an identity", () => {
  assert.equal(scopedPageKey("notes", "note:1"), "notes:note:1");
  assert.throws(() => scopedPageKey(" ", "note:1"), /non-empty scope/);

  const state = createPageSessionsState([
    page("note:1", { scope: "knowledge" }),
  ]);
  assert.throws(
    () => pageSessionsReducer(state, {
      type: "open",
      page: page("note:1", { scope: "code" }),
    }),
    /globally unique key/,
  );
  assert.throws(
    () => createPageSessionsState([
      page("note:1", { scope: "knowledge" }),
      page("note:1", { scope: "code" }),
    ]),
    /globally unique key/,
  );
});

test("moving and closing other pages preserve the requested page", () => {
  let state = createPageSessionsState([page("1"), page("2"), page("3")], "2");
  state = pageSessionsReducer(state, { type: "move", key: "3", toIndex: 0 });
  assert.deepEqual(state.pages.map(({ key }) => key), ["3", "1", "2"]);

  state = pageSessionsReducer(state, { type: "close-others", key: "1" });
  assert.deepEqual(state.pages.map(({ key }) => key), ["1"]);
  assert.equal(state.activeKey, "1");
});

test("legacy pages infer their process scope from the route pathname", () => {
  let state = createPageSessionsState([
    page("notes-1"),
    page("code-1", { kind: "Code", href: "/code?entry=1" }),
    page("notes-2"),
    page("scratch-1", {
      kind: "Scratch",
      href: "/exercise/1/scratch",
    }),
    page("scratch-2", {
      kind: "Scratch",
      href: "/exercise/2/scratch",
    }),
  ], "notes-1");

  state = pageSessionsReducer(state, { type: "close-others", key: "notes-1" });

  assert.deepEqual(state.pages.map(({ key }) => key), [
    "notes-1",
    "code-1",
    "scratch-1",
    "scratch-2",
  ]);
});

test("closing other pages only affects the target scope", () => {
  const codePage = page("code-1", {
    scope: "code",
    dirty: true,
    pending: true,
  });
  const legacyPage = page("legacy", { dirty: true });
  let state = createPageSessionsState([
    page("knowledge-1", { scope: "knowledge", dirty: true }),
    page("knowledge-2", { scope: "knowledge", pending: true }),
    codePage,
    legacyPage,
  ], "knowledge-2");

  state = pageSessionsReducer(state, {
    type: "close-others",
    key: "knowledge-1",
  });

  assert.deepEqual(state.pages, [
    page("knowledge-1", {
      scope: "knowledge",
      dirty: true,
      pending: false,
    }),
    codePage,
    page("legacy", { dirty: true, pending: false }),
  ]);
  assert.equal(state.activeKey, "knowledge-1");
});
