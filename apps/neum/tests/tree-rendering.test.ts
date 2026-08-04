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

test("folder leaves retain disclosure controls and selected ancestors reveal", () => {
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

  assert.match(markup, /aria-label="Collapse Root"/);
  assert.match(markup, /aria-label="Expand Leaf"/);
  assert.match(markup, /data-babel-folder-drag-handle=""/);
  assert.match(markup, /aria-keyshortcuts="ArrowUp ArrowDown"/);
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

  assert.match(markup, /aria-label="Collapse Parent page"/);
  assert.match(markup, /aria-label="Expand Leaf page"/);
  assert.match(markup, /\+ New subnote/);
});
