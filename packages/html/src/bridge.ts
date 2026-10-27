import type { HtmlAnnotation, HtmlProgress } from "@babel-apps/platform/html/core";

export interface HtmlHeading { id: string; text: string; level: number }
export interface HtmlSelection {
  text: string;
  prefix: string;
  suffix: string;
  occurrence: number;
  section: string;
  imageDataUrl?: string;
}
export type HtmlBridgeCommand =
  | { kind: "restore"; progress: HtmlProgress }
  | { kind: "annotations"; annotations: HtmlAnnotation[] }
  | { kind: "find"; query: string; direction?: "next" | "previous" }
  | { kind: "scroll"; headingId: string }
  | { kind: "fragment"; hash: string }
  | { kind: "reveal"; annotation: HtmlAnnotation }
  | { kind: "capture"; active: boolean };
interface Envelope { v: 1; channelId: string; documentId: string }
export type HtmlBridgeMessage = Envelope & (
  | { kind: "ready"; title: string; headings: HtmlHeading[] }
  | { kind: "headings"; headings: HtmlHeading[] }
  | { kind: "selection"; selection: HtmlSelection | null }
  | { kind: "progress"; progress: HtmlProgress }
  | { kind: "restored"; progress: HtmlProgress }
  | { kind: "navigate"; path: string; hash: string }
  | { kind: "focus-find" }
  | { kind: "capture-state"; active: boolean }
  | { kind: "find-result"; current: number; total: number }
  | { kind: "notice"; message: string }
);
export interface HtmlBridgeReady extends Envelope { kind: "html-ready" }
export interface HtmlBridgeConfiguration { channelId: string; documentId: string; assetBaseUrl: string; entryPath: string }

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.length <= limit;
const integer = (value: unknown, limit: number): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= limit;
function progress(value: unknown): value is HtmlProgress {
  return record(value) && typeof value.position === "number" && Number.isFinite(value.position) && value.position >= 0 && value.position <= 1 &&
    typeof value.scale === "number" && Number.isFinite(value.scale) && value.scale >= .1 && value.scale <= 8;
}
function headings(value: unknown): value is HtmlHeading[] {
  return Array.isArray(value) && value.length <= 1_000 && value.every((entry: unknown) => record(entry) && text(entry.id, 80) && text(entry.text, 240) &&
    Number.isSafeInteger(entry.level) && (entry.level as number) >= 1 && (entry.level as number) <= 6);
}
function selection(value: unknown): value is HtmlSelection {
  return record(value) && text(value.text, 20_000) && text(value.prefix, 120) && text(value.suffix, 120) && integer(value.occurrence, 1_000_000) && text(value.section, 240) &&
    (value.imageDataUrl === undefined || (text(value.imageDataUrl, 14 * 1024 * 1024) && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/u.test(value.imageDataUrl))) &&
    (value.text.trim().length > 0 || value.imageDataUrl !== undefined);
}
function envelope(value: unknown, channelId: string, documentId: string): value is Record<string, unknown> & Envelope {
  return record(value) && value.v === 1 && value.channelId === channelId && value.documentId === documentId;
}
/** Frame data remains untrusted; pin event.source separately before calling. */
export function isHtmlBridgeReady(value: unknown, channelId: string, documentId: string): value is HtmlBridgeReady {
  return envelope(value, channelId, documentId) && value.kind === "html-ready";
}
export function isHtmlBridgeMessage(value: unknown, channelId: string, documentId: string): value is HtmlBridgeMessage {
  if (!envelope(value, channelId, documentId)) return false;
  switch (value.kind) {
    case "ready": return text(value.title, 240) && headings(value.headings);
    case "headings": return headings(value.headings);
    case "selection": return value.selection === null || selection(value.selection);
    case "progress": case "restored": return progress(value.progress);
    case "focus-find": return true;
    case "capture-state": return typeof value.active === "boolean";
    case "navigate": return text(value.path, 1_024) && value.path.length > 0 && !value.path.startsWith("/") &&
      !/[:\\\u0000-\u001f\u007f]/u.test(value.path) && !value.path.split("/").some(segment => !segment || segment === "." || segment === "..") && /\.html?$/iu.test(value.path) &&
      text(value.hash, 1_024) && (value.hash === "" || value.hash.startsWith("#"));
    case "find-result": return integer(value.current, 1_000) && integer(value.total, 1_000) && value.current <= value.total;
    case "notice": return text(value.message, 1_000);
    default: return false;
  }
}

