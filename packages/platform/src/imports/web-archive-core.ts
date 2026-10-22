export const WEB_ARCHIVE_MAX_BYTES = 150 * 1024 * 1024;
export const WEB_ARCHIVE_MAX_MARKDOWN_BYTES = 10 * 1024 * 1024;
export const WEB_ARCHIVE_MAX_ASSETS = 50;
export const WEB_ARCHIVE_MAX_ASSET_BYTES = 10 * 1024 * 1024;
export const WEB_ARCHIVE_MAX_TOTAL_ASSET_BYTES = 100 * 1024 * 1024;
export const WEB_ARCHIVE_MAX_NODES = 30_000;
export const WEB_ARCHIVE_MAX_DEPTH = 80;

export interface WebArchiveAsset {
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  dataBase64: string;
}

export interface WebSnapshotNode {
  tag: string;
  attrs?: Record<string, string>;
  style?: Record<string, string>;
  children?: Array<WebSnapshotNode | string>;
}

export interface WebArchive {
  format: "babel.web-archive";
  version: 1;
  title: string;
  markdown: string;
  source?: { url?: string; title?: string; capturedAt?: string };
  assets: WebArchiveAsset[];
  snapshot: { tree: WebSnapshotNode; width: number; background: string };
  warnings: string[];
}

export const WEB_ARCHIVE_ALLOWED_TAGS = [
  "article", "section", "div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "pre", "code", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  "colgroup", "col", "figure", "figcaption", "img", "br", "hr", "ul", "ol", "li",
  "dl", "dt", "dd", "strong", "em", "b", "i", "u", "s", "del", "ins", "mark",
  "small", "sub", "sup", "a", "details", "summary", "header", "footer", "main",
  "aside", "nav", "blockquote", "time", "abbr", "kbd", "samp", "var", "q", "cite",
  "address", "hgroup", "ruby", "rb", "rt", "rp", "rtc",
] as const;

export const WEB_ARCHIVE_ALLOWED_ATTRIBUTES = [
  "id", "class", "title", "alt", "role", "aria-label", "aria-hidden",
  "aria-describedby", "aria-labelledby", "dir", "lang", "width", "height",
  "colspan", "rowspan", "scope", "start", "reversed", "type", "open", "datetime",
  "href", "src", "data-role", "data-language",
] as const;

export const WEB_ARCHIVE_ALLOWED_STYLES = [
  "display", "visibility", "box-sizing", "position", "top", "right", "bottom", "left", "z-index",
  "width", "min-width", "max-width", "height", "min-height", "max-height", "aspect-ratio",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "margin-block", "margin-block-start", "margin-block-end", "margin-inline", "margin-inline-start", "margin-inline-end",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "padding-block", "padding-block-start", "padding-block-end", "padding-inline", "padding-inline-start", "padding-inline-end",
  "color", "background-color", "opacity", "font-family", "font-size", "font-weight", "font-style",
  "font-variant", "font-variant-numeric", "font-stretch", "line-height", "letter-spacing", "word-spacing",
  "text-align", "text-align-last", "text-indent", "text-transform", "text-decoration", "text-decoration-line",
  "text-decoration-color", "text-decoration-style", "text-decoration-thickness", "text-underline-offset", "text-shadow",
  "white-space", "overflow-wrap", "word-break", "hyphens", "tab-size", "vertical-align", "direction", "unicode-bidi",
  "border", "border-width", "border-style", "border-color", "border-top", "border-right", "border-bottom", "border-left",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "border-radius", "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
  "border-collapse", "border-spacing", "box-shadow", "outline", "outline-width", "outline-style", "outline-color", "outline-offset",
  "overflow", "overflow-x", "overflow-y", "text-overflow", "object-fit", "object-position",
  "flex", "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "order",
  "align-items", "align-self", "align-content", "justify-content", "justify-items", "justify-self", "place-items", "place-content", "place-self",
  "gap", "row-gap", "column-gap", "grid-template-columns", "grid-template-rows", "grid-template-areas",
  "grid-auto-columns", "grid-auto-rows", "grid-auto-flow", "grid-column", "grid-row", "grid-column-start", "grid-column-end", "grid-row-start", "grid-row-end", "grid-area",
  "transform", "transform-origin", "transform-style", "perspective", "perspective-origin", "backface-visibility",
  "list-style-type", "list-style-position", "table-layout", "caption-side", "empty-cells", "float", "clear", "isolation",
] as const;

