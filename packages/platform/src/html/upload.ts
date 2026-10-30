import { createHash } from "node:crypto";
import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../http/errors";
import { HTML_MAX_BUNDLE_BYTES, HTML_MAX_BUNDLE_FILES, normalizeHtmlAssetPath } from "./core";

export interface StoredHtmlFile { path: string; size: number; mimeType: string; index: number; digest: string }
interface ManifestFile { path: string; field: string; index: number }
const manifestLimit = 8 * 1024 * 1024;
const uploadLimit = HTML_MAX_BUNDLE_BYTES + 16 * 1024 * 1024;
const headerLimit = 8 * 1024;

export function htmlResourceMime(filename: string): string {
  const extension = filename.split(".").at(-1)?.toLowerCase() ?? "";
  const types: Record<string, string> = {
    html: "text/plain", htm: "text/plain", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
    json: "application/json", map: "application/json", txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8", xml: "text/plain; charset=utf-8",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml",
    woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", mp4: "video/mp4", webm: "video/webm", ogv: "video/ogg", wasm: "application/wasm",
  };
  return types[extension] ?? "application/octet-stream";
}

/** Count and stream all bytes; formData() would buffer a large directory in memory. */
export async function streamHtmlBundle(request: Request, directory: string): Promise<{ files: StoredHtmlFile[]; size: number; digest: string }> {
  const boundary = readBoundary(request);
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/u.test(declared) && BigInt(declared) > BigInt(uploadLimit)) throw oversized();
  if (!request.body) throw malformed();
  const first = Buffer.from(`--${boundary}\r\n`);
  const marker = Buffer.from(`\r\n--${boundary}`);
  const reader = request.body.getReader();
  const files: StoredHtmlFile[] = [];
  let manifest: ManifestFile[] | undefined;
  let manifestBytes = Buffer.alloc(0);
  let current: ManifestFile | undefined;
  let handle: FileHandle | undefined;
  let fileDigest = createHash("sha256");
  let fileSize = 0;
  let totalSize = 0;
  let received = 0;
  let pending = Buffer.alloc(0);
  let phase: "start" | "headers" | "body" | "end" = "start";
  let part: "manifest" | "file" | undefined;
  const seen = new Set<string>();
  const canceled = () => { void reader.cancel().catch(() => undefined); };
  request.signal.addEventListener("abort", canceled, { once: true });

  async function consume(bytes: Buffer) {
    if (part === "manifest") {
      if (manifestBytes.length + bytes.length > manifestLimit) throw new ApiError(413, "HTML_MANIFEST_TOO_LARGE", "The directory manifest exceeds 8 MiB. Import a smaller folder.");
      manifestBytes = Buffer.concat([manifestBytes, bytes]);
      return;
    }
    if (part !== "file" || !handle) throw malformed();
    totalSize += bytes.length; fileSize += bytes.length;
    if (totalSize > HTML_MAX_BUNDLE_BYTES) throw oversized();
    fileDigest.update(bytes);
    for (let offset = 0; offset < bytes.length;) {
      const written = await handle.write(bytes.subarray(offset));
      if (written.bytesWritten < 1) throw new Error("A resource file could not be written.");
      offset += written.bytesWritten;
    }
  }

  async function completePart() {
    if (part === "manifest") { manifest = parseManifest(manifestBytes); return; }
    if (!handle || !current) throw malformed();
    await handle.sync(); await handle.close(); handle = undefined;
    files.push({ path: current.path, index: current.index, size: fileSize, mimeType: htmlResourceMime(current.path), digest: fileDigest.digest("hex") });
    current = undefined;
  }

  try {
    while (true) {
      if (request.signal.aborted) throw canceledUpload();
      const chunk = await reader.read();
      if (request.signal.aborted) throw canceledUpload();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > uploadLimit) throw oversized();
      pending = Buffer.concat([pending, chunk.value]);
      while (true) {
        if (phase === "start") {
          if (pending.length < first.length) break;
          if (!pending.subarray(0, first.length).equals(first)) throw malformed();
          pending = pending.subarray(first.length); phase = "headers";
        } else if (phase === "headers") {
          const end = pending.indexOf("\r\n\r\n");
          if (end < 0) { if (pending.length > headerLimit) throw malformed(); break; }
          if (end > headerLimit) throw malformed();
          const header = readPartHeaders(pending.subarray(0, end).toString("utf8"));
          if (!manifest) {
            if (part || manifestBytes.length || header.name !== "manifest" || header.fileName !== undefined) throw malformed();
            part = "manifest";
          } else {
            current = manifest.find((entry) => entry.field === header.name);
            if (!current || seen.has(current.field) || header.fileName === undefined || !validBasename(header.fileName) ||
              header.fileName.normalize("NFC") !== current.path.split("/").at(-1)) throw malformed();
            seen.add(current.field);
            handle = await open(path.join(directory, String(current.index)), "wx");
            fileDigest = createHash("sha256"); fileSize = 0; part = "file";
          }
          pending = pending.subarray(end + 4); phase = "body";
        } else if (phase === "body") {
          let end = pending.indexOf(marker);
          while (end >= 0 && pending.length >= end + marker.length + 2) {
            const suffix = pending.subarray(end + marker.length, end + marker.length + 2).toString("ascii");
            if (suffix === "--" || suffix === "\r\n") break;
            end = pending.indexOf(marker, end + marker.length);
          }
          if (end >= 0 && pending.length >= end + marker.length + 2) {
            await consume(pending.subarray(0, end)); await completePart();
            const last = pending.subarray(end + marker.length, end + marker.length + 2).toString("ascii") === "--";
            pending = pending.subarray(end + marker.length + 2); phase = last ? "end" : "headers"; part = undefined;
          } else {
            const retain = marker.length + 2;
            if (pending.length > retain) { await consume(pending.subarray(0, pending.length - retain)); pending = pending.subarray(pending.length - retain); }
            break;
          }
        } else {
          if (pending.length > 2 || (pending.length === 2 && !pending.equals(Buffer.from("\r\n")))) throw malformed();
          break;
        }
      }
    }
    if (phase !== "end" || (pending.length !== 0 && !pending.equals(Buffer.from("\r\n"))) || !manifest || seen.size !== manifest.length) throw malformed();
    if (!files.some((file) => /\.html?$/iu.test(file.path) && file.size > 0)) throw new ApiError(400, "EMPTY_HTML", "Choose at least one nonempty HTML file.");
    const canonical = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
      .map(({ path, size, mimeType, digest }) => ({ path, size, mimeType, digest }));
    return { files: files.sort((a, b) => a.index - b.index), size: totalSize, digest: createHash("sha256").update(JSON.stringify(canonical)).digest("hex") };
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (request.signal.aborted) throw canceledUpload();
    throw error;
  } finally {
    request.signal.removeEventListener("abort", canceled); reader.releaseLock(); await handle?.close();
  }
}