export interface HtmlQuote { text: string; prefix: string; suffix: string; occurrence: number }

/** Exact quotes retain nearby context so duplicate phrases resolve predictably. */
export function locateHtmlQuote(content: string, quote: HtmlQuote): { start: number; end: number } | null {
  if (!quote.text || quote.text.length > 20_000 || content.length > 4_000_000) return null;
  let position = -1;
  let ordinal = 0;
  let best: { start: number; end: number; score: number } | null = null;
  while (ordinal <= 1_000_000) {
    position = content.indexOf(quote.text, position + 1);
    if (position < 0) break;
    const end = position + quote.text.length;
    const before = content.slice(Math.max(0, position - quote.prefix.length), position);
    const after = content.slice(end, end + quote.suffix.length);
    const score = (quote.prefix && before === quote.prefix ? 4 : 0) + (quote.suffix && after === quote.suffix ? 4 : 0) + (ordinal === quote.occurrence ? 1 : 0);
    if (!best || score > best.score) best = { start: position, end, score };
    if (score === 9) break;
    ordinal += 1;
  }
  return best ? { start: best.start, end: best.end } : null;
}

/** Serialized before imported scripts; every implementation dependency stays inside. */
function installHtmlBridge(configuration: HtmlBridgeConfiguration, locateQuote: typeof locateHtmlQuote) {
  let port: MessagePort | null = null;
  let scale = 1;
  let loaded = false;
  let pendingRestore: HtmlProgress | null = null;
  let currentAnnotations: HtmlAnnotation[] = [];
  let headingsList: HtmlHeading[] = [];
  const headingElements = new Map<string, Element>();
  const headingIds = new WeakMap<Element, string>();
  let nextHeadingId = 0;
  let findQuery = "";
  let findRanges: Range[] = [];
  let findIndex = -1;
  let captureLayer: HTMLDivElement | null = null;
  let captureBox: HTMLDivElement | null = null;
  let captureStart: { x: number; y: number } | null = null;
  let capturePending = false;
  let captureAbort: AbortController | null = null;
  let captureAssetBytes = 0;
  const captureAssets = new Map<string, Promise<string>>();
  let updateTimer = 0;
  let progressTimer = 0;
  let selectionTimer = 0;
  const ownSelector = "[data-babel-html-bridge]";
  const excluded = `script,style,noscript,template,${ownSelector}`;
  const nativePortPost = Function.prototype.call.bind(MessagePort.prototype.postMessage) as (target: MessagePort, message: unknown) => void;
  const notifyParent = window.parent.postMessage.bind(window.parent);
  const nativeScroll = window.scrollTo.bind(window);
  const base = new URL(configuration.assetBaseUrl);
  const seenNotices = new Set<string>();
  const annotationHighlightNames = new Set<string>();
  // Opaque frames cannot use the notebook's Storage. Keep common page preferences
  // usable inside this frame without exposing or persisting Babel application state.
  function memoryStorage(): Storage {
    const values = new Map<string, string>();
    const methods = {
      get length() { return values.size; },
      key(index: number) { return Array.from(values.keys())[index] ?? null; },
      getItem(key: string) { return values.get(String(key)) ?? null; },
      setItem(key: string, value: string) {
        const name = String(key); const data = String(value);
        let size = name.length + data.length;
        for (const pair of values) if (pair[0] !== name) size += pair[0].length + pair[1].length;
        if (size > 2 * 1024 * 1024 || values.size >= 5_000 && !values.has(name)) throw new DOMException("This reading session's page storage is full.", "QuotaExceededError");
        values.set(name, data);
      },
      removeItem(key: string) { values.delete(String(key)); },
      clear() { values.clear(); },
    };
    return new Proxy(methods, {
      get(target, property) { return typeof property === "string" && !(property in target) ? values.get(property) : Reflect.get(target, property); },
      set(_target, property, value) { if (typeof property === "string") methods.setItem(property, String(value)); return true; },
      deleteProperty(_target, property) { if (typeof property === "string") values.delete(property); return true; },
    }) as Storage;
  }
  try {
    Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: false });
    Object.defineProperty(window, "sessionStorage", { value: memoryStorage(), configurable: false });
  } catch { /* Browsers with immutable storage descriptors keep the opaque-origin restriction. */ }
  const highlightRegistry = (CSS as typeof CSS & { highlights?: Map<string, Highlight> }).highlights;
  const overlay = document.createElement("div");
  overlay.setAttribute("data-babel-html-bridge", "");
  overlay.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483645";
  const markerStyle = document.createElement("style");
  markerStyle.setAttribute("data-babel-html-bridge", "");
  document.head.appendChild(markerStyle);

  function emit(message: object) {
    if (port) nativePortPost(port, Object.assign({ v: 1, channelId: configuration.channelId, documentId: configuration.documentId }, message));
  }
  function notice(message: string, repeat = false) {
    if (!repeat && (seenNotices.has(message) || seenNotices.size >= 30)) return;
    if (seenNotices.size < 30) seenNotices.add(message);
    emit({ kind: "notice", message: message.slice(0, 1_000) });
  }
  function safeProgress() {
    const height = Math.max(0, (document.scrollingElement || document.documentElement).scrollHeight - window.innerHeight);
    return { position: height ? Math.max(0, Math.min(1, window.scrollY / height)) : 0, scale };
  }
  function restoreProgress(progress: HtmlProgress) {
    scale = Math.max(.1, Math.min(8, progress.scale)); document.documentElement.style.zoom = String(scale);
    let applied = false;
    const apply = () => {
      if (applied) { rebuildHeadings(); paintAnnotations(); return; }
      applied = true; clearTimeout(fallback);
      const height = Math.max(0, (document.scrollingElement || document.documentElement).scrollHeight - window.innerHeight);
      nativeScroll({ top: Math.max(0, Math.min(1, progress.position)) * height, behavior: "auto" }); paintAnnotations();
      emit({ kind: "restored", progress: safeProgress() }); emitProgress();
    };
    // Background reading windows may defer animation frames indefinitely.
    const fallback = window.setTimeout(apply, 100);
    requestAnimationFrame(() => requestAnimationFrame(apply));
  }
  function emitProgress() {
    if (!loaded || pendingRestore) return;
    emit({ kind: "progress", progress: safeProgress() });
  }
  interface Segment { node: Text; start: number; end: number }
  interface TextIndex { text: string; nodes: Segment[] }
  function textIndex(): TextIndex {
    if (!document.body) return { text: "", nodes: [] };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    const nodes: Segment[] = [];
    let length = 0;
    let lastBlock: Element | null = null;
    for (let node = walker.nextNode(); node && nodes.length < 50_000; node = walker.nextNode()) {
      if (!node.nodeValue || node.parentElement?.closest(excluded)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      if (!Array.from(range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0)) continue;
      const block = node.parentElement?.closest("p,h1,h2,h3,h4,h5,h6,li,div,section,article,tr,pre,blockquote,figure,dt,dd") ?? null;
      if (nodes.length && block !== lastBlock) { parts.push("\n"); length += 1; }
      const value = node.nodeValue.slice(0, Math.max(0, 4_000_000 - length));
      if (!value) break;
      nodes.push({ node: node as Text, start: length, end: length + value.length });
      parts.push(value); length += value.length; lastBlock = block;
      if (length >= 4_000_000) break;
    }
    if (length >= 4_000_000 || nodes.length >= 50_000) notice("This document exceeds the searchable text limit. Some later text may not support search or annotations.");
    return { text: parts.join(""), nodes };
  }
  function indexedRange(index: TextIndex, start: number, end: number): Range | null {
    const first = index.nodes.find(segment => segment.end > start);
    const last = index.nodes.find(segment => segment.end >= end && segment.start < end);
    if (!first || !last) return null;
    const range = document.createRange();
    try {
      range.setStart(first.node, Math.max(0, Math.min(first.node.length, start - first.start)));
      range.setEnd(last.node, Math.max(0, Math.min(last.node.length, end - last.start)));
      return range;
    } catch { return null; }
  }
  function sectionFor(node: Node | null): string {
    let section = "";
    if (!node) return section;
    for (const heading of headingsList) {
      const element = headingElements.get(heading.id);
      if (element && (element.contains(node) || Boolean(element.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING))) section = heading.text;
    }
    return section;
  }
  function publishSelection() {
    if (captureLayer || capturePending) return;
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || !selected.rangeCount) { emit({ kind: "selection", selection: null }); return; }
    const range = selected.getRangeAt(0);
    if (!document.body?.contains(range.commonAncestorContainer)) return;
    const index = textIndex();
    let start = -1;
    let end = -1;
    for (const segment of index.nodes) {
      if (!range.intersectsNode(segment.node)) continue;
      const from = range.startContainer === segment.node ? range.startOffset : 0;
      const until = range.endContainer === segment.node ? range.endOffset : segment.node.length;
      if (until <= from) continue;
      if (start < 0) start = segment.start + from;
      end = segment.start + until;
    }
    if (start < 0 || end <= start) { emit({ kind: "selection", selection: null }); return; }
    const original = index.text.slice(start, end);
    start += original.length - original.trimStart().length;
    end -= original.length - original.trimEnd().length;
    const selectedText = index.text.slice(start, end);
    if (!selectedText || selectedText.length > 20_000) {
      notice("Select up to 20,000 characters at a time.");
      emit({ kind: "selection", selection: null }); return;
    }
    let occurrence = 0;
    let found = index.text.indexOf(selectedText);
    while (found >= 0 && found < start && occurrence < 1_000_000) { occurrence += 1; found = index.text.indexOf(selectedText, found + 1); }
    emit({ kind: "selection", selection: { text: selectedText, prefix: index.text.slice(Math.max(0, start - 64), start), suffix: index.text.slice(end, end + 64), occurrence, section: sectionFor(range.startContainer) } });
  }
  function rebuildHeadings() {
    headingElements.clear();
    const result: HtmlHeading[] = [];
    for (const element of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
      if (result.length >= 1_000) break;
      if (element.closest(ownSelector) || !element.getClientRects().length) continue;
      const label = element.textContent?.trim().replace(/\s+/gu, " ").slice(0, 240);
      if (!label) continue;
      let id = headingIds.get(element);
      if (!id) { id = `heading-${nextHeadingId++}`; headingIds.set(element, id); }
      headingElements.set(id, element);
      result.push({ id, text: label, level: Number(element.tagName.slice(1)) });
    }
    headingsList = result;
    emit({ kind: "headings", headings: result });
  }
  function scrollToFragment(hash: string) {
    if (!hash.startsWith("#") || hash.length > 1_024) return;
    try {
      const id = decodeURIComponent(hash.slice(1));
      const element = document.getElementById(id) ?? Array.from(document.getElementsByName(id)).find(candidate => candidate.tagName === "A");
      if (!element || element.closest(ownSelector)) return;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (parent.tagName === "DETAILS") parent.setAttribute("open", "");
      }
      element.scrollIntoView({ block: "start", behavior: "auto" });
    } catch { /* Malformed source fragments stay inside this document. */ }
  }
  function paintAnnotations() {
    for (const name of annotationHighlightNames) highlightRegistry?.delete(name);
    annotationHighlightNames.clear();
    overlay.replaceChildren();
    const index = textIndex();
    const styles = ["::highlight(babel-html-find){background:#f9d977;color:#17241f}::highlight(babel-html-find-active){background:#ed9b4b;color:#17241f}"];
    let missing = 0;
    for (let position = 0; position < currentAnnotations.length; position += 1) {
      const annotation = currentAnnotations[position];
      const located = locateQuote(index.text, annotation);
      const range = located ? indexedRange(index, located.start, located.end) : null;
      if (!range) { missing += 1; continue; }
      if (highlightRegistry && typeof Highlight !== "undefined") {
        const name = `babel-html-annotation-${position}`;
        annotationHighlightNames.add(name);
        highlightRegistry.set(name, new Highlight(range));
        styles.push(`::highlight(${name}){${annotation.type === "underline" ? `text-decoration:underline 2px ${annotation.color};text-underline-offset:3px` : `background:${annotation.color}66`}}`);
      } else {
        for (const rect of range.getClientRects()) {
          if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > window.innerHeight) continue;
          const marker = document.createElement("span");
          marker.style.cssText = `position:absolute;left:${rect.left + window.scrollX}px;top:${rect.top + window.scrollY}px;width:${rect.width}px;height:${rect.height}px;${annotation.type === "underline" ? `border-bottom:2px solid ${annotation.color}` : `background:${annotation.color};opacity:.3`}`;
          overlay.appendChild(marker);
        }
      }
    }
    markerStyle.textContent = styles.join("\n");
    if (missing && index.nodes.length) notice("Some annotations could not be located in the currently visible content. Expand the relevant section to show them.");
  }
  function find(query: string, direction?: "next" | "previous") {
    const normalized = query.trim().slice(0, 300);
    if (!normalized) {
      findQuery = ""; findIndex = -1; findRanges = [];
      highlightRegistry?.delete("babel-html-find"); highlightRegistry?.delete("babel-html-find-active");
      emit({ kind: "find-result", current: 0, total: 0 }); return;
    }
    const index = textIndex();
    if (normalized !== findQuery || !findRanges.length || findRanges.some(range => !range.startContainer.isConnected)) {
      const expression = new RegExp(normalized.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "giu");
      findQuery = normalized; findRanges = []; findIndex = -1;
      for (let match = expression.exec(index.text); match && findRanges.length < 1_000; match = expression.exec(index.text)) {
        const range = indexedRange(index, match.index, match.index + match[0].length);
        if (range) findRanges.push(range);
      }
    }
    if (findRanges.length) {
      findIndex = (findIndex + (direction === "previous" ? -1 : 1) + findRanges.length) % findRanges.length;
      const range = findRanges[findIndex];
      const rect = range.getBoundingClientRect();
      nativeScroll({ top: Math.max(0, window.scrollY + rect.top - window.innerHeight * .3), behavior: "auto" });
      if (highlightRegistry && typeof Highlight !== "undefined") {
        highlightRegistry.set("babel-html-find", new Highlight(...findRanges));
        highlightRegistry.set("babel-html-find-active", new Highlight(range));
      } else {
        const selected = window.getSelection(); selected?.removeAllRanges(); selected?.addRange(range);
      }
    }
    emit({ kind: "find-result", current: findRanges.length ? findIndex + 1 : 0, total: findRanges.length });
  }
  function stopCapture() {
    captureLayer?.remove(); captureBox?.remove(); captureLayer = null; captureBox = null; captureStart = null;
    emit({ kind: "capture-state", active: false });
  }
  async function inlineImage(url: string): Promise<string> {
    if (/^data:/iu.test(url)) return url;
    if (!url.startsWith(base.href) && !url.startsWith("blob:")) throw new Error("The capture includes an unavailable external image.");
    const cached = captureAssets.get(url);
    if (cached) return await cached;
    const reading = readCaptureAsset(url); captureAssets.set(url, reading);
    return await reading;
  }
  async function readCaptureAsset(url: string): Promise<string> {
    const response = await fetch(url, { credentials: "omit", signal: captureAbort?.signal });
    if (!response.ok) throw new Error("An image could not be read for this capture.");
    const blob = await response.blob();
    captureAssetBytes += blob.size;
    if (blob.size > 10 * 1024 * 1024 || captureAssetBytes > 12 * 1024 * 1024) throw new Error("Resources in this region exceed the capture limit.");
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("An image could not be captured.")); reader.readAsDataURL(blob);
    });
  }
  async function capture(rect: { left: number; top: number; width: number; height: number }) {
    if (capturePending) return;
    capturePending = true;
    captureAbort = new AbortController(); captureAssetBytes = 0; captureAssets.clear();
    let section = "";
    for (const heading of headingsList) {
      const bounds = headingElements.get(heading.id)?.getBoundingClientRect();
      if (bounds && bounds.top <= rect.top + Math.min(24, rect.height)) section = heading.text;
    }
    try {
      if (rect.width < 3 || rect.height < 3 || rect.width * rect.height > 16_000_000) throw new Error("Choose a capture area from 3 pixels to 16 megapixels.");
      const clone = document.documentElement.cloneNode(true) as HTMLElement;
      const originals = Array.from(document.documentElement.querySelectorAll("*"));
      const copies = Array.from(clone.querySelectorAll("*"));
      if (originals.length > 8_000) throw new Error("This page is too complex for an image capture. Select text or use a smaller source document.");
      const jobs: Promise<void>[] = [];
      const usedFonts = new Set<string>();
      for (let index = 0; index < originals.length; index += 1) {
        const original = originals[index];
        const copy = copies[index];
        if (!copy || original.closest(excluded) || original.matches("head,link,meta,base,title")) { copy?.remove(); continue; }
        for (const attribute of Array.from(copy.attributes)) if (/^on/iu.test(attribute.name) || ["srcset", "integrity", "crossorigin"].includes(attribute.name)) copy.removeAttribute(attribute.name);
        const computed = getComputedStyle(original);
        for (const family of computed.fontFamily.split(",")) usedFonts.add(family.trim().replace(/^["']|["']$/gu, ""));
        let declarations = "";
        for (const property of Array.from(computed)) declarations += `${property}:${computed.getPropertyValue(property)};`;
        copy.setAttribute("style", declarations);
        if (original instanceof HTMLCanvasElement) {
          if (original.width * original.height > 16_000_000) throw new Error("A canvas in this document exceeds the capture limit.");
          const image = document.createElement("img"); image.src = original.toDataURL("image/png"); image.setAttribute("style", declarations); copy.replaceWith(image);
        } else if (original instanceof HTMLImageElement) {
          jobs.push(inlineImage(original.currentSrc || original.src).then(value => { copy.setAttribute("src", value); }));
        } else if (original instanceof HTMLInputElement) copy.setAttribute("value", original.value);
        else if (original instanceof HTMLTextAreaElement) copy.textContent = original.value;
        const background = computed.backgroundImage;
        if (background && background !== "none") {
          const pattern = /url\(["']?([^"')]+)["']?\)/gu;
          const matches = Array.from(background.matchAll(pattern));
          if (matches.length) jobs.push(Promise.all(matches.map(match => inlineImage(match[1]))).then(values => {
            let cursor = 0; (copy as HTMLElement).style.backgroundImage = background.replace(pattern, () => `url("${values[cursor++]}")`);
          }));
        }
      }
      await Promise.all(jobs);
      const embeddedFonts: string[] = [];
      const seenSheets = new Set<CSSStyleSheet>();
      async function copyFontRules(sheet: CSSStyleSheet) {
        if (seenSheets.has(sheet) || embeddedFonts.length >= 64) return;
        seenSheets.add(sheet);
        let rules: CSSRuleList;
        try { rules = sheet.cssRules; } catch { return; }
        for (const rule of rules) {
          if (embeddedFonts.length >= 64) break;
          if (rule.type === CSSRule.IMPORT_RULE) {
            const child = (rule as CSSImportRule).styleSheet;
            if (child) await copyFontRules(child);
          } else if (rule.type === CSSRule.FONT_FACE_RULE) {
            const font = rule as CSSFontFaceRule;
            if (!usedFonts.has(font.style.fontFamily.trim().replace(/^["']|["']$/gu, ""))) continue;
            const source = font.style.getPropertyValue("src");
            const pattern = /url\(["']?([^"')]+)["']?\)/gu;
            const matches = Array.from(source.matchAll(pattern));
            const assets = await Promise.all(matches.map(match => inlineImage(new URL(match[1], sheet.href || document.baseURI).href)));
            let cursor = 0;
            const inline = source.replace(pattern, () => `url("${assets[cursor++]}")`);
            embeddedFonts.push(`@font-face{font-family:${font.style.fontFamily};font-style:${font.style.fontStyle || "normal"};font-weight:${font.style.fontWeight || "normal"};src:${inline}}`);
          }
        }
      }
      for (const sheet of document.styleSheets) await copyFontRules(sheet);
      clone.querySelectorAll("script,style,link,meta,base,iframe,object,embed,[data-babel-html-bridge]").forEach(element => element.remove());
      if (embeddedFonts.length) {
        const fonts = document.createElement("style"); fonts.textContent = embeddedFonts.join("\n"); clone.prepend(fonts);
      }
      clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      clone.style.margin = "0"; clone.style.zoom = String(scale);
      const serialized = new XMLSerializer().serializeToString(clone);
      if (serialized.length > 16 * 1024 * 1024) throw new Error("This region exceeds the image capture size limit.");
      const width = Math.ceil(rect.width); const height = Math.ceil(rect.height);
      const totalWidth = Math.max(document.documentElement.scrollWidth, window.innerWidth);
      const totalHeight = Math.max(document.documentElement.scrollHeight, window.innerHeight);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${rect.left + window.scrollX} ${rect.top + window.scrollY} ${width} ${height}"><foreignObject x="0" y="0" width="${totalWidth}" height="${totalHeight}">${serialized}</foreignObject></svg>`;
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("The browser could not render this capture.")); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; });
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image capture is unavailable in this browser.");
      const background = getComputedStyle(document.body).backgroundColor;
      context.fillStyle = !background || background === "rgba(0, 0, 0, 0)" ? "#ffffff" : background; context.fillRect(0, 0, width, height); context.drawImage(image, 0, 0);
      const imageDataUrl = canvas.toDataURL("image/png");
      if (imageDataUrl.length > 14 * 1024 * 1024) throw new Error("The capture exceeds 10 MiB. Choose a smaller region.");
      emit({ kind: "selection", selection: { text: "", prefix: "", suffix: "", occurrence: 0, section, imageDataUrl } });
    } catch (error) { notice(error instanceof Error ? error.message : "This area could not be captured. Select text instead.", true); }
    finally { captureAbort?.abort(); captureAbort = null; captureAssets.clear(); capturePending = false; }
  }
  function startCapture() {
    stopCapture();
    if (!document.body) return;
    emit({ kind: "selection", selection: null });
    captureLayer = document.createElement("div"); captureLayer.setAttribute("data-babel-html-bridge", "");
    captureLayer.style.cssText = "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(45,120,175,.06);touch-action:none";
    captureBox = document.createElement("div"); captureBox.setAttribute("data-babel-html-bridge", "");
    captureBox.style.cssText = "position:fixed;border:2px solid #2d78af;background:rgba(45,120,175,.12);pointer-events:none;z-index:2147483647";
    captureLayer.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault(); captureStart = { x: event.clientX, y: event.clientY }; captureLayer?.setPointerCapture(event.pointerId);
    });
    captureLayer.addEventListener("pointermove", event => {
      if (!captureStart || !captureBox) return;
      const left = Math.min(captureStart.x, event.clientX); const top = Math.min(captureStart.y, event.clientY);
      captureBox.style.left = `${left}px`; captureBox.style.top = `${top}px`; captureBox.style.width = `${Math.abs(event.clientX - captureStart.x)}px`; captureBox.style.height = `${Math.abs(event.clientY - captureStart.y)}px`;
    });
    captureLayer.addEventListener("pointerup", event => {
      if (!captureStart) return;
      const rect = { left: Math.max(0, Math.min(captureStart.x, event.clientX)), top: Math.max(0, Math.min(captureStart.y, event.clientY)),
        width: Math.abs(event.clientX - captureStart.x), height: Math.abs(event.clientY - captureStart.y) };
      stopCapture(); void capture(rect);
    });
    document.body.appendChild(captureLayer); document.body.appendChild(captureBox);
    emit({ kind: "capture-state", active: true });
    notice("Drag over the area to capture. Press Escape to cancel.");
  }
  function onCommand(event: MessageEvent<unknown>) {
    const value = event.data;
    if (!value || typeof value !== "object") return;
    const command = value as HtmlBridgeCommand;
    switch (command.kind) {
      case "restore":
        if (!command.progress || !Number.isFinite(command.progress.position) || !Number.isFinite(command.progress.scale)) return;
        // Local images and styles may still change the document height after DOMContentLoaded.
        if (document.readyState !== "complete") pendingRestore = command.progress;
        else restoreProgress(command.progress);
        break;
      case "annotations":
        if (!Array.isArray(command.annotations) || command.annotations.length > 10_000) return;
        currentAnnotations = command.annotations.filter(annotation => annotation && typeof annotation.text === "string" && annotation.text.length <= 20_000 && typeof annotation.prefix === "string" && typeof annotation.suffix === "string" && /^#[\da-f]{6}$/iu.test(annotation.color) && ["highlight", "underline", "comment"].includes(annotation.type));
        paintAnnotations(); break;
      case "find": if (typeof command.query === "string") find(command.query, command.direction); break;
      case "scroll": if (typeof command.headingId === "string") headingElements.get(command.headingId)?.scrollIntoView({ block: "start", behavior: "auto" }); break;
      case "fragment": if (typeof command.hash === "string") scrollToFragment(command.hash); break;
      case "reveal": {
        if (!command.annotation || typeof command.annotation.text !== "string") return;
        const index = textIndex(); const located = locateQuote(index.text, command.annotation);
        const range = located ? indexedRange(index, located.start, located.end) : null;
        if (!range) { notice("This annotation could not be located in the visible content. Expand its section and retry.", true); break; }
        nativeScroll({ top: Math.max(0, window.scrollY + range.getBoundingClientRect().top - window.innerHeight * .3), behavior: "auto" }); break;
      }
      case "capture": if (command.active === true) startCapture(); else stopCapture(); break;
    }
  }
  function ready() {
    loaded = true;
    if (document.body && !overlay.isConnected) document.body.appendChild(overlay);
    rebuildHeadings(); paintAnnotations();
    emit({ kind: "ready", title: document.title.trim().slice(0, 240), headings: headingsList });
  }
  window.addEventListener("message", event => {
    const data = event.data as { v?: unknown; kind?: unknown; channelId?: unknown; documentId?: unknown } | null;
    if (event.source !== window.parent || !data || data.v !== 1 || data.kind !== "html-connect" || data.channelId !== configuration.channelId || data.documentId !== configuration.documentId || !event.ports[0] || port) return;
    event.stopImmediatePropagation();
    port = event.ports[0]; port.onmessage = onCommand; port.start();
    clearInterval(handshakeTimer);
    if (document.readyState !== "loading") ready();
  }, true);
  let attempts = 0;
  const announce = () => { if (!port && attempts++ < 40) notifyParent({ v: 1, kind: "html-ready", channelId: configuration.channelId, documentId: configuration.documentId }, "*"); else clearInterval(handshakeTimer); };
  const handshakeTimer = window.setInterval(announce, 250);
  announce();
  document.addEventListener("DOMContentLoaded", ready, { once: true });
  window.addEventListener("load", () => {
    if (pendingRestore) { const progress = pendingRestore; pendingRestore = null; restoreProgress(progress); }
    if (port) { rebuildHeadings(); paintAnnotations(); }
  }, { once: true });
  document.addEventListener("selectionchange", () => { clearTimeout(selectionTimer); selectionTimer = window.setTimeout(publishSelection, 80); });
  window.addEventListener("scroll", () => { clearTimeout(progressTimer); progressTimer = window.setTimeout(() => { emitProgress(); if (!highlightRegistry) paintAnnotations(); }, 150); }, { passive: true });
  window.addEventListener("resize", () => { if (loaded) { rebuildHeadings(); paintAnnotations(); emitProgress(); } });
  document.addEventListener("visibilitychange", () => { if (loaded && document.visibilityState === "visible") { rebuildHeadings(); paintAnnotations(); } });
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && captureLayer) { event.preventDefault(); stopCapture(); }
    else if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "f") { event.preventDefault(); emit({ kind: "focus-find" }); }
  }, true);
  window.addEventListener("submit", event => { event.preventDefault(); }, true);
  window.addEventListener("click", event => {
    const element = event.target instanceof Element ? event.target.closest("a[href],area[href]") : null;
    if (!element) return;
    const href = element.getAttribute("href") ?? "";
    if (/^javascript:/iu.test(href)) return;
    event.preventDefault();
    if (href.startsWith("#")) {
      scrollToFragment(href);
    } else {
      try {
        const destination = new URL(href, document.baseURI);
        if (destination.href.startsWith(base.href) && /\.html?$/iu.test(destination.pathname)) {
          const path = decodeURIComponent(destination.pathname.slice(base.pathname.length));
          if (path === configuration.entryPath) {
            if (destination.hash) scrollToFragment(destination.hash);
            else nativeScroll({ top: 0, behavior: "auto" });
          } else emit({ kind: "navigate", path, hash: destination.hash });
          return;
        }
      } catch { /* Invalid source link stays inside the offline boundary. */ }
      notice("Links outside the imported HTML documents stay closed in the offline reader.");
    }
  }, true);
  window.addEventListener("securitypolicyviolation", event => {
    if (event.blockedURI && event.blockedURI !== "inline" && event.blockedURI !== "eval") notice("Offline mode blocked an external resource or navigation. Include required resources in the imported folder.");
  });
  new MutationObserver(records => {
    if (!loaded || records.every(record => (record.target instanceof Element ? record.target : record.target.parentElement)?.closest(ownSelector))) return;
    clearTimeout(updateTimer); updateTimer = window.setTimeout(() => { rebuildHeadings(); paintAnnotations(); findRanges = []; }, 250);
  }).observe(document.documentElement, { childList: true, characterData: true, attributes: true, attributeFilter: ["open", "hidden", "class", "style"], subtree: true });
}

export function htmlBridgeSource(configuration: HtmlBridgeConfiguration): string {
  const serialized = JSON.stringify(configuration).replace(/</gu, "\\u003c").replace(/\u2028/gu, "\\u2028").replace(/\u2029/gu, "\\u2029");
  return `(()=>{const __name=(value)=>value;(${installHtmlBridge.toString()})(${serialized},${locateHtmlQuote.toString()});})();`;
}
