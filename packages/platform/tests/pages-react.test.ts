import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  createWorkspaceProcessRouteTargetTracker,
  PageDeckPage,
  PageSessionProvider,
  PageTabs,
  WorkspaceProcessHost,
  workspaceProcessActivationKey,
  workspaceProcessPageKey,
  workspaceProcessRouteTargetShouldApply,
  workspaceProcessShouldRemainCached,
} from "@babel-apps/platform/pages/react";

test("page tabs and kept-alive panels expose the active session accessibly", () => {
  const markup = renderToStaticMarkup(
    createElement(
      PageSessionProvider,
      {
        initialPages: [
          { key: "note:1", kind: "Note", title: "First", href: "/notes?note=1" },
          {
            key: "note:2",
            kind: "Note",
            title: "Second",
            href: "/notes?note=2",
            dirty: true,
          },
        ],
        initialActiveKey: "note:2",
      },
      createElement(PageTabs),
      createElement(PageDeckPage, { pageKey: "note:1" }, "First content"),
      createElement(PageDeckPage, { pageKey: "note:2" }, "Second content"),
    ),
  );

  assert.match(markup, /role="tablist"/);
  assert.match(markup, /aria-selected="true"[^>]*>[\s\S]*Second/);
  assert.match(markup, /aria-label="Unsaved changes"/);
  assert.match(markup, /data-page-key="note:1"[^>]*hidden=""/);
  assert.match(markup, /data-page-key="note:2"[^>]*data-active=""/);
});

test("workspace processes match scoped pages and legacy page kinds", () => {
  const process = { scope: "knowledge", legacyPageKinds: ["Knowledge"] };
  const pages = [
    { key: "legacy", kind: "Knowledge", title: "Legacy", href: "/knowledge" },
    { key: "code", kind: "Code", scope: "code", title: "Code", href: "/code" },
    { key: "current", kind: "Knowledge", scope: "knowledge", title: "Current", href: "/knowledge" },
  ];

  assert.equal(workspaceProcessPageKey(pages, process, "legacy"), "legacy");
  assert.equal(workspaceProcessPageKey(pages, process, "missing"), "current");
  assert.equal(workspaceProcessPageKey(
    [{ key: "scratch:2", kind: "Scratch", title: "S2", href: "/exercise/2/scratch" }],
    {
      scope: "scratch:3",
      legacyPageKinds: ["Scratch"],
      legacyPageKeys: ["scratch:3"],
    },
    null,
  ), null);
});

test("workspace activation restores only when entering or leaving another scope", () => {
  const process = { scope: "notes", legacyPageKinds: ["Note"] };
  const pages = [
    { key: "note:1", kind: "Note", scope: "notes", title: "N1", href: "/notes?note=1" },
    { key: "canvas:2", kind: "Canvas", scope: "canvases", title: "C2", href: "/canvases?canvas=2" },
  ];

  assert.equal(
    workspaceProcessActivationKey(pages, process, null, "note:1", false),
    null,
  );
  assert.equal(
    workspaceProcessActivationKey(pages, process, null, undefined, true),
    "note:1",
  );
  assert.equal(
    workspaceProcessActivationKey(pages, process, "note:1", undefined, true),
    "note:1",
  );
  assert.equal(
    workspaceProcessActivationKey(pages, process, "canvas:2", "note:1", false),
    "note:1",
  );
  assert.equal(
    workspaceProcessActivationKey(pages, process, "canvas:2", null, true),
    null,
  );
});

test("dynamic processes remain cached only while registered or backed by an open page", () => {
  const process = {
    key: "scratch:2",
    scope: "scratch:2",
    legacyPageKinds: ["Scratch"],
    legacyPageKeys: ["scratch:2"],
  };

  assert.equal(workspaceProcessShouldRemainCached(
    process,
    new Set(["knowledge", "scratch:2"]),
    [],
  ), true);
  assert.equal(workspaceProcessShouldRemainCached(
    process,
    new Set(["knowledge"]),
    [{
      key: "scratch:2",
      kind: "Scratch",
      scope: "scratch:2",
      title: "Scratch 2",
      href: "/exercise/2/scratch",
    }],
  ), true);
  assert.equal(workspaceProcessShouldRemainCached(
    process,
    new Set(["knowledge"]),
    [],
  ), false);
});

test("bare routes preserve a process target only when reactivating it", () => {
  const tracker = createWorkspaceProcessRouteTargetTracker();

  assert.equal(workspaceProcessRouteTargetShouldApply(tracker, true, "folder=1"), true);
  assert.equal(workspaceProcessRouteTargetShouldApply(tracker, false, "folder=1"), false);
  assert.equal(workspaceProcessRouteTargetShouldApply(tracker, true, ""), false);
  assert.equal(workspaceProcessRouteTargetShouldApply(tracker, true, ""), false);
  assert.equal(workspaceProcessRouteTargetShouldApply(tracker, true, "folder=2"), true);
  assert.equal(workspaceProcessRouteTargetShouldApply(tracker, true, ""), true);
});

test("workspace host renders the active concrete process instead of route children", () => {
  const markup = renderToStaticMarkup(
    createElement(
      PageSessionProvider,
      null,
      createElement(
        WorkspaceProcessHost,
        {
          activeProcess: "knowledge",
          processes: [{
            key: "knowledge",
            scope: "knowledge",
            legacyPageKinds: ["Knowledge"],
            content: createElement("p", null, "Persistent knowledge workspace"),
          }],
        },
        createElement("p", null, "Route child"),
      ),
    ),
  );

  assert.match(markup, /data-process="knowledge"[^>]*data-active=""/);
  assert.match(markup, /Persistent knowledge workspace/);
  assert.doesNotMatch(markup, /Route child/);
});