function parseManifest(bytes: Buffer): ManifestFile[] {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw malformed(); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => key !== "files")) throw malformed();
  const input = (value as { files?: unknown }).files;
  if (!Array.isArray(input) || input.length < 1 || input.length > HTML_MAX_BUNDLE_FILES) throw new ApiError(400, "INVALID_HTML_MANIFEST", "Choose a folder containing HTML and no more than 5,000 files.");
  const paths = new Set<string>(); const fields = new Set<string>();
  const files = input.map((entry: unknown, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some((key) => key !== "path" && key !== "field")) throw malformed();
    const item = entry as { path?: unknown; field?: unknown };
    const filename = normalizeHtmlAssetPath(item.path);
    if (filename === null || typeof item.field !== "string" || !/^[A-Za-z0-9_-]{1,80}$/u.test(item.field) || item.field === "manifest") throw malformed();
    const key = filename.toLowerCase();
    if (paths.has(key) || fields.has(item.field)) throw new ApiError(400, "INVALID_HTML_MANIFEST", "Each resource must have a unique path and upload field.");
    paths.add(key); fields.add(item.field);
    return { path: filename, field: item.field, index };
  });
  if (!files.some((file) => /\.html?$/iu.test(file.path))) throw new ApiError(400, "NO_HTML_FILES", "No .html or .htm files were found in this selection.");
  return files;
}

function readBoundary(request: Request): string {
  const match = /^multipart\/form-data\s*;\s*boundary=(?:"([^"\r\n]+)"|([^;\s]+))\s*$/iu.exec(request.headers.get("content-type") ?? "");
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || boundary.length > 70 || !/^[A-Za-z0-9'()+_,./:=? -]+$/u.test(boundary) || boundary.endsWith(" ")) throw malformed();
  return boundary;
}
function readPartHeaders(headers: string): { name: string; fileName?: string } {
  let disposition: string | undefined;
  for (const line of headers.split("\r\n")) {
    const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*(.*)$/u.exec(line);
    if (!match) throw malformed();
    if (match[1].toLowerCase() === "content-disposition") { if (disposition !== undefined) throw malformed(); disposition = match[2]; }
  }
  if (!disposition || !/^form-data\s*;/iu.test(disposition)) throw malformed();
  const name = /(?:^|;)\s*name="([^"\r\n]*)"/iu.exec(disposition)?.[1];
  const fileName = /(?:^|;)\s*filename="([^"\r\n]*)"/iu.exec(disposition)?.[1];
  if (!name) throw malformed();
  return { name, ...(fileName === undefined ? {} : { fileName }) };
}
function validBasename(value: string): boolean { return value.length > 0 && value.length <= 1_024 && value !== "." && value !== ".." && !/[\\/\u0000-\u001f\u007f-\u009f]/u.test(value); }
function malformed(): ApiError { return new ApiError(400, "INVALID_HTML_UPLOAD", "Upload a manifest first, followed by each declared resource using its assigned field and basename."); }
function oversized(): ApiError { return new ApiError(413, "HTML_BUNDLE_TOO_LARGE", "An HTML import and its resources must not exceed 512 MiB. Choose a smaller folder."); }
function canceledUpload(): ApiError { return new ApiError(499, "HTML_UPLOAD_CANCELED", "The HTML import was canceled."); }
