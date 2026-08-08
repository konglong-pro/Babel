import assert from "node:assert/strict";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EntryList } from "@/components/entry-list";
import { FolderPanel } from "@/components/folder-panel";
import type { EntrySummaryDto, FolderDto } from "@/lib/types";

const testGlobal = globalThis as typeof globalThis & { React: typeof React };
testGlobal.React = React;
const { createElement } = React;

const timestamp = "2026-07-13T00:00:00.000Z";
const folders: FolderDto[] = [
  { id: 1, parentId: null, name: "Root", position: 0, createdAt: timestamp, updatedAt: timestamp },
  { id: 2, parentId: 1, name: "Leaf", position: 0, createdAt: timestamp, updatedAt: timestamp },
];
const entries: EntrySummaryDto[] = [
  {
    id: 10,
    parentId: null,
    folderId: 2,
    kind: "knowledge",
    title: "Parent page",
    tags: [],
    version: 1,
    updatedAt: timestamp,
  },
  {
    id: 11,
    parentId: 10,
    folderId: 2,
    kind: "knowledge",
    title: "Leaf page",
    tags: [],
    version: 1,
    updatedAt: timestamp,
  },
];

test("folder tree exposes hierarchy on treeitems without leaf disclosure controls", () => {
  const markup = renderToStaticMarkup(
    createElement(FolderPanel, {
      folders,
      selectedId: 2,
      activeReferencePanel: null,
      onOpenMarkdownReference() {},
      onOpenTypstReference() {},
      onRetry() {},
      onSelect() {},
      async onCreate() {},
      async onRename() {},
      async onMove() {},
      async onReorder() {},
      async onDelete() {},
    }),
  );

  assert.match(markup, /data-babel-folder-disclosure=""[^>]*aria-expanded="true"[^>]*title="Collapse Root"/);
  assert.match(markup, /class="folder-disclosure-spacer"/);
  const rootTreeItem = markup.match(/<button[^>]*data-babel-navigation-id="1"[^>]*>/)?.[0];
  const leafTreeItem = markup.match(/<button[^>]*data-babel-navigation-id="2"[^>]*>/)?.[0];
  assert.ok(rootTreeItem);
  assert.ok(leafTreeItem);
  assert.match(rootTreeItem, /aria-expanded="true"/);
  assert.match(rootTreeItem, /aria-level="1"/);
  assert.match(leafTreeItem, /aria-level="2"/);
  assert.doesNotMatch(leafTreeItem, /aria-expanded=/);
  assert.doesNotMatch(markup, /aria-label="Expand Leaf"/);
  assert.match(markup, /data-babel-folder-drag-source=""/);
  assert.match(
    markup,
    /aria-keyshortcuts="Control\+Alt\+ArrowUp Control\+Alt\+ArrowDown"/,
  );
  assert.match(markup, /\+ New subfolder/);
});

test("folder load failures are recoverable and never look like an empty library", () => {
  const markup = renderToStaticMarkup(
    createElement(FolderPanel, {
      folders: [],
      selectedId: 2,
      loadError: "The server failed to process the request.",
      activeReferencePanel: null,
      onOpenMarkdownReference() {},
      onOpenTypstReference() {},
      onRetry() {},
      onSelect() {},
      async onCreate() {},
      async onRename() {},
      async onMove() {},
      async onReorder() {},
      async onDelete() {},
    }),
  );

  assert.match(markup, /Folders could not be loaded/);
  assert.match(markup, />Retry</);
  assert.doesNotMatch(markup, /No folders yet/);
  assert.match(markup, /aria-label="Create folder"[^>]*disabled/);
  const tree = markup.match(/<nav[^>]*role="tree"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(tree);
  assert.doesNotMatch(tree, /Folders could not be loaded|>Retry</);
});

test("entry leaves retain disclosure controls and selected ancestors reveal", () => {
  const markup = renderToStaticMarkup(
    createElement(EntryList, {
      kind: "knowledge",
      entries,
      total: entries.length,
      folders: new Map(folders.map((folder) => [folder.id, folder])),
      selectedFolderId: 2,
      selectedEntryId: 11,
      onSelect() {},
      async onLoadMore() {},
      onCreate() {},
      onCreateChild() {},
      onBack() {},
    }),
  );

  assert.match(markup, /data-babel-tree-disclosure=""[^>]*title="Collapse Parent page"/);
  assert.match(markup, /data-babel-item-drag-source=""/);
  assert.match(markup, /data-babel-tree-disclosure-spacer=""/);
  assert.doesNotMatch(markup, /title="Expand Leaf page"/);
  assert.match(markup, /data-babel-tree-inline-create=""/);
  assert.match(markup, /data-babel-child-create=""/);
  assert.doesNotMatch(markup, /role="group"/);
  const parentTreeItem = markup.match(/<button[^>]*data-babel-navigation-id="10"[^>]*>/)?.[0];
  const leafTreeItem = markup.match(/<button[^>]*data-babel-navigation-id="11"[^>]*>/)?.[0];
  assert.ok(parentTreeItem);
  assert.ok(leafTreeItem);
  assert.match(parentTreeItem, /aria-expanded="true"/);
  assert.doesNotMatch(leafTreeItem, /aria-expanded=/);
  assert.match(markup, /\+ New subnote/);
});
