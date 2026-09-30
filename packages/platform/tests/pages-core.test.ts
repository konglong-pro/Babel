import assert from "node:assert/strict";
import test from "node:test";

import {
  createPageNavigationState,
  createPageSessionsState,
  pageHistoryTarget,
  pageNavigationReducer,
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

test("visit history crosses process scopes without changing mounted dirty sessions or tab order", () => {
  let state = createPageNavigationState(createPageSessionsState([
    page("note", { scope: "notes", dirty: true }),
    page("code", { scope: "code", href: "/code?entry=2", pending: true }),
    page("other", { scope: "notes" }),
  ], "note"));
  state = pageNavigationReducer(state, { type: "activate", key: "code" });
  state = pageNavigationReducer(state, { type: "activate", key: "other" });
  const mountedPages = state.sessions.pages;

  assert.equal(pageHistoryTarget(state, -1)?.page.href, "/code?entry=2");
  state = pageNavigationReducer(state, { type: "visit-history", direction: -1 });
  assert.equal(state.sessions.activeKey, "code");
  state = pageNavigationReducer(state, { type: "visit-history", direction: -1 });
  assert.equal(state.sessions.activeKey, "note");
  assert.equal(pageHistoryTarget(state, -1), null);
  state = pageNavigationReducer(state, { type: "visit-history", direction: 1 });
  assert.equal(state.sessions.activeKey, "code");
  assert.equal(state.sessions.pages, mountedPages);
  assert.deepEqual(state.visits, ["note", "code", "other"]);
  assert.equal(state.sessions.pages[0]?.dirty, true);
  assert.equal(state.sessions.pages[1]?.pending, true);
});

test("status and reordering keep forward history while a new visit replaces its forward branch", () => {
  let state = createPageNavigationState(createPageSessionsState([
    page("1"), page("2"), page("3"), page("4"),
  ], "1"));
  for (const key of ["2", "3"]) state = pageNavigationReducer(state, { type: "activate", key });
  state = pageNavigationReducer(state, { type: "visit-history", direction: -1 });
  state = pageNavigationReducer(state, { type: "status", key: "2", dirty: true });
  state = pageNavigationReducer(state, { type: "move", key: "4", toIndex: 0 });
  state = pageNavigationReducer(state, { type: "activate", key: "2" });
  assert.deepEqual(state.visits, ["1", "2", "3"]);
  assert.equal(pageHistoryTarget(state, 1)?.page.key, "3");
  assert.deepEqual(state.sessions.pages.map(({ key }) => key), ["4", "1", "2", "3"]);

  state = pageNavigationReducer(state, { type: "activate", key: "4" });
  assert.deepEqual(state.visits, ["1", "2", "4"]);
  assert.equal(pageHistoryTarget(state, 1), null);
});

test("closed tabs reopen last first with saved identity only, including after the last tab closes", () => {
  let state = createPageNavigationState(createPageSessionsState([
    page("1", { scope: "notes", dirty: true, pending: true }),
    page("2"),
  ], "2"));
  state = pageNavigationReducer(state, { type: "close-tab", key: "1" });
  state = pageNavigationReducer(state, { type: "close-tab", key: "2" });
  assert.equal(state.sessions.activeKey, null);
  assert.equal(state.sessions.pages.length, 0);

  state = pageNavigationReducer(state, { type: "reopen-tab" });
  assert.equal(state.sessions.activeKey, "2");
  state = pageNavigationReducer(state, { type: "reopen-tab" });
  assert.equal(state.sessions.activeKey, "1");
  assert.deepEqual(state.sessions.pages[1], page("1", {
    scope: "notes", dirty: false, pending: false,
  }));
  assert.equal(state.closedPages.length, 0);
  assert.equal(pageNavigationReducer(state, { type: "reopen-tab" }), state);
});

test("discarded drafts and programmatic deletions cannot be reopened", () => {
  let state = createPageNavigationState(createPageSessionsState([
    page("saved"), page("draft", { restorable: false, dirty: true }),
  ], "draft"));
  state = pageNavigationReducer(state, { type: "close-tab", key: "draft" });
  assert.equal(state.closedPages.length, 0);
  state = pageNavigationReducer(state, { type: "close-tab", key: "saved" });
  assert.equal(state.closedPages.length, 1);
  state = pageNavigationReducer(state, { type: "close", key: "saved" });
  assert.equal(state.closedPages.length, 0);
  state = pageNavigationReducer(state, { type: "open", page: page("deleted") });
  state = pageNavigationReducer(state, { type: "close", key: "deleted" });
  assert.equal(state.closedPages.length, 0);
});

test("saving a draft migrates its visited identity and makes its later tab closure restorable", () => {
  let state = createPageNavigationState(createPageSessionsState([
    page("draft", { restorable: false, dirty: true }), page("other"),
  ], "draft"));
  state = pageNavigationReducer(state, { type: "activate", key: "other" });
  state = pageNavigationReducer(state, {
    type: "rekey", key: "draft", page: page("saved", { scope: "notes" }),
  });
  assert.equal(pageHistoryTarget(state, -1)?.page.key, "saved");
  assert.deepEqual(state.visits, ["saved", "other"]);
  state = pageNavigationReducer(state, { type: "close-tab", key: "saved" });
  assert.equal(pageHistoryTarget(state, -1), null);
  state = pageNavigationReducer(state, { type: "reopen-tab" });
  assert.equal(state.sessions.activeKey, "saved");
  assert.equal(state.sessions.pages.at(-1)?.restorable, undefined);
});

test("closing other tabs remembers only the same process and manual reopening avoids duplicates", () => {
  let state = createPageNavigationState(createPageSessionsState([
    page("1", { scope: "notes" }),
    page("2", { scope: "notes" }),
    page("code", { scope: "code", dirty: true }),
    page("3", { scope: "notes" }),
  ], "1"));
  state = pageNavigationReducer(state, { type: "close-other-tabs", key: "1" });
  assert.deepEqual(state.sessions.pages.map(({ key }) => key), ["1", "code"]);
  assert.deepEqual(state.closedPages.map(({ key }) => key), ["2", "3"]);
  assert.equal(state.sessions.pages[1]?.dirty, true);
  state = pageNavigationReducer(state, { type: "open", page: page("3", { scope: "notes" }) });
  assert.deepEqual(state.closedPages.map(({ key }) => key), ["2"]);
  state = pageNavigationReducer(state, { type: "reopen-tab" });
  assert.deepEqual(state.sessions.pages.map(({ key }) => key), ["1", "code", "3", "2"]);
});

test("history skips closed visits and remains bounded for a long-running notebook", () => {
  let state = createPageNavigationState(createPageSessionsState([page("start")]));
  for (let index = 0; index < 120; index += 1) {
    state = pageNavigationReducer(state, { type: "open", page: page(String(index)) });
  }
  assert.equal(state.visits.length, 100);
  assert.equal(state.visitIndex, 99);
  state = pageNavigationReducer(state, { type: "close-tab", key: "118" });
  assert.equal(pageHistoryTarget(state, -1)?.page.key, "117");
  for (let index = 0; index < 40; index += 1) {
    state = pageNavigationReducer(state, { type: "close-tab", key: String(index) });
  }
  assert.equal(state.closedPages.length, 30);
  assert.equal(state.closedPages.at(-1)?.key, "39");
  state = pageNavigationReducer(state, { type: "restore", state: createPageSessionsState([page("new")]) });
  assert.deepEqual(state.visits, ["new"]);
  assert.equal(state.closedPages.length, 0);
});
