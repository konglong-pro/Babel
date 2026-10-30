import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");

test("every notebook and scaffold use the unclipped import menu without losing action adapters", async () => {
  const registry = JSON.parse(await readFile(path.join(root, "babel.apps.json"), "utf8")) as {
    apps: Array<{ id: string; workspace: string }>;
  };
  for (const target of [...registry.apps, { id: "template", workspace: "templates/mirror-app" }]) {
    const listName = ["retex", "matter"].includes(target.id) ? "item-list" : target.id === "neum" ? "entry-list" : "note-list";
    const [source, layout] = await Promise.all([
      readFile(path.join(root, target.workspace, "src/components", `${listName}.tsx`), "utf8"),
      readFile(path.join(root, target.workspace, "src/app/layout.tsx"), "utf8"),
    ]);
    const ast = ts.createSourceFile("list.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const menus: ts.JsxElement[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "ImportMenu") menus.push(node);
      ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.equal(menus.length, 1, `${target.id}: one shared native popover`);
    const menu = menus[0].getText(ast);
    assert.match(menu, /ref=\{importMenuRef\}/u, target.id);
    assert.match(menu, /disabled=\{selectedFolderId === null \|\| referencePanelOpen\}/u, target.id);
    for (const action of ["ClipboardMarkdownImportAction", "WebArchiveImportAction", "DocumentImportAction"]) {
      assert.match(menu, new RegExp(`<${action}\\s[\\s\\S]*?onOpen=\\{\\(\\) => \\{\\s+if \\(importMenuRef.current\\) importMenuRef.current.open = false;`, "u"),
        `${target.id}: ${action} closes the retained details handle`);
    }
    assert.match(menu, /importMenuRef.current.open = false;\s+importInputRef.current\?\.click\(\)/u, target.id);
    assert.match(menu, /importMenuRef.current.open = false;\s+folderImportInputRef.current\?\.click\(\)/u, target.id);
    assert.doesNotMatch(source, /<details[^>]*className="babel-import-menu"/u, target.id);
    assert.match(layout, /import "@babel-apps\/platform\/imports.css"/u, target.id);
    assert.match(source, /<NewContentMenu/u, `${target.id}: use the same fixed New menu`);
  }
});
