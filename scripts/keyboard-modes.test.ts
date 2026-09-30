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
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { EditorExitActions, submittedForReading, ShortcutProvider, useShortcutBinding } from "./packages/platform/src/shortcuts/react";
import { PageSessionProvider, PageTabs, PageDeckPage, usePageSessions } from "./packages/platform/src/pages/react";
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
function pending(doc) {
  return Array.from(doc.querySelectorAll("[data-babel-shortcut-sequence]"))
    .find(element => element.getClientRects().length > 0)?.textContent.trim() ?? "";
}
function Probe() {
  return <span id="bindings" hidden data-new={useShortcutBinding("new") ?? "disabled"}
    data-underline={useShortcutBinding("underlineSelection") ?? "disabled"}
    data-help={useShortcutBinding("help") ?? "disabled"}
    data-confirm={useShortcutBinding("confirm") ?? "disabled"} />;
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
  const [common, setCommon] = useState(false);
  useEffect(() => { window.showCommonFixture = setCommon; }, []);
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
    <div hidden={common}>
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
    </div>
    {common ? <CommonFixture /> : null}
    {popups.map(entry => <Popup key={entry.fixedMode} {...entry} />)}
  </>;
}

function CommonEditor() {
  const [editing, setEditing] = useState(true);
  const [content, setContent] = useState("Saved text");
  const [saved, setSaved] = useState("Saved text");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef(null);
  useEffect(() => { window.editFixture = { dirty: value => setContent(value), edit: () => setEditing(true) }; });
  async function submit(event) {
    event.preventDefault();
    const readAfter = submittedForReading(event);
    if (pending) return;
    setPending(true);
    setError("");
    const succeed = await new Promise(resolve => { window.finishFixtureSave = resolve; });
    if (succeed) { setSaved(content); if (readAfter) setEditing(false); }
    else setError("Save failed");
    setPending(false);
  }
  return <section data-babel-pane="detail" tabIndex={-1}>
    {editing ? <form ref={formRef} onSubmit={submit}>
      <EditorExitActions dirty={content !== saved} pending={pending} formRef={formRef}
        onDiscard={() => { setContent(saved); setEditing(false); }} />
      <textarea id="exit-editor" value={content} onChange={event => setContent(event.target.value)} />
      <button data-babel-command="save" disabled={pending}>Save</button>
      <span id="exit-state" data-pending={pending}>{error}</span>
    </form> : <><div id="exit-reader" className="markdown-body" tabIndex={0}>{saved}</div>
      <button id="exit-edit" data-babel-command="edit" onClick={() => setEditing(true)}>Edit</button></>}
  </section>;
}
const fixturePages = Array.from({length: 10}, (_, index) => ({ key: "note:" + (index + 1), title: "Note " + (index + 1), kind: "Note", href: "/?note=" + (index + 1) }));
function CommonPages() {
  const sessions = usePageSessions();
  useEffect(() => { window.fixturePages = sessions; });
  return <><PageTabs /><output id="page-state" data-active={sessions.activeKey ?? ""} data-count={sessions.pages.length} />
    {sessions.pages.map(page => <PageDeckPage key={page.key} pageKey={page.key}>
      <article data-babel-pane="detail" tabIndex={-1}><div className="markdown-body">{page.title}</div></article>
    </PageDeckPage>)}</>;
}
function CommonFixture() {
  const [pages, setPages] = useState(false);
  useEffect(() => { window.showPagesFixture = () => setPages(true); }, []);
  return <><nav data-babel-pane="tree"><button id="common-tree">Folder</button></nav>
    <section data-babel-pane="items"><button id="common-item">Document</button></section>
    {pages ? <PageSessionProvider initialPages={fixturePages} initialActiveKey="note:1"><CommonPages /></PageSessionProvider> : <CommonEditor />}
    <dialog id="common-confirm"><button data-babel-command="confirm" onClick={() => { hits.confirm++; document.getElementById("common-confirm").close(); }}>Confirm modal</button></dialog>
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
window.runSequenceFixture = async () => {
  const passed = [];
  document.querySelector('[data-babel-command="save"]').click();
  document.getElementById("item").focus();
  await fetch("/sequence-config");
  window.dispatchEvent(new Event("babel:shortcuts-changed"));
  await until(() => document.querySelector("#bindings").dataset.new === "G N", "APP sequence configuration did not load.");
  await until(() => mode(document) === "app", "Sequence fixture did not return to APP mode.");
  const beforeNew = hits.new;
  check(key(document, "g") && hits.new === beforeNew, "Sequence prefix executed its command.");
  await until(() => pending(document).includes("G"), "Pending sequence was not visible.");
  key(document, "n", {repeat: true});
  check(hits.new === beforeNew, "A repeated tail advanced the sequence.");
  check(key(document, "n") && hits.new === beforeNew + 1, "Sequence completion did not execute once.");
  key(document, "n", {repeat: true});
  check(hits.new === beforeNew + 1, "Key repeat executed a completed sequence twice.");
  await until(() => pending(document) === "", "Completed sequence left a stale hint.");
  key(document, "g", {repeat: true});
  check(!key(document, "n") && hits.new === beforeNew + 1, "Autorepeat started a new sequence.");
  check(key(document, "g"), "Shared sequence prefix was not recognized.");
  check(key(document, "h"), "A different tail sharing the prefix was not recognized.");
  await until(() => document.querySelector("dialog[open]"), "Shared-prefix help sequence did not open help.");
  check(hits.new === beforeNew + 1, "Shared-prefix help also executed New.");
  key(document, "Escape");
  await until(() => document.querySelector("dialog[open]") === null, "Sequence help did not close.");
  document.getElementById("item").focus();
  passed.push("sequence prefixes, shared tails, visible pending state and exactly-once completion");

  check(key(document, "q", {ctrlKey: true, altKey: true}), "Four-step prefix was not recognized.");
  check(!key(document, "Control") && !key(document, "Alt"), "Modifier changes were consumed as strokes.");
  check(key(document, "x") && key(document, "y"), "Middle sequence strokes did not advance.");
  check(document.querySelector("dialog[open]") === null, "Four-step command ran before its final stroke.");
  await until(() => pending(document).includes("Ctrl+Alt+Q X Y"), "Middle strokes were not shown in the hint.");
  check(key(document, "z"), "Fourth stroke did not complete Quick Open.");
  await until(() => document.querySelector('dialog[open] input'), "Four-step Quick Open did not open.");
  key(document, "Escape");
  await until(() => document.querySelector("dialog[open]") === null, "Four-step Quick Open did not close.");
  document.getElementById("item").focus();

  for (const cancelKey of ["x", "Escape"]) {
    check(key(document, "g"), "Cancellation prefix was not handled.");
    check(key(document, cancelKey), "Pending sequence did not consume " + cancelKey);
    check(!key(document, "n") && hits.new === beforeNew + 1, "Cancelled sequence retained its tail after " + cancelKey);
    await until(() => pending(document) === "", "Cancelled sequence left a stale hint.");
  }
  check(key(document, "g"), "Timeout prefix was not handled.");
  await until(() => pending(document).includes("G"), "Timeout sequence did not show its prefix.");
  await new Promise(resolve => setTimeout(resolve, 1700));
  check(pending(document) === "", "Sequence timeout did not clear the visible pending state.");
  check(!key(document, "n") && hits.new === beforeNew + 1, "Expired sequence still executed.");
  passed.push("sequence mismatch, Escape and interstroke timeout cancellation");

  check(key(document, "g"), "Focus-reset prefix was not handled.");
  document.getElementById("tree").focus();
  await delay();
  check(!key(document, "n") && hits.new === beforeNew + 1, "Moving focus kept the pending sequence.");
  check(key(document, "g"), "Mode-reset prefix was not handled.");
  document.getElementById("reader").focus();
  await until(() => mode(document) === "read", "Mode reset did not enter Read.");
  const beforeUnderline = hits.underline;
  check(!key(document, "u") && hits.underline === beforeUnderline, "A prefix crossed from APP into Read mode.");
  check(key(document, "g"), "Dialog-reset prefix was not handled.");
  document.querySelector('[data-babel-keyboard-status] > button:last-child').click();
  await until(() => document.querySelector("dialog[open]"), "Dialog reset did not open help.");
  await until(() => pending(document) === "", "Opening a dialog did not cancel its pending sequence.");
  key(document, "u");
  check(hits.underline === beforeUnderline, "Pending sequence leaked into a modal dialog.");
  key(document, "Escape");
  await until(() => document.querySelector("dialog[open]") === null, "Dialog-reset help did not close.");
  document.getElementById("reader").focus();
  check(key(document, "g"), "Blur-reset prefix was not handled.");
  // Exercise the browser-window blur handler independently of OS foreground
  // ownership, which is emulated during these DOM routing assertions.
  window.dispatchEvent(new Event("blur"));
  check(!key(document, "u") && hits.underline === beforeUnderline, "Window blur kept a pending sequence.");
  await until(() => pending(document) === "", "Window blur left a stale pending hint.");
  passed.push("pending sequences reset across focus, mode, dialog and window blur contexts");

  for (const id of ["annotation", "editable"]) {
    document.getElementById(id).focus();
    check(!key(document, "g") && !key(document, "u"), "Bare sequence stole text input in " + id);
    check(hits.underline === beforeUnderline, "Typing ran an underline sequence in " + id);
  }
  document.getElementById("reader").focus();
  check(!key(document, "g", {isComposing: true}), "An IME key started a sequence.");
  check(!key(document, "u") && hits.underline === beforeUnderline, "IME composition left a live prefix.");
  document.getElementById("edit").click();
  await until(() => document.getElementById("editor"), "Sequence fixture could not open the editor.");
  document.getElementById("editor").focus();
  await until(() => mode(document) === "edit" && document.querySelector("#bindings").dataset.confirm === "Ctrl+Alt+Y N",
    "Editable sequence configuration did not load.");
  const beforeConfirm = hits.confirm;
  check(key(document, "y", {ctrlKey: true, altKey: true}), "An allowed modified prefix was blocked in the editor.");
  check(hits.confirm === beforeConfirm, "Modified prefix fired before its tail.");
  check(key(document, "n") && hits.confirm === beforeConfirm + 1, "Intentional prefix did not accept a bare tail in the editor.");
  check(!key(document, "n"), "Bare typing was blocked after sequence completion.");
  check(key(document, "y", {ctrlKey: true, altKey: true}), "Native-editing guard prefix did not start.");
  check(!key(document, "c", {ctrlKey: true}), "Pending sequence consumed the editor's native Copy shortcut.");
  check(hits.confirm === beforeConfirm + 1, "Native Copy completed a Babel command.");
  key(document, "Escape");
  passed.push("sequence typing and IME protection with intentional modified prefixes and native Copy");

  for (const {popup, fixedMode} of window.modeFixturePopups) {
    const doc = popup.document;
    const isReader = fixedMode === "read";
    await until(() => doc.querySelector("#bindings").dataset[isReader ? "underline" : "confirm"] ===
      (isReader ? "G U" : "Ctrl+Alt+Y N"), "Detached document did not inherit its sequence.");
    doc.getElementById("popup-action").focus();
    const ownBefore = isReader ? hits.popupRead : hits.popupEdit;
    const sourceBefore = hits.new + hits.underline + hits.confirm;
    check(key(doc, isReader ? "g" : "y", isReader ? {} : {ctrlKey: true, altKey: true}), "Detached prefix did not start.");
    await until(() => pending(doc) !== "", "Detached pending hint was missing.");
    check((isReader ? hits.popupRead : hits.popupEdit) === ownBefore, "Detached prefix fired early.");
    check(key(doc, isReader ? "u" : "n") && (isReader ? hits.popupRead : hits.popupEdit) === ownBefore + 1,
      "Detached sequence did not target its ownerDocument exactly once.");
    check(hits.new + hits.underline + hits.confirm === sourceBefore, "Detached sequence executed an opener command.");
    doc.getElementById("popup-input").focus();
    check(!key(doc, "g"), "Detached input swallowed a bare prefix.");
    passed.push(fixedMode + " detached sequence inheritance and ownerDocument isolation");
  }

  document.querySelector('[data-babel-command="save"]').click();
  await until(() => document.getElementById("reader"), "Settings-reset fixture did not close the editor.");
  document.getElementById("reader").focus();
  await until(() => mode(document) === "read", "Settings-reset fixture did not return to Read.");
  check(key(document, "g"), "Settings-reset prefix did not start.");
  await fetch("/sequence-next-config");
  window.dispatchEvent(new Event("babel:shortcuts-changed"));
  await until(() => document.querySelector("#bindings").dataset.underline === "G O", "Updated sequence configuration did not load.");
  await until(() => pending(document) === "", "Changing settings retained a pending sequence.");
  check(!key(document, "u") && hits.underline === beforeUnderline, "Old configured tail executed after settings changed.");
  check(key(document, "g") && key(document, "o") && hits.underline === beforeUnderline + 1, "New configured sequence did not execute.");
  const detachedReader = window.modeFixturePopups[0].popup.document;
  await until(() => detachedReader.querySelector("#bindings").dataset.underline === "G O", "Detached document did not inherit the updated sequence.");
  passed.push("configuration replacement cancels pending sequences and updates existing detached scopes");
  return passed.join("\n");
};

window.runCommonShortcutFixture = async () => {
  const passed = [];
  await fetch("/common-config");
  window.dispatchEvent(new Event("babel:shortcuts-changed"));
  await until(() => document.querySelector("#bindings").dataset.new === "Ctrl+Alt+N", "Common default settings did not load.");
  window.showCommonFixture(true);
  await until(() => document.getElementById("exit-editor"), "Editor exit fixture did not mount.");
  document.getElementById("exit-editor").focus();
  check(key(document, "Escape"), "Clean editor Escape was not handled.");
  await until(() => document.getElementById("exit-reader"), "Clean Escape did not exit to Read.");
  document.getElementById("exit-reader").focus();
  check(key(document, "Escape"), "Reader Escape was not handled.");
  await until(() => document.activeElement?.id === "common-item", "Reader Escape did not focus the document list.");
  window.editFixture.edit();
  await until(() => document.getElementById("exit-editor"), "Editor did not reopen.");
  window.editFixture.dirty("Unsaved draft");
  await until(() => document.getElementById("exit-editor").value === "Unsaved draft", "Draft did not change.");
  document.getElementById("exit-editor").focus();
  key(document, "Escape");
  await until(() => document.querySelector("dialog[open]"), "Dirty Escape did not ask to save/discard.");
  key(document, "Escape");
  await until(() => document.querySelector("dialog[open]") === null, "Keep editing did not close the exit dialog.");
  check(document.getElementById("exit-editor").value === "Unsaved draft", "Keep editing lost the draft.");
  key(document, "Escape");
  await until(() => document.querySelector("dialog[open]"), "Exit dialog did not reopen.");
  Array.from(document.querySelectorAll("dialog[open] button")).find(button => button.textContent === "Discard changes").click();
  await until(() => document.getElementById("exit-reader"), "Discard did not enter Read.");
  check(document.getElementById("exit-reader").textContent === "Saved text", "Discard replaced saved text.");
  passed.push("clean and dirty Escape ladder with save/discard/keep-editing ownership");

  window.editFixture.edit();
  await until(() => document.getElementById("exit-editor"), "Save editor did not reopen.");
  window.editFixture.dirty("Retry draft");
  await until(() => document.getElementById("exit-editor").value === "Retry draft", "Retry draft did not change.");
  document.getElementById("exit-editor").focus();
  key(document, "Enter", {ctrlKey: true});
  await until(() => document.getElementById("exit-state").dataset.pending === "true", "Save and read did not submit.");
  key(document, "Escape");
  check(document.getElementById("exit-editor") && document.querySelector("dialog[open]") === null, "Escape escaped a pending save.");
  window.finishFixtureSave(false);
  await until(() => document.getElementById("exit-state")?.textContent === "Save failed", "Failed save did not preserve editing.");
  check(document.getElementById("exit-editor").value === "Retry draft", "Failed save lost its draft.");
  key(document, "s", {ctrlKey: true});
  await until(() => document.getElementById("exit-state").dataset.pending === "true", "Retry Save did not submit.");
  window.finishFixtureSave(true);
  await until(() => document.getElementById("exit-state")?.dataset.pending === "false", "Retry Save did not complete.");
  check(document.getElementById("exit-editor"), "Failed Save-and-read intent leaked into ordinary Save.");
  const confirms = hits.confirm;
  document.getElementById("common-confirm").showModal();
  key(document, "Enter", {ctrlKey: true});
  await until(() => document.querySelector("dialog[open]") === null, "Edit Ctrl+Enter did not confirm its modal.");
  check(hits.confirm === confirms + 1, "Edit-layer Ctrl+Enter submitted underlying editor instead of modal.");
  document.getElementById("exit-editor").focus();
  key(document, "Escape");
  await until(() => document.getElementById("exit-reader"), "Saved clean editor did not exit.");
  window.editFixture.edit();
  await until(() => document.getElementById("exit-editor"), "Save-and-read editor did not open.");
  window.editFixture.dirty("Final draft");
  await until(() => document.getElementById("exit-editor").value === "Final draft", "Final draft did not change.");
  document.getElementById("exit-editor").focus();
  key(document, "Escape");
  await until(() => document.querySelector("dialog[open]"), "Final exit dialog missing.");
  key(document, "Enter", {ctrlKey: true});
  await until(() => document.getElementById("exit-state").dataset.pending === "true", "Exit-dialog Save and read did not submit.");
  window.finishFixtureSave(true);
  await until(() => document.getElementById("exit-reader")?.textContent === "Final draft", "Successful save did not enter Read with saved content.");
  passed.push("Ctrl+Enter save/read success, failure retention, pending Escape and modal Confirm");

  document.getElementById("exit-reader").focus();
  for (const [tail, expected] of [["f", "tree"], ["l", "items"], ["c", "detail"]]) {
    check(key(document, "g") && key(document, tail), "Direct pane sequence was not handled: G " + tail);
    await until(() => pane(document) === expected, "Direct pane sequence chose wrong pane: " + expected);
  }
  const bridge = window.chrome.webview;
  const send = bridge.postMessage;
  const messages = [];
  bridge.postMessage = message => messages.push(message);
  try {
    for (let index = 1; index <= 10; index++) key(document, String(index % 10), {ctrlKey: true});
    key(document, "Tab", {ctrlKey: true});
    key(document, "Tab", {ctrlKey: true, shiftKey: true});
    key(document, "w", {ctrlKey: true, shiftKey: true});
    key(document, "Home", {altKey: true});
    check(messages.length === 14 && messages[9] === "babel:command:selectApp10" && messages[13] === "babel:command:appHome", "APP keys did not post scoped desktop commands.");
    document.getElementById("common-confirm").showModal();
    key(document, "1", {ctrlKey: true});
    check(messages.length === 14, "An APP shortcut escaped the active modal.");
    key(document, "Escape");
  } finally { bridge.postMessage = send; }
  passed.push("G F/G L/G C pane focus and desktop APP bridge with modal isolation");

  window.showPagesFixture();
  await until(() => document.getElementById("page-state"), "Page navigation fixture did not mount.");
  const activePage = () => document.getElementById("page-state").dataset.active;
  document.getElementById("common-item").focus();
  key(document, "0", {ctrlKey: true, altKey: true});
  await until(() => activePage() === "note:10", "Ctrl+Alt+0 did not select the tenth tab.");
  key(document, "1", {ctrlKey: true, altKey: true});
  await until(() => activePage() === "note:1", "Ctrl+Alt+1 did not select the first tab.");
  key(document, "ArrowLeft", {altKey: true});
  await until(() => activePage() === "note:10", "History Back did not revisit note 10.");
  key(document, "ArrowRight", {altKey: true});
  await until(() => activePage() === "note:1", "History Forward did not revisit note 1.");
  window.fixturePages.movePage("note:10", 0);
  await until(() => window.fixturePages.pages[0].key === "note:10", "Page reorder did not finish.");
  key(document, "1", {ctrlKey: true, altKey: true});
  await until(() => activePage() === "note:10", "Number keys did not follow tab reorder.");
  key(document, "w", {ctrlKey: true});
  await until(() => document.getElementById("page-state").dataset.count === "9", "Ctrl+W did not close the note tab.");
  const beforeAbsent = activePage();
  key(document, "0", {ctrlKey: true, altKey: true});
  check(activePage() === beforeAbsent, "Absent tenth tab changed the selected page.");
  key(document, "t", {ctrlKey: true, shiftKey: true});
  await until(() => activePage() === "note:10" && document.getElementById("page-state").dataset.count === "10", "Reopen shortcut did not restore the closed note.");
  for (const page of [...window.fixturePages.pages]) window.fixturePages.requestClosePage(page.key);
  await until(() => document.getElementById("page-state").dataset.count === "0", "Pages did not all close.");
  key(document, "t", {ctrlKey: true, shiftKey: true});
  await until(() => document.getElementById("page-state").dataset.count === "1", "Reopen stopped working after the last page closed.");
  passed.push("note number keys, visible reorder, absent targets, history and reopening the last closed tab");
  window.showCommonFixture(false);
  await until(() => document.getElementById("common-item") === null, "Common fixture did not clean up.");
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
  let sequenceBinding = false;
  let updatedSequence = false;
  let settingsRequests = 0;
  let commonSettings = false;
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.url === "/api/shortcuts") {
      settingsRequests++;
      response.setHeader("Content-Type", "application/json");
      if (commonSettings) { response.end(JSON.stringify(settings)); return; }
      response.end(JSON.stringify({ ...settings, layers: { ...settings.layers,
        app: sequenceBinding ? { new: "G N", help: "G H", quickOpen: "Ctrl+Alt+Q X Y Z" } : { new: arrowBinding ? "ArrowDown" : "N" },
        edit: { new: null, confirm: sequenceBinding ? "Ctrl+Alt+Y N" : "N" },
        read: { new: null, underlineSelection: sequenceBinding ? (updatedSequence ? "G O" : "G U") : updated ? "U" : "N" },
      } }));
    } else if (request.url === "/common-config") {
      commonSettings = true;
      response.end("ok");
    } else if (request.url === "/sequence-config") {
      sequenceBinding = true;
      response.end("ok");
    } else if (request.url === "/sequence-next-config") {
      updatedSequence = true;
      response.end("ok");
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
    assert.equal((stdout.match(/^PASS /gm) ?? []).length, 19, stdout);
    assert.equal(settingsRequests, 6, "Popups must inherit their parent's configuration without independent fetches.");
    context.diagnostic(stdout.split(/\r?\n/).find(line => line.includes("native APP source restoration")) ?? "");
    context.diagnostic("Verified actual React providers and WebView2 DOM key events with isolated document focus emulation; native source-return checks run after emulation is disabled. Physical keyboard delivery is outside this fixture.");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
