import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { htmlBridgeSource, isHtmlBridgeMessage, isHtmlBridgeReady, locateHtmlQuote } from "../src/bridge";
import { HTML_FRAME_SANDBOX, HTML_READER_CONTENT_SECURITY_POLICY, htmlAssetBase, htmlDocumentPolicy } from "../src/sandbox";

const documentId = "c7b7eaf3-5dc9-4a02-988f-f8ed6f7fca11";
const channelId = "session_1234567890";
const base = `http://localhost:3010/api/html/documents/${documentId}/assets/`;
const envelope = { v: 1, channelId, documentId };

test("HTML policies give scripts an opaque frame and only the document's immutable resource namespace", () => {
  assert.equal(HTML_FRAME_SANDBOX, "allow-scripts");
  assert.match(HTML_READER_CONTENT_SECURITY_POLICY, /(?:^|; )frame-src blob:(?:;|$)/u);
  const policy = htmlDocumentPolicy(base);
  assert.match(policy, /connect-src blob: http:\/\/localhost:3010\/api\/html\/documents\//u);
  for (const directive of ["frame-src", "worker-src", "object-src", "form-action", "manifest-src"]) assert.ok(policy.includes(`${directive} 'none'`));
  assert.ok(!policy.includes("'self'"));
  assert.equal(htmlAssetBase(base).href, base);
  for (const invalid of [base.replace("http:", "file:"), `${base}?x=1`, `${base}#x`, base.replace("/assets/", "/"), base.replace(documentId, "not-an-id"), base.replace("localhost", "user:password@localhost")]) {
    assert.throws(() => htmlAssetBase(invalid));
  }
});

test("frame messages are bounded and pinned to the exact reading session and document", () => {
  assert.equal(isHtmlBridgeReady({ ...envelope, kind: "html-ready" }, channelId, documentId), true);
  assert.equal(isHtmlBridgeReady({ ...envelope, kind: "html-ready" }, "other", documentId), false);
  assert.equal(isHtmlBridgeReady({ ...envelope, kind: "html-ready" }, channelId, "other"), false);
  assert.equal(isHtmlBridgeMessage({ ...envelope, kind: "progress", progress: { position: .5, scale: 1.25 } }, channelId, documentId), true);
  assert.equal(isHtmlBridgeMessage({ ...envelope, kind: "progress", progress: { position: Infinity, scale: 1 } }, channelId, documentId), false);
  assert.equal(isHtmlBridgeMessage({ ...envelope, kind: "restored", progress: { position: .75, scale: 1.5 } }, channelId, documentId), true);
  assert.equal(isHtmlBridgeMessage({ ...envelope, kind: "focus-find" }, channelId, documentId), true);
  assert.equal(isHtmlBridgeMessage({ ...envelope, kind: "capture-state", active: true }, channelId, documentId), true);
  assert.equal(isHtmlBridgeMessage({ ...envelope, kind: "capture-state", active: "true" }, channelId, documentId), false);
  assert.equal(isHtmlBridgeMessage({ ...envelope, kind: "selection", selection: { text: "Quote", prefix: "Before ", suffix: " after", occurrence: 0, section: "Chapter" } }, channelId, documentId), true);
  assert.equal(isHtmlBridgeMessage({ ...envelope, kind: "selection", selection: { text: "x".repeat(20_001), prefix: "", suffix: "", occurrence: 0, section: "" } }, channelId, documentId), false);
  assert.equal(isHtmlBridgeMessage({ ...envelope, kind: "selection", selection: { text: "", prefix: "", suffix: "", occurrence: 0, section: "", imageDataUrl: "data:image/svg+xml,<svg/>" } }, channelId, documentId), false);
  assert.equal(isHtmlBridgeMessage({ ...envelope, kind: "navigate", path: "Book/chapter.htm", hash: "#section" }, channelId, documentId), true);
  for (const path of ["../private.html", "/api/notes.html", "a\\b.html", "file:a.html", "https://example.com/a.html", "a/./b.html", "a//b.html", "notes.json"]) {
    assert.equal(isHtmlBridgeMessage({ ...envelope, kind: "navigate", path, hash: "" }, channelId, documentId), false, path);
  }
  assert.equal(isHtmlBridgeMessage({ ...envelope, kind: "find-result", current: 3, total: 2 }, channelId, documentId), false);
  assert.equal(isHtmlBridgeMessage({ ...envelope, kind: "notice", message: "x".repeat(1_001) }, channelId, documentId), false);
  assert.equal(isHtmlBridgeMessage({ ...envelope, kind: "resource-warning", message: "A script is missing." }, channelId, documentId), true);
  assert.equal(isHtmlBridgeMessage({ ...envelope, kind: "resource-warning", message: "x".repeat(1_001) }, channelId, documentId), false);
  assert.equal(isHtmlBridgeMessage({ ...envelope, kind: "unknown" }, channelId, documentId), false);
});

test("quote anchors prefer contextual duplicates and retain occurrences beyond ten thousand matches", () => {
  const content = "first bond after one\nsecond bond after two";
  const start = content.lastIndexOf("bond");
  assert.deepEqual(locateHtmlQuote(content, { text: "bond", prefix: "second ", suffix: " after two", occurrence: 0 }), { start, end: start + 4 });
  assert.deepEqual(locateHtmlQuote(content, { text: "bond", prefix: "", suffix: "", occurrence: 1 }), { start, end: start + 4 });
  const repeated = `${"x ".repeat(10_005)}last x end`;
  assert.deepEqual(locateHtmlQuote(repeated, { text: "x", prefix: "last ", suffix: " end", occurrence: 10_005 }), { start: repeated.lastIndexOf("x"), end: repeated.lastIndexOf("x") + 1 });
  assert.equal(locateHtmlQuote(content, { text: "absent", prefix: "", suffix: "", occurrence: 0 }), null);
  assert.equal(locateHtmlQuote(content, { text: "", prefix: "", suffix: "", occurrence: 0 }), null);
});

test("the emitted bootstrap executes without module helpers, pins its port, and isolates page storage", () => {
  const listeners = new Map<string, Array<(value: unknown) => void>>();
  const documentListeners = new Map<string, () => void>();
  const parentMessages: unknown[] = [];
  let fragmentScrolls = 0;
  let openedDetails = false;
  const fragment = { closest() { return null; }, parentElement: { tagName: "DETAILS", parentElement: null, setAttribute(name: string) { openedDetails = name === "open"; } }, scrollIntoView() { fragmentScrolls += 1; } };
  let observedOptions: MutationObserverInit | undefined;
  let mutationCallback: ((records: unknown[]) => void) | undefined;
  let refreshes = 0;
  let textScans = 0;
  const timers: Array<() => void> = [];
  let pauseAnimationFrames = false;
  class Element {
    parentElement = null;
    closest() { return null; }
  }
  const makeElement = () => ({ style: {}, isConnected: false, setAttribute() {}, appendChild() {}, replaceChildren() {}, remove() {} });
  const parent = { postMessage(value: unknown) { parentMessages.push(value); } };
  const document = {
    createElement: makeElement, head: { appendChild() {} }, body: { appendChild() {}, contains() { return false; } },
    documentElement: { scrollHeight: 1_000, style: {} }, readyState: "loading", visibilityState: "visible", title: "Interactive chemistry",
    querySelectorAll() { return []; }, createTreeWalker() { textScans += 1; return { nextNode() { return null; } }; },
    getElementById(id: string) { return id === "chapter two" ? fragment : null; }, getElementsByName() { return []; },
    addEventListener(kind: string, callback: () => void) { documentListeners.set(kind, callback); },
  };
  const frame = {
    parent, scrollY: 0, innerHeight: 500, scrollTo(this: { scrollY: number }, options: { top: number }) { this.scrollY = options.top; }, setInterval() { return 1; }, setTimeout(callback: () => void) { timers.push(callback); refreshes += 1; return timers.length; },
    addEventListener(kind: string, callback: (value: unknown) => void) { const entries = listeners.get(kind) ?? []; entries.push(callback); listeners.set(kind, entries); },
  };
  Object.defineProperty(frame, "localStorage", { get() { throw new Error("Opaque storage"); }, configurable: true });
  class Port {
    messages: Array<{ kind: string }> = [];
    onmessage?: (event: { data: unknown }) => void;
    postMessage(value: { kind: string }) { this.messages.push(value); }
    start() {}
  }
  const source = htmlBridgeSource({ channelId, documentId, assetBaseUrl: base, entryPath: "Book/index.html" });
  runInNewContext(source, { window: frame, document, CSS: { highlights: new Map() }, MessagePort: Port, URL, DOMException, Element,
    MutationObserver: class { constructor(callback: (records: unknown[]) => void) { mutationCallback = callback; } observe(_target: unknown, options: MutationObserverInit) { observedOptions = options; } }, clearInterval() {}, clearTimeout() {}, requestAnimationFrame(callback: () => void) { if (!pauseAnimationFrames) callback(); return 1; }, NodeFilter: { SHOW_TEXT: 4 } });
  assert.equal(parentMessages.length, 1);
  const receive = listeners.get("message")![0];
  const channel = new Port();
  const connect = { source: parent, data: { ...envelope, kind: "html-connect" }, ports: [channel], stopImmediatePropagation() {} };
  receive({ ...connect, source: {} });
  assert.equal(channel.onmessage, undefined);
  receive(connect);
  assert.equal(typeof channel.onmessage, "function");
  documentListeners.get("DOMContentLoaded")!();
  assert.ok(channel.messages.some(message => message.kind === "ready"));
  channel.onmessage!({ data: { kind: "find", query: "" } });
  assert.ok(channel.messages.some(message => message.kind === "find-result"));
  channel.onmessage!({ data: { kind: "restore", progress: { position: .75, scale: 1.5 } } });
  assert.equal(channel.messages.some(message => message.kind === "restored"), false, "Restore waits for local resources to establish the final page height.");
  document.documentElement.scrollHeight = 1_500;
  document.readyState = "complete";
  listeners.get("load")![0]({});
  const restored = channel.messages.findIndex(message => message.kind === "restored");
  const progress = channel.messages.findIndex(message => message.kind === "progress");
  assert.ok(restored >= 0 && progress > restored);
  assert.equal(frame.scrollY, 750);
  assert.deepEqual((channel.messages[restored] as { kind: string; progress: { position: number; scale: number } }).progress.position, .75);
  timers.at(-1)!();
  assert.equal(channel.messages.filter(message => message.kind === "restored").length, 1, "The animation frame and fallback must not apply progress twice.");
  pauseAnimationFrames = true;
  channel.onmessage!({ data: { kind: "restore", progress: { position: .25, scale: 2 } } });
  assert.equal(channel.messages.filter(message => message.kind === "restored").length, 1);
  timers.at(-1)!();
  assert.equal(frame.scrollY, 250);
  assert.equal(channel.messages.filter(message => message.kind === "restored").length, 2, "A background window restores progress even when animation frames are suspended.");
  const beforeHeadings = channel.messages.filter(message => message.kind === "headings").length;
  listeners.get("resize")![0]({});
  documentListeners.get("visibilitychange")!();
  assert.equal(channel.messages.filter(message => message.kind === "headings").length, beforeHeadings + 2, "Contents and annotation layout refresh when a background reader becomes visible or changes size.");
  assert.equal(textScans, 0, "Restoring, resizing and displaying an unannotated formula-heavy page must not scan every text node's layout.");
  const failedScript = new Element() as Element & { matches: () => boolean; getAttribute: () => string };
  failedScript.matches = () => true;
  failedScript.getAttribute = () => `${base}Books/assets/missing.js`;
  listeners.get("error")![0]({ target: failedScript });
  listeners.get("error")![0]({ target: failedScript });
  assert.equal(channel.messages.filter(message => message.kind === "resource-warning").length, 1, "Failed local loads are reported once and separately from temporary reader notices.");
  channel.onmessage!({ data: { kind: "fragment", hash: "#chapter%20two" } });
  assert.equal(fragmentScrolls, 1, "Cross-document fragments resolve original DOM ids, independently of generated heading ids.");
  assert.equal(openedDetails, true, "A fragment inside collapsed details is revealed.");
  for (const hash of ["chapter two", "#missing", "#%zz"]) channel.onmessage!({ data: { kind: "fragment", hash } });
  assert.equal(fragmentScrolls, 1);
  assert.equal(observedOptions?.attributes, true);
  assert.deepEqual(Array.from(observedOptions?.attributeFilter ?? []), ["open", "hidden", "class", "style"]);
  const beforeRefresh = refreshes;
  mutationCallback!([{ target: new Element(), type: "attributes", attributeName: "open" }]);
  assert.equal(refreshes, beforeRefresh + 1, "Opening details or changing visibility refreshes annotations and contents.");
  mutationCallback!([{ target: { parentElement: { closest() { return {}; } } }, type: "characterData" }]);
  assert.equal(refreshes, beforeRefresh + 1, "Painting the bridge's own style text must not create a mutation refresh loop.");
  listeners.get("keydown")![0]({ key: "f", ctrlKey: true, metaKey: false, altKey: false, preventDefault() {} });
  assert.ok(channel.messages.some(message => message.kind === "focus-find"));
  const local = (frame as typeof frame & { localStorage: Storage; sessionStorage: Storage }).localStorage;
  const session = (frame as typeof frame & { sessionStorage: Storage }).sessionStorage;
  local.setItem("counter", "2");
  assert.equal(local.getItem("counter"), "2");
  assert.equal(session.getItem("counter"), null);
  assert.throws(() => local.setItem("large", "x".repeat(2 * 1024 * 1024)), { name: "QuotaExceededError" });
  local.clear();
  assert.equal(local.length, 0);
});

test("bootstrap configuration cannot close its script element", () => {
  const source = htmlBridgeSource({ channelId: "</script><script>alert(1)", documentId, assetBaseUrl: base, entryPath: "index.html" });
  assert.ok(!source.toLowerCase().includes("</script"));
  assert.ok(source.includes("\\u003c/script"));
});
