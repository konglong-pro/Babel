import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  cyclicNavigationIndex,
  enabledNavigationItems,
  findTypeaheadItem,
  navigationMovementIndex,
  treeItemLevel,
  type NavigationItem,
} from "@babel-apps/platform/navigation/core";
import {
  PaneFocusProvider,
  useListKeyboardNavigation,
  useTreeKeyboardNavigation,
} from "@babel-apps/platform/navigation/react";

test("linear and cyclic navigation respect boundaries", () => {
  assert.equal(navigationMovementIndex(4, 1, "next"), 2);
  assert.equal(navigationMovementIndex(4, 0, "previous"), 0);
  assert.equal(navigationMovementIndex(20, 13, "page-previous", 10), 3);
  assert.equal(navigationMovementIndex(20, 13, "page-next", 10), 19);
  assert.equal(cyclicNavigationIndex(4, 3, 1), 0);
  assert.equal(cyclicNavigationIndex(4, 0, -1), 3);
  assert.equal(cyclicNavigationIndex(0, 0, 1), null);
});

test("typeahead wraps and skips unavailable items", () => {
  const items: readonly NavigationItem<number>[] = enabledNavigationItems([
    { id: 1, label: "Alpha" },
    { id: 2, label: "Alpine", disabled: true },
    { id: 3, label: "Beta", visible: false },
    { id: 4, label: "Atlas" },
  ]);

  assert.equal(findTypeaheadItem<number, NavigationItem<number>>(items, 1, "a")?.id, 4);
  assert.equal(findTypeaheadItem<number, NavigationItem<number>>(items, 4, "al")?.id, 1);
  assert.equal(findTypeaheadItem<number, NavigationItem<number>>(items, 1, "z"), null);
});

test("tree levels derive safely from parent relationships", () => {
  const items = [
    { id: "root", label: "Root", parentId: null },
    { id: "child", label: "Child", parentId: "root" },
    { id: "leaf", label: "Leaf", parentId: "child" },
  ];
  assert.equal(treeItemLevel(items, "root"), 1);
  assert.equal(treeItemLevel(items, "leaf"), 3);
});

function NavigationFixture() {
  const tree = useTreeKeyboardNavigation({
    items: [
      { id: 1, label: "Folder", parentId: null, hasChildren: true, expanded: true },
      { id: 2, label: "Child", parentId: 1 },
    ],
    selectedId: 2,
    onActivate: () => undefined,
    onExpandedChange: () => undefined,
    label: "Folders",
  });
  const list = useListKeyboardNavigation({
    items: [{ id: "result", label: "Search result" }],
    selectedId: "result",
    onActivate: () => undefined,
    label: "Results",
  });

  return createElement(
    PaneFocusProvider,
    null,
    createElement(
      "div",
      tree.treeProps,
      createElement("button", tree.getTreeItemProps(1), "Folder"),
      createElement("button", tree.getTreeItemProps(2), "Child"),
    ),
    createElement(
      "div",
      list.listboxProps,
      createElement("button", list.getOptionProps("result"), "Search result"),
    ),
  );
}

test("navigation hooks render roving and ARIA semantics with command adapters", () => {
  const markup = renderToStaticMarkup(createElement(NavigationFixture));

  assert.match(markup, /role="tree" aria-label="Folders"/);
  assert.match(markup, /role="treeitem" tabindex="-1"[^>]*aria-expanded="true"[^>]*aria-level="1"/);
  assert.match(markup, /role="treeitem" tabindex="0"[^>]*aria-selected="true"[^>]*aria-level="2"/);
  assert.match(markup, /role="listbox" aria-label="Results"/);
  assert.match(markup, /role="option" tabindex="0" aria-selected="true"/);
  assert.match(markup, /data-babel-command="focusNextPane"/);
  assert.match(markup, /data-babel-command="focusPreviousPane"/);
});
