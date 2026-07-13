import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EntryList } from "@/components/entry-list";
import { FolderPanel } from "@/components/folder-panel";
import type { EntrySummaryDto, FolderDto } from "@/lib/types";

const timestamp = "2026-07-13T00:00:00.000Z";
const folders: FolderDto[] = [
  { id: 1, parentId: null, name: "Root", createdAt: timestamp, updatedAt: timestamp },
  { id: 2, parentId: 1, name: "Leaf", createdAt: timestamp, updatedAt: timestamp },
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
    kind: "snippet",
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
      trashActive: false,
      onSelect() {},
      onOpenTrash() {},
      async onCreate() {},
      async onRename() {},
      async onMove() {},
      async onDelete() {},
    }),
  );

  assert.match(markup, /aria-label="Collapse Root"/);
  assert.match(markup, /aria-label="Expand Leaf"/);
  assert.match(markup, /\+ New subfolder/);
});

test("entry leaves retain disclosure controls and selected ancestors reveal", () => {
  const markup = renderToStaticMarkup(
    createElement(EntryList, {
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