const resourcePolicy = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
export const WEB_ARCHIVE_CONTENT_SECURITY_POLICY = `${resourcePolicy}; frame-ancestors 'self'; sandbox`;

const tags = new Set<string>(WEB_ARCHIVE_ALLOWED_TAGS);
const attributes = new Set<string>(WEB_ARCHIVE_ALLOWED_ATTRIBUTES);
const styles = new Set<string>(WEB_ARCHIVE_ALLOWED_STYLES);
const voidTags = new Set(["img", "br", "hr", "col"]);
const assetId = /^[A-Za-z0-9_-]{1,80}$/u;
const assetMimes = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" } as const;
const encoder = new TextEncoder();

export class WebArchiveError extends Error {
  readonly code = "INVALID_WEB_ARCHIVE";
  readonly status = 422;
  constructor(message: string) { super(message); this.name = "WebArchiveError"; }
}

/** Validate and copy a portable archive; the result contains no original HTML. */
export function validateWebArchive(value: unknown): WebArchive {
  const archive = record(value, "archive", ["format", "version", "title", "markdown", "source", "assets", "snapshot", "warnings"]);
  if (archive.format !== "babel.web-archive" || archive.version !== 1) invalid("Use a Babel web archive with format babel.web-archive and version 1.");
  const title = text(archive.title, "title", 1_000);
  if (!title.trim()) invalid("The archive title is empty.");
  const markdown = text(archive.markdown, "Markdown", WEB_ARCHIVE_MAX_MARKDOWN_BYTES);
  if (encoder.encode(markdown).byteLength > WEB_ARCHIVE_MAX_MARKDOWN_BYTES) invalid("Archive Markdown exceeds 10 MiB. Export a smaller selection.");
  if (!Array.isArray(archive.assets) || archive.assets.length > WEB_ARCHIVE_MAX_ASSETS) invalid("An archive can contain at most 50 assets.");
  const ids = new Set<string>();
  const names = new Set<string>();
  let totalBytes = 0;
  const assets = Array.from(archive.assets, (value: unknown) => {
    const item = record(value, "asset", ["id", "name", "mimeType", "dataBase64"]);
    if (typeof item.id !== "string" || !assetId.test(item.id)) invalid("An asset has an invalid id.");
    if (typeof item.name !== "string" || !item.name || /[\\/\u0000-\u001f\u007f]/u.test(item.name) || item.name.length > 120) invalid("Asset names must be safe basenames of at most 120 characters.");
    const extension = /\.([a-z]+)$/iu.exec(item.name)?.[1].toLowerCase();
    if (!extension || !(extension in assetMimes) || assetMimes[extension as keyof typeof assetMimes] !== item.mimeType) invalid("Asset filename and raster MIME type must match.");
    if (ids.has(item.id) || names.has(item.name.toLowerCase())) invalid("Asset ids and names must be unique.");
    ids.add(item.id); names.add(item.name.toLowerCase());
    const asset = { id: item.id, name: item.name, mimeType: item.mimeType, dataBase64: item.dataBase64 } as WebArchiveAsset;
    totalBytes += decodeWebArchiveAsset(asset).byteLength;
    if (totalBytes > WEB_ARCHIVE_MAX_TOTAL_ASSET_BYTES) invalid("Decoded archive assets exceed 100 MiB. Export a smaller selection.");
    return asset;
  });
  const snapshot = record(archive.snapshot, "snapshot", ["tree", "width", "background"]);
  if (typeof snapshot.width !== "number" || !Number.isFinite(snapshot.width) || snapshot.width <= 0 || snapshot.width > 100_000) invalid("The snapshot width must be a positive, finite layout width.");
  const background = text(snapshot.background, "snapshot background", 1_000);
  if (!safeStyleValue(background) || !/^(?:[a-z]+|#[a-f0-9]{3,8}|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([a-z0-9.,%+\- /]*\))$/iu.test(background)) invalid("The snapshot background must be a static color.");
  const state = { count: 0, ids };
  const tree = validateNode(snapshot.tree, 1, state);
  if (!Array.isArray(archive.warnings) || archive.warnings.length > 1_000) invalid("The archive warnings are invalid.");
  const warnings = Array.from(archive.warnings, (warning: unknown) => text(warning, "warning", 10_000));
  let source: WebArchive["source"];
  if (archive.source !== undefined) {
    const input = record(archive.source, "source", ["url", "title", "capturedAt"]);
    source = {};
    if (input.url !== undefined) {
      source.url = text(input.url, "source URL", 8_192);
      let url: URL;
      try { url = new URL(source.url); } catch { invalid("The source URL is invalid."); }
      if (!["http:", "https:"].includes(url!.protocol) || url!.username || url!.password) invalid("The source URL must be HTTP or HTTPS without credentials.");
    }
    if (input.title !== undefined) source.title = text(input.title, "source title", 10_000);
    if (input.capturedAt !== undefined) {
      source.capturedAt = text(input.capturedAt, "capture time", 100);
      if (!Number.isFinite(Date.parse(source.capturedAt))) invalid("The capture time is invalid.");
    }
  }
  const result: WebArchive = {
    format: "babel.web-archive", version: 1, title, markdown,
    ...(source === undefined ? {} : { source }), assets,
    snapshot: { tree, width: snapshot.width, background }, warnings,
  };
  assertWireSize(result);
  assertSnapshotSize(result);
  return result;
}

/** Fatal UTF-8 and size checks apply before parsing any untrusted JSON. */
export function parseWebArchive(bytes: Uint8Array): WebArchive {
  if (bytes.byteLength > WEB_ARCHIVE_MAX_BYTES) invalid("The archive exceeds the 150 MiB file limit. Export a smaller selection.");
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { invalid("Choose a valid UTF-8 Babel archive JSON file."); }
  return validateWebArchive(value);
}

/** Strict base64 and raster signatures, shared by browser and server callers. */
export function decodeWebArchiveAsset(asset: WebArchiveAsset): Uint8Array {
  const encoded = asset.dataBase64;
  if (typeof encoded !== "string" || !encoded || encoded.length > Math.ceil(WEB_ARCHIVE_MAX_ASSET_BYTES / 3) * 4 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) invalid("Asset data must be strict base64 within the 10 MiB asset limit.");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if ((encoded.endsWith("==") && (alphabet.indexOf(encoded.at(-3)!) & 15) !== 0) || (encoded.endsWith("=") && !encoded.endsWith("==") && (alphabet.indexOf(encoded.at(-2)!) & 3) !== 0)) invalid("Asset base64 padding is not canonical.");
  let decoded: string;
  try { decoded = atob(encoded); } catch { invalid("Asset data is not valid base64."); }
  if (decoded!.length > WEB_ARCHIVE_MAX_ASSET_BYTES) invalid("An archive asset exceeds 10 MiB. Export a smaller selection.");
  const bytes = new Uint8Array(decoded!.length);
  for (let index = 0; index < bytes.length; index++) bytes[index] = decoded!.charCodeAt(index);
  const starts = (signature: readonly number[]) => signature.every((byte, index) => bytes[index] === byte);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  const matches = asset.mimeType === "image/png" ? bytes.length >= 24 && starts([137, 80, 78, 71, 13, 10, 26, 10]) && ascii(12, 16) === "IHDR"
    : asset.mimeType === "image/jpeg" ? bytes.length >= 4 && starts([255, 216, 255])
    : asset.mimeType === "image/gif" ? bytes.length >= 13 && ["GIF87a", "GIF89a"].includes(ascii(0, 6))
    : asset.mimeType === "image/webp" ? bytes.length >= 16 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(ascii(12, 16)) : false;
  if (!matches) invalid("An asset does not match its declared PNG, JPEG, WebP, or GIF raster type.");
  return bytes;
}

/** Generate HTML only from the validated static tree, never imported markup. */
export function renderWebArchiveSnapshot(input: WebArchive): string {
  const archive = validateWebArchive(input);
  const assets = new Map(archive.assets.map((asset) => [asset.id, `data:${asset.mimeType};base64,${asset.dataBase64}`]));
  const [prefix, suffix] = snapshotShell(archive);
  const parts = [prefix];
  function render(node: WebSnapshotNode | string): void {
    if (typeof node === "string") { parts.push(escapeHtml(node)); return; }
    const attrs = Object.entries(node.attrs ?? {}).map(([key, value]) => {
      const resolved = key === "src" ? assets.get(value.slice("babel-asset://".length))! : value;
      return ` ${key}="${escapeHtml(resolved)}"`;
    }).join("");
    const declarations = Object.entries(node.style ?? {}).map(([key, value]) => `${key}:${value}`).join(";");
    const style = declarations ? ` style="${escapeHtml(declarations)}"` : "";
    parts.push(`<${node.tag}${attrs}${style}>`);
    if (!voidTags.has(node.tag)) {
      for (const child of node.children ?? []) render(child);
      parts.push(`</${node.tag}>`);
    }
  }
  render(archive.snapshot.tree);
  parts.push(suffix);
  return parts.join("");
}

function snapshotShell(archive: WebArchive): [string, string] {
  return [
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(resourcePolicy)}"><title>${escapeHtml(archive.title)}</title></head><body style="margin:0;background-color:${escapeHtml(archive.snapshot.background)}"><main style="width:${archive.snapshot.width}px;max-width:100%;margin:0 auto">`,
    "</main></body></html>",
  ];
}

/** Data URLs may repeat in the tree; bound rendered expansion before allocating it. */
function assertSnapshotSize(archive: WebArchive): void {
  let bytes = encoder.encode(snapshotShell(archive).join("")).byteLength;
  const assetLengths = new Map(archive.assets.map(asset => [asset.id, `data:${asset.mimeType};base64,`.length + asset.dataBase64.length]));
  const add = (count: number) => {
    bytes += count;
    if (bytes > WEB_ARCHIVE_MAX_BYTES) invalid("The rendered snapshot exceeds 150 MiB. Export a smaller selection.");
  };
  function escaped(value: string): void {
    for (let index = 0; index < value.length; index++) {
      const character = value.charCodeAt(index);
      if (character === 38 || character === 39) add(5);
      else if (character === 60 || character === 62) add(4);
      else if (character === 34) add(6);
      else if (character < 128) add(1);
      else if (character < 2048) add(2);
      else if (character >= 0xd800 && character <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { add(4); index++; }
      else add(3);
    }
  }
  function visit(node: WebSnapshotNode | string): void {
    if (typeof node === "string") { escaped(node); return; }
    add(node.tag.length + 2 + (voidTags.has(node.tag) ? 0 : node.tag.length + 3));
    for (const [key, value] of Object.entries(node.attrs ?? {})) {
      add(key.length + 4);
      if (key === "src") add(assetLengths.get(value.slice("babel-asset://".length))!);
      else escaped(value);
    }
    const styles = Object.entries(node.style ?? {});
    if (styles.length) {
      add(9 + styles.length - 1);
      for (const [key, value] of styles) { add(key.length + 1); escaped(value); }
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(archive.snapshot.tree);
}

function validateNode(value: unknown, depth: number, state: { count: number; ids: Set<string> }): WebSnapshotNode {
  if (depth > WEB_ARCHIVE_MAX_DEPTH || ++state.count > WEB_ARCHIVE_MAX_NODES) invalid("The snapshot exceeds 30,000 nodes or depth 80. Export a smaller selection.");
  const input = record(value, "snapshot node", ["tag", "attrs", "style", "children"]);
  if (typeof input.tag !== "string" || !tags.has(input.tag)) invalid("The snapshot contains an unsupported or active HTML tag.");
  let attrs: Record<string, string> | undefined;
  if (input.attrs !== undefined) {
    const values = record(input.attrs, "snapshot attributes", WEB_ARCHIVE_ALLOWED_ATTRIBUTES);
    attrs = {};
    for (const [key, unknown] of Object.entries(values)) {
      if (!attributes.has(key)) invalid("The snapshot contains an unsupported HTML attribute.");
      const value = text(unknown, "attribute", 10_000);
      if (/[\u0000-\u001f\u007f]/u.test(value)) invalid("Snapshot attributes cannot contain control characters.");
      if (key === "src") {
        if (input.tag !== "img" || !value.startsWith("babel-asset://") || !state.ids.has(value.slice("babel-asset://".length))) invalid("Snapshot images must reference an included, validated asset.");
      }
      if (key === "href" && (input.tag !== "a" || !/^#[^\s<>"'`]*$/u.test(value))) invalid("Snapshot links may only navigate to a fragment inside the static snapshot.");
      attrs[key] = value;
    }
  }
  if (input.tag === "img" && attrs?.src === undefined) invalid("Every snapshot image must reference an included asset.");
  let style: Record<string, string> | undefined;
  if (input.style !== undefined) {
    const values = record(input.style, "snapshot styles", WEB_ARCHIVE_ALLOWED_STYLES);
    style = {};
    for (const [key, unknown] of Object.entries(values)) {
      const value = text(unknown, "style value", 1_000);
      if (!styles.has(key) || !safeStyleValue(value)) invalid("The snapshot contains unsupported or unsafe CSS.");
      style[key] = value;
    }
  }
  let children: Array<WebSnapshotNode | string> | undefined;
  if (input.children !== undefined) {
    if (!Array.isArray(input.children) || input.children.length > WEB_ARCHIVE_MAX_NODES || (voidTags.has(input.tag) && input.children.length > 0) || (depth === WEB_ARCHIVE_MAX_DEPTH && input.children.length > 0)) invalid("The snapshot has invalid or excessive child nodes or exceeds depth 80.");
    children = Array.from(input.children, (child: unknown) => {
      if (typeof child !== "string") return validateNode(child, depth + 1, state);
      if (++state.count > WEB_ARCHIVE_MAX_NODES) invalid("The snapshot exceeds 30,000 nodes. Export a smaller selection.");
      return text(child, "snapshot text", WEB_ARCHIVE_MAX_BYTES);
    });
  }
  return { tag: input.tag, ...(attrs ? { attrs } : {}), ...(style ? { style } : {}), ...(children ? { children } : {}) };
}

function safeStyleValue(value: string): boolean {
  return !!value.trim() && !/[\\{};<>\u0000-\u001f\u007f]|\/\*|\*\/|url\s*\(|@|expression\s*\(|javascript\s*:/iu.test(value);
}
function record(value: unknown, name: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(`The ${name} must be an object.`);
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some((key) => !keys.includes(key))) invalid(`The ${name} contains unsupported fields.`);
  return object;
}
function text(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum) invalid(`The ${name} is invalid or exceeds its size limit.`);
  return value;
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
function invalid(message: string): never { throw new WebArchiveError(message); }

/** Count JSON bytes without allocating an escaped copy of large text nodes. */
function assertWireSize(value: unknown): void {
  let bytes = 0;
  const pending: unknown[] = [value];
  while (pending.length) {
    const next = pending.pop();
    if (typeof next === "string") {
      bytes += 2;
      for (let index = 0; index < next.length; index++) {
        const character = next.charCodeAt(index);
        if (character === 34 || character === 92 || [8, 9, 10, 12, 13].includes(character)) bytes += 2;
        else if (character < 32) bytes += 6;
        else if (character < 128) bytes++;
        else if (character < 2048) bytes += 2;
        else if (character >= 0xd800 && character <= 0xdbff && next.charCodeAt(index + 1) >= 0xdc00 && next.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index++; }
        else bytes += character >= 0xd800 && character <= 0xdfff ? 6 : 3;
        if (bytes > WEB_ARCHIVE_MAX_BYTES) invalid("The archive exceeds the 150 MiB file limit. Export a smaller selection.");
      }
    } else if (Array.isArray(next)) {
      bytes += 2 + Math.max(0, next.length - 1);
      for (const entry of next) pending.push(entry);
    } else if (typeof next === "object" && next !== null) {
      const entries = Object.entries(next);
      bytes += 2 + Math.max(0, entries.length - 1) + entries.length;
      for (const [key, entry] of entries) pending.push(key, entry);
    } else bytes += String(next).length;
    if (bytes > WEB_ARCHIVE_MAX_BYTES) invalid("The archive exceeds the 150 MiB file limit. Export a smaller selection.");
  }
}
