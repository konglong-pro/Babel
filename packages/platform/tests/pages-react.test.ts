import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  createWorkspaceProcessRouteTargetTracker,
  PageDeckPage,
  PageSessionProvider,
  PageTabs,
  pageTabRovingKey,
  usePageDeckPageContext,
  WorkspaceProcessHost,
  workspaceProcessActivationKey,
  workspaceProcessPageKey,
  workspaceProcessRouteTargetShouldApply,
  workspaceProcessShouldRemainCached,
} from "@babel-apps/platform/pages/react";

function PageContextProbe() {
  const page = usePageDeckPageContext();
  return createElement("span", {
    "data-context-active": String(page.active),
    "data-context-page": page.pageKey,
  });
}

test("page tabs reserve viewport height through mounted process wrappers", () => {
  const styles = readFileSync(new URL("../src/pages/pages.css", import.meta.url), "utf8");

  assert.match(
    styles,
    /\.babel-page-tabs \+ main > \.babel-workspace-process > :is\([\s\S]*?\.entries-workspace[\s\S]*?\) \{[\s\S]*?100dvh - var\(--header-height, 52px\) - var\(--babel-page-tabs-height, 48px\)/,
  );
});

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
      createElement(PageDeckPage, { pageKey: "note:1" }, createElement(PageContextProbe)),
      createElement(PageDeckPage, { pageKey: "note:2" }, createElement(PageContextProbe)),
    ),
  );

  assert.match(markup, /role="tablist"/);
  assert.match(markup, /data-babel-pane="tabs"/);
  assert.match(markup, /role="tab"[^>]*aria-controls="babel-page-panel-note%3A2"/);
  assert.match(markup, /aria-keyshortcuts="ArrowLeft ArrowRight Home End Enter Space"/);
  assert.match(markup, /role="tab"[^>]*aria-selected="true"[^>]*tabindex="0"[^>]*>[\s\S]*Second/);
  assert.match(markup, /aria-selected="true"[^>]*>[\s\S]*Second/);
  assert.match(markup, /aria-label="Unsaved changes"/);
  assert.match(markup, /data-page-key="note:1"[^>]*hidden=""/);
  assert.match(markup, /data-page-key="note:2"[^>]*data-active=""/);
  assert.match(markup, /role="tabpanel"[^>]*aria-labelledby="babel-page-tab-note%3A2"/);
  assert.match(markup, /data-context-active="false" data-context-page="note:1"/);
  assert.match(markup, /data-context-active="true" data-context-page="note:2"/);
  assert.match(markup, /data-babel-command="nextTab"/);
  assert.match(markup, /data-babel-command="previousTab"/);
  assert.match(markup, /data-babel-command="closeTab"/);
  assert.match(markup, /class="babel-page-tab__close"[^>]*aria-hidden="true"/);
  assert.doesNotMatch(markup, /<button[^>]*class="babel-page-tab__close"/);
});

test("page tab roving focus follows external activation outside the tablist", () => {
  const pages = [{ key: "note:1" }, { key: "note:2" }];

  assert.equal(pageTabRovingKey(pages, "note:2", "note:1", false), "note:2");
  assert.equal(pageTabRovingKey(pages, "note:2", "note:1", true), "note:1");
  assert.equal(pageTabRovingKey(pages, "note:2", "missing", true), "note:2");
});

test("page commands and async page content preserve a concrete detail focus target", () => {
  const source = readFileSync(new URL("../src/pages/react.tsx", import.meta.url), "utf8");

  assert.match(source, /schedulePagePanelFocus\(page\.key\)/);
  assert.match(source, /closePage\(key\);\s*schedulePagePanelFocus\(\);/);
  assert.match(source, /setPendingClose\(null\);\s*schedulePagePanelFocus\(\);/);
  assert.match(source, /const ownedFocusRef = useRef\(false\)/);
  assert.match(source, /page\.querySelector<HTMLElement>\("\[data-babel-pane='detail'\]"\)\?\.focus/);
});

test("dirty page close confirmation uses the native modal cancel contract", () => {
  const source = readFileSync(new URL("../src/pages/react.tsx", import.meta.url), "utf8");

  assert.match(source, /closeDialogRef\.current/);
  assert.match(source, /dialog\.showModal\(\)/);
  assert.match(source, /<dialog[\s\S]*?className="babel-page-close-dialog"/);
  assert.match(source, /data-babel-command="cancel"/);
  assert.match(source, /onCancel=\{\(event\) => \{/);
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
