import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const registry = JSON.parse(await readFile(path.join(root, "babel.apps.json"), "utf8")) as {
  apps: Array<{ workspace: string }>;
};
const workspaces = [...registry.apps.map(({ workspace }) => workspace), "templates/mirror-app"];

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map(async (entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filename);
    return /\.[cm]?[jt]sx?$/u.test(entry.name) && !/\.(?:test|d)\.ts$/u.test(entry.name) ? [filename] : [];
  }));
  return groups.flat();
}

const files = (await Promise.all([
  ...workspaces.map((workspace) => sourceFiles(path.join(root, workspace, "src"))),
  ...["markdown", "platform", "pdf", "typst", "katex"].map((name) => sourceFiles(path.join(root, "packages", name, "src"))),
])).flat();
const sources = await Promise.all(files.map(async (filename) => ts.createSourceFile(
  filename, await readFile(filename, "utf8"), ts.ScriptTarget.Latest, true,
)));

function location(source: ts.SourceFile, node: ts.Node): string {
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${path.relative(root, source.fileName)}:${line + 1}`;
}

function isSearchKeyword(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isPropertyAssignment(parent) && parent.name.getText() === "keywords") return true;
  }
  return false;
}

test("authored UI copy and built-in note starters stay English across every APP and shared component", () => {
  const violations: string[] = [];
  for (const source of sources) {
    const visit = (node: ts.Node) => {
      // Search aliases and document-recognition regexes support user content;
      // filenames, note bodies, and other runtime values are never translated.
      if ((ts.isStringLiteral(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) && !isSearchKeyword(node)) {
        const text = node.text.replace(/&#(?:x([\da-f]+)|(\d+));/giu, (entity, hex: string | undefined, decimal: string | undefined) => {
          const code = Number.parseInt(hex ?? decimal ?? "", hex ? 16 : 10);
          return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
        });
        if (/\p{Script=Han}/u.test(text)) violations.push(location(source, node));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(violations, [], "Translate authored UI copy, not user content or search aliases.");
});

test("native file inputs stay hidden behind English controls instead of exposing browser-localized labels", () => {
  const violations: string[] = [];
  for (const source of sources) {
    const visit = (node: ts.Node) => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText() === "input") {
        const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
        const attribute = (name: string) => attributes.find((entry) => entry.name.getText() === name);
        const type = attribute("type")?.initializer;
        if (type && ts.isStringLiteral(type) && type.text === "file") {
          const hidden = attribute("hidden");
          if (!hidden || hidden.initializer) violations.push(location(source, node));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(violations, []);
});

test("UI date, weekday and number formatting explicitly uses English instead of the system locale", async () => {
  const violations: string[] = [];
  const formatters = new Set(["DateTimeFormat", "NumberFormat", "RelativeTimeFormat", "ListFormat", "DisplayNames"]);
  const localeMethods = new Set(["toLocaleDateString", "toLocaleTimeString", "toLocaleString"]);
  for (const source of sources) {
    const visit = (node: ts.Node) => {
      const formatter = ts.isNewExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.expression.getText() === "Intl" && formatters.has(node.expression.name.text);
      const method = ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && localeMethods.has(node.expression.name.text);
      if (formatter || method) {
        const locale = (node as ts.NewExpression | ts.CallExpression).arguments?.[0];
        if (!locale || !ts.isStringLiteral(locale) || !/^en(?:-|$)/u.test(locale.text)) violations.push(location(source, node));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (const workspace of workspaces) {
    const layout = await readFile(path.join(root, workspace, "src/app/layout.tsx"), "utf8");
    assert.match(layout, /<html\s+lang="en(?:-[A-Za-z]+)?"/u, workspace);
  }
  assert.deepEqual(violations, []);
});
