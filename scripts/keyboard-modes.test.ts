import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { build } from "esbuild";
import { getDefaultShortcutSettings } from "../packages/platform/src/shortcuts/core";

const root = path.resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);
const sdk = path.join(root, "launcher/.webview2/1.0.3537.50/lib_manual/netcoreapp3.0/Microsoft.Web.WebView2.Core.dll");

// Bundle the real providers, event routing and pane navigation. The fixture only
// supplies notebook command adapters; no user notebook or database is opened.
const fixture = String.raw`
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { ShortcutProvider, useShortcutBinding } from "./packages/platform/src/shortcuts/react";
const hits = window.fixtureHits = { new: 0, underline: 0, confirm: 0, popupRead: 0, popupEdit: 0, sourceRead: 0, sourceEdit: 0 };
const focusTrace = [];
document.addEventListener("focusin", event => {
  focusTrace.push({ target: event.target.id || event.target.tagName, mode: mode(document), time: Math.round(performance.now()) });
  if (focusTrace.length > 18) focusTrace.shift();
});
function focusDiagnostic() {
  return JSON.stringify({ active: document.activeElement?.outerHTML.slice(0, 240), mode: mode(document),
    dialog: document.querySelector("dialog[open]")?.className ?? null, hasFocus: document.hasFocus(),
    visibility: document.visibilityState, trace: focusTrace });
}
const delay = () => new Promise(resolve => setTimeout(resolve, 40));
function check(condition, message) { if (!condition) throw new Error(message); }
async function until(predicate, message) {
  const deadline = Date.now() + 4000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error(message + " " + focusDiagnostic()); await delay(); }
}
function key(doc, key, options = {}) {
  const event = new doc.defaultView.KeyboardEvent("keydown", {key, bubbles: true, cancelable: true, ...options});
  (doc.activeElement ?? doc.body).dispatchEvent(event);
  return event.defaultPrevented;
}
function mode(doc) { return doc.querySelector("[data-babel-keyboard-status]")?.dataset.babelMode; }
function pane(doc) { return doc.activeElement?.closest("[data-babel-pane]")?.dataset.babelPane; }
function Probe() {
  return <span id="bindings" hidden data-new={useShortcutBinding("new") ?? "disabled"}
    data-underline={useShortcutBinding("underlineSelection") ?? "disabled"}
    data-help={useShortcutBinding("help") ?? "disabled"} />;
}
function Popup({popup, fixedMode}) {
  return createPortal(<ShortcutProvider ownerDocument={popup.document} fixedMode={fixedMode}
    onEditSource={fixedMode === "read" ? () => { hits.sourceEdit++; return true; } : undefined}
    onReadSource={fixedMode === "edit" ? () => { hits.sourceRead++; return true; } : undefined}>
    <Probe />
    {fixedMode === "read" ? <div id="popup-content" className="markdown-body" tabIndex={0} data-babel-pane-default="">Reader text</div>
      : <textarea id="popup-content" data-babel-pane-default="" defaultValue="Draft text" />}
    <input id="popup-input" aria-label="Annotation text" />
    <button id="popup-action" data-babel-command={fixedMode === "read" ? "underlineSelection" : "confirm"}
      onClick={() => { if (fixedMode === "read") hits.popupRead++; else hits.popupEdit++; }}>Action</button>
  </ShortcutProvider>, popup.document.getElementById("popup-root"));
}
function Fixture() {
  const [editing, setEditing] = useState(false);
  const [popups, setPopups] = useState([]);
  useEffect(() => {
    document.getElementById("item").focus();
    window.openModeFixture = fixedMode => {
      const popup = window.open("", "_blank");
      if (!popup) throw new Error("Native fixture popup was blocked.");
      popup.document.write('<!doctype html><html><head><title>Isolated mode fixture</title></head><body><main id="popup-root" data-babel-pane="detail"></main></body></html>');
      popup.document.close();
      Object.defineProperty(popup, "__BABEL_DESKTOP__", { value: true });
      const entry = { popup, fixedMode };
      window.modeFixturePopups = [...(window.modeFixturePopups ?? []), entry];
      setPopups(previous => [...previous, entry]);
    };
  }, []);
  return <>
    <Probe />
    <nav data-babel-pane="tree"><button id="tree">Folder</button></nav>
    <section data-babel-pane="items"><button id="item">Document</button>
      <button data-babel-command="new" onClick={() => hits.new++}>New</button></section>
    <nav data-babel-pane="tabs"><button id="tab">Document tab</button></nav>
    <section data-babel-pane="detail">
      {editing ? <><textarea id="editor" data-babel-pane-default="" defaultValue="A draft" />
        <button data-babel-command="save" onClick={() => setEditing(false)}>Save</button>
        <button id="confirm" data-babel-command="confirm" onClick={() => hits.confirm++}>Confirm</button></>
        : <><div id="reader" className="markdown-body" tabIndex={0} data-babel-pane-default="">Read this text</div>
          <button id="edit" data-babel-command="edit" onClick={() => setEditing(true)}>Edit</button>
          <button data-babel-command="underlineSelection" onClick={() => hits.underline++}>Underline</button>
          <input id="annotation" aria-label="Annotation" />
          <div id="editable" contentEditable suppressContentEditableWarning>Editable comment</div></>}
    </section>
    {popups.map(entry => <Popup key={entry.fixedMode} {...entry} />)}
  </>;
}
createRoot(document.getElementById("root")).render(<ShortcutProvider><Fixture /></ShortcutProvider>);
window.runModeFixture = async () => {
  const passed = [];
  await until(() => document.querySelector("#bindings")?.dataset.new === "N", "Custom APP configuration did not load.");
  document.getElementById("item").focus();
  await until(() => mode(document) === "app", "APP mode was not recognized.");
  check(key(document, "n") && hits.new === 1, "APP N did not create one item.");
  key(document, "h", {ctrlKey: true, altKey: true});
  await until(() => document.querySelector("dialog[open]"), "APP keyboard help did not open.");
  await delay();
  check(mode(document) === "app" && document.querySelector("dialog[open]").dataset.babelMode === "app",
    "Opening Keys changed APP mode to the document's read/edit mode.");
  key(document, "Escape");
  await until(() => document.querySelector("dialog[open]") === null, "APP keyboard help did not dismiss.");
  document.getElementById("reader").focus();
  await until(() => mode(document) === "read", "Read mode was not inferred from detail content.");
  check(key(document, "n") && hits.underline === 1 && hits.new === 1, "Read N did not override APP N.");
  check(document.querySelector("[role=status]").textContent.includes("Read"), "Visible mode status is stale.");
  passed.push("APP/read mode inference, current-mode status and bare-key reuse");

  for (const id of ["annotation", "editable"]) {
    document.getElementById(id).focus();
    check(!key(document, "n") && hits.underline === 1, "Typing was stolen in " + id);
  }
  document.getElementById("reader").focus();
  check(!key(document, "n", {isComposing: true}), "IME composition was consumed.");
  check(!key(document, "n", {keyCode: 229}), "IME keyCode 229 was consumed.");
  check(hits.underline === 1, "IME input executed a shortcut.");
  passed.push("input, contenteditable and IME protection");

  const editModeButton = document.querySelector('[aria-label="Switch keyboard mode"] button:nth-child(2)');
  editModeButton.focus();
  editModeButton.click();
  await until(() => document.getElementById("editor"), "Mode bar did not activate the real Edit command.");
  await until(() => mode(document) === "edit", "In-place editing kept the mode-bar focus in Read before any manual refocus.");
  document.getElementById("editor").focus();
  await until(() => mode(document) === "edit", "Edit mode was not inferred from its save form.");
  check(!key(document, "n") && hits.confirm === 0, "Edit mode swallowed text input.");
  document.getElementById("confirm").focus();
  check(key(document, "n") && hits.confirm === 1 && hits.new === 1, "Edit N did not execute its own command.");
  key(document, "n", {ctrlKey: true, altKey: true});
  check(hits.new === 1, "An explicitly disabled New command used the inherited binding.");
  document.querySelector('[aria-label="Switch keyboard mode"] button').click();
  await until(() => document.activeElement?.id === "item" && mode(document) === "app", "Browse did not focus the document list.");
  passed.push("Edit/Browse switching and disabled inherited commands");

  document.getElementById("tree").focus();
  for (const expected of ["items", "tabs", "detail", "keyboard", "tree"]) {
    check(key(document, "F6", {ctrlKey: true}), "Focus Next Pane was not handled.");
    check(pane(document) === expected, "Forward pane cycle expected " + expected + ", got " + pane(document));
  }
  key(document, "F6", {ctrlKey: true, shiftKey: true});
  check(pane(document) === "keyboard", "Reverse pane cycle did not reach keyboard controls.");
  document.getElementById("tree").focus();
  await fetch("/arrow-config");
  window.dispatchEvent(new Event("babel:shortcuts-changed"));
  await until(() => document.querySelector("#bindings").dataset.new === "ArrowDown", "Bare arrow mode binding did not load.");
  let localArrowMoves = 0;
  const localArrowHandler = event => {
    if (event.key === "ArrowDown") { localArrowMoves++; event.preventDefault(); }
  };
  const tree = document.getElementById("tree");
  tree.addEventListener("keydown", localArrowHandler);
  const beforeArrow = hits.new;
  try {
    check(key(document, "ArrowDown") && hits.new === beforeArrow + 1,
      "Configured bare ArrowDown was swallowed by the tree's local navigation handler.");
    check(localArrowMoves === 0, "Configured bare ArrowDown also executed the tree navigation action.");
  } finally { tree.removeEventListener("keydown", localArrowHandler); }
  passed.push("forward and reverse pane focus cycles");
  return passed.join("\n");
};
window.runPopupModeFixture = async () => {
  const passed = [];
  for (const {popup, fixedMode} of window.modeFixturePopups) {
    const doc = popup.document;
    await until(() => doc.getElementById("bindings") && mode(doc) === fixedMode, "Fixed popup mode did not initialize: " + fixedMode);
    doc.getElementById("popup-action").focus();
    const previous = {...hits};
    check(key(doc, "n"), "Inherited popup mode binding was not handled: " + fixedMode);
    check((fixedMode === "read" ? hits.popupRead : hits.popupEdit) === 1, "Popup command targeted the wrong document.");
    check(hits.new === previous.new && hits.underline === previous.underline && hits.confirm === previous.confirm,
      "A popup key escaped to the opener's command adapter.");
    doc.getElementById("popup-input").focus();
    check(!key(doc, "n"), "Popup text input lost its bare key.");
    check(mode(doc) === fixedMode, "Popup input changed its fixed mode.");
    check(doc.querySelector("#bindings").dataset.help === "Ctrl+Alt+H", "Popup lost an inherited global binding.");
    key(doc, "h", {ctrlKey: true, altKey: true});
    await until(() => doc.querySelector("dialog[open]"), "Popup help did not open in its ownerDocument.");
    check(document.querySelector("dialog[open]") === null, "Popup help opened in the source document.");
    const modalHits = hits.popupRead + hits.popupEdit;
    const sourceHits = hits.sourceRead + hits.sourceEdit;
    key(doc, "n");
    check(hits.popupRead + hits.popupEdit === modalHits, "A modal dialog leaked a key to underlying popup commands.");
    key(doc, "e", {ctrlKey: true, altKey: true});
    key(doc, "r", {ctrlKey: true});
    check(hits.sourceRead + hits.sourceEdit === sourceHits, "A modal dialog allowed a source callback to switch modes.");
    key(doc, "Escape");
    await until(() => doc.querySelector("dialog[open]") === null, "Popup Escape did not dismiss local help.");
    key(doc, "k", {ctrlKey: true});
    await until(() => doc.querySelector(".babel-command-palette[open]"), "Popup command palette did not open.");
    const options = Array.from(doc.querySelectorAll(".babel-command-palette[open] button[role=option]"));
    const edits = options.find(option => option.querySelector("span")?.textContent === "Edit");
    const reads = options.find(option => option.querySelector("span")?.textContent === "Read");
    check(edits && reads && !edits.disabled && !reads.disabled, "Popup palette did not expose both source and current-mode commands.");
    (fixedMode === "read" ? edits : reads).click();
    check(hits.sourceRead + hits.sourceEdit === sourceHits + 1, "Popup palette failed to call the source mode action.");
    await until(() => doc.querySelector("dialog[open]") === null, "Popup palette stayed open after a source action.");
    doc.getElementById("popup-content").focus();
    key(doc, "F6", {ctrlKey: true});
    check(pane(doc) === "keyboard", "Nested popup controls were not reachable.");
    key(doc, "F6", {ctrlKey: true});
    check(doc.activeElement?.id === "popup-content", "Nested pane cycle did not return to its document content.");
    passed.push(fixedMode + " popup fixed mode, ownerDocument routing, inherited config and nested pane cycle");
  }
  await fetch("/next-config");
  window.dispatchEvent(new Event("babel:shortcuts-changed"));
  const reader = window.modeFixturePopups[0].popup.document;
  await until(() => reader.querySelector("#bindings").dataset.underline === "U", "Popup did not inherit a live configuration update.");
  reader.getElementById("popup-action").focus();
  const before = hits.popupRead;
  key(reader, "n");
  check(hits.popupRead === before, "Popup retained an obsolete shortcut.");
  key(reader, "u");
  check(hits.popupRead === before + 1, "Popup did not apply its updated inherited shortcut.");
  passed.push("live parent configuration propagates into existing popup scopes");
  return passed.join("\n");
};
`;

