import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FolderPicker } from "@babel-apps/platform/folders/picker";
import {
  buildPickerFolderTree,
  pickerAncestorIds,
  visiblePickerFolders,
} from "../src/folders/picker-core";

const folders = [
  { id: 3, parentId: 1, name: "Paradigm", position: 0 },
  { id: 2, parentId: null, name: "AI", position: 0 },
  { id: 5, parentId: 3, name: "Digest", position: 0 },
  { id: 1, parentId: null, name: "Language", position: 1 },
  { id: 6, parentId: 2, name: "Digest", position: 0 },
  { id: 4, parentId: 1, name: "C", position: 1 },
];

test("folder browsing groups children under parents and keeps supplied sibling ordering", () => {
  const tree = buildPickerFolderTree(folders);
  assert.deepEqual(tree.nodes.map((node) => node.folder.id), [2, 6, 1, 3, 5, 4]);
  assert.deepEqual(tree.nodes.map((node) => node.depth), [0, 1, 0, 1, 2, 1]);
  assert.equal(tree.byId.get(5)?.path, "Language / Paradigm / Digest");
  assert.equal(tree.byId.get(4)?.siblingIndex, 1);
  assert.equal(tree.byId.get(4)?.siblingCount, 2);
  const reordered = buildPickerFolderTree([folders[3], folders[0], folders[5], folders[1], folders[2], folders[4]]);
  assert.deepEqual(reordered.roots.map((node) => node.folder.id), [1, 2]);
  assert.deepEqual(reordered.byId.get(1)?.children.map((node) => node.folder.id), [3, 4]);
});

test("selected ancestors reveal the selection without expanding unrelated branches", () => {
  const tree = buildPickerFolderTree(folders);
  const expanded = pickerAncestorIds(tree, 5);
  assert.deepEqual([...expanded], [3, 1]);
  assert.deepEqual(visiblePickerFolders(tree, expanded, "").map((node) => node.folder.id), [2, 1, 3, 5, 4]);
  expanded.delete(3);
  assert.deepEqual(visiblePickerFolders(tree, expanded, "").map((node) => node.folder.id), [2, 1, 3, 4]);
  assert.deepEqual([...pickerAncestorIds(tree, null)], []);
});

test("search matches all case-insensitive path tokens across collapsed branches and disambiguates names", () => {
  const tree = buildPickerFolderTree(folders);
  const digests = visiblePickerFolders(tree, new Set(), "DIGEST");
  assert.deepEqual(digests.map((node) => node.parentPath), ["AI", "Language / Paradigm"]);
  assert.deepEqual(visiblePickerFolders(tree, new Set(), " digest  LANGUAGE ").map((node) => node.folder.id), [5]);
  assert.deepEqual(visiblePickerFolders(tree, new Set(), "Language / Paradigm").map((node) => node.folder.id), [3, 5]);
  assert.deepEqual(visiblePickerFolders(tree, new Set(), "unknown"), []);
  assert.deepEqual(visiblePickerFolders(tree, new Set(), "   ").map((node) => node.folder.id), [2, 1]);
});

test("empty, missing-parent and cyclic input stays finite and reachable", () => {
  assert.deepEqual(buildPickerFolderTree([]).nodes, []);
  const tree = buildPickerFolderTree([
    { id: 1, parentId: 99, name: "Orphan" },
    { id: 2, parentId: 3, name: "Cycle A" },
    { id: 3, parentId: 2, name: "Cycle B" },
    { id: 4, parentId: 4, name: "Self" },
  ]);
  assert.equal(tree.nodes.length, 4);
  assert.equal(tree.byId.get(1)?.path, "Orphan");
  assert.equal(tree.byId.get(4)?.path, "Self");
  assert.deepEqual([...pickerAncestorIds(tree, 3)], [2]);
});

test("picker exposes current path, native form value, required and disabled semantics", () => {
  const markup = renderToStaticMarkup(createElement(FolderPicker, {
    folders,
    value: 5,
    onChange() {},
    name: "folderId",
    required: true,
  }));
  assert.match(markup, /aria-label="Folder: Language \/ Paradigm \/ Digest"/);
  assert.match(markup, /aria-haspopup="dialog" aria-expanded="false"/);
  assert.match(markup, /<select[^>]*name="folderId"[^>]*required=""/);
  assert.match(markup, /<option value="5" selected="">Language \/ Paradigm \/ Digest<\/option>/);
  assert.doesNotMatch(markup, /<form|<label/);
  const disabledMarkup = renderToStaticMarkup(createElement(FolderPicker, {
    folders, value: null, onChange() {}, name: "parentId", allowRoot: true, rootLabel: "Root folders", disabled: true,
  }));
  assert.match(disabledMarkup, /<button[^>]*disabled=""/);
  assert.match(disabledMarkup, /<select[^>]*disabled=""/);
  assert.match(disabledMarkup, /<option value="" selected="">Root folders<\/option>/);
});

test("excluding destinations preserves full paths and unaffected descendants in form options", () => {
  const markup = renderToStaticMarkup(createElement(FolderPicker, {
    folders, value: 5, onChange() {}, name: "destination", excludedIds: new Set([1, 3]),
  }));
  assert.match(markup, /<option value="1" disabled="">Language<\/option>/);
  assert.match(markup, /<option value="3" disabled="">Language \/ Paradigm<\/option>/);
  assert.match(markup, /<option value="5" selected="">Language \/ Paradigm \/ Digest<\/option>/);
});