test("layered keyboard modes execute in real main and detached WebView2 documents", {
  skip: process.platform !== "win32" || !existsSync(sdk), timeout: 80_000,
}, async context => {
  const bundle = await build({
    stdin: { contents: fixture, loader: "tsx", resolveDir: root, sourcefile: "babel-keyboard-fixture.tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' },
  });
  const settings = getDefaultShortcutSettings();
  let updated = false;
  let arrowBinding = false;
  let settingsRequests = 0;
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.url === "/api/shortcuts") {
      settingsRequests++;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ...settings, layers: { ...settings.layers,
        app: { new: arrowBinding ? "ArrowDown" : "N" }, edit: { new: null, confirm: "N" }, read: { new: null, underlineSelection: updated ? "U" : "N" },
      } }));
    } else if (request.url === "/arrow-config") {
      arrowBinding = true;
      response.end("ok");
    } else if (request.url === "/next-config") {
      updated = true;
      response.end("ok");
    } else if (request.url === "/fixture.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(bundle.outputFiles[0].text);
    } else if (request.url === "/blank") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<!doctype html><html><head><title>Isolated APP B</title></head><body>Second APP fixture</body></html>');
    } else {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<!doctype html><html><head><title>Isolated keyboard fixture</title></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const { stdout, stderr } = await execFileAsync("pwsh.exe", [
      "-NoLogo", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "launcher/Test-BabelKeyboardModes.ps1"), "-FixtureOrigin", `http://127.0.0.1:${address.port}`,
    ], { timeout: 65_000 });
    assert.equal(stderr, "");
    assert.equal((stdout.match(/^PASS /gm) ?? []).length, 8, stdout);
    assert.equal(settingsRequests, 3, "Popups must inherit their parent's configuration without independent fetches.");
    context.diagnostic(stdout.split(/\r?\n/).find(line => line.includes("native APP source restoration")) ?? "");
    context.diagnostic("Verified actual React providers and WebView2 DOM key events; physical keyboard delivery is outside this fixture.");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
