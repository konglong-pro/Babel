import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import Database from "better-sqlite3";

import { ApiError } from "../http/errors";
import { assertOnlyFields, assertSameOrigin } from "../http/request";
import {
  isPdfAnnotations,
  isPdfProgress,
  PDF_MAX_FILE_BYTES,
  PDF_TITLE_MAX_LENGTH,
  type PdfDocument,
  type PdfDocumentSummary,
  type PdfProgress,
} from "./core";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const multipartOverheadLimit = 64 * 1024;
const jsonBodyLimit = 4 * 1024 * 1024;
const headerLimit = 8 * 1024;
const noStore = { "Cache-Control": "private, no-store" };

interface DocumentRow {
  id: string;
  title: string;
  file_name: string;
  size: number;
  imported_at: string;
  updated_at: string;
  page: number;
  scale: number;
  rotation: PdfProgress["rotation"];
  progress_revision: number;
  annotations_revision: number;
  annotations: string;
}
type SummaryRow = Omit<DocumentRow, "annotations">;
const summaryColumns = "id, title, file_name, size, imported_at, updated_at, page, scale, rotation, progress_revision, annotations_revision";

export interface PdfLibraryOptions {
  /** An app-owned private uploads/pdf-library directory, never the public repository. */
  root: () => string;
}

export function createPdfLibraryHandlers(options: PdfLibraryOptions) {
  const root = () => path.resolve(/* turbopackIgnore: true */ options.root());

  async function database<T>(operation: (db: Database.Database) => T): Promise<T> {
    const directory = root();
    await mkdir(directory, { recursive: true });
    let db: Database.Database | undefined;
    try {
      db = new Database(path.join(directory, "metadata.sqlite"));
      db.pragma("busy_timeout = 5000");
      // data:backup commits the entire private uploads tree after stopping apps.
      // DELETE journaling plus closing every connection keeps all durable state
      // in metadata.sqlite; this library never depends on untracked WAL sidecars.
      db.pragma("journal_mode = DELETE");
      db.pragma("synchronous = FULL");
      db.exec(`CREATE TABLE IF NOT EXISTS pdf_documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        file_name TEXT NOT NULL,
        size INTEGER NOT NULL,
        imported_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        page INTEGER NOT NULL DEFAULT 1,
        scale REAL NOT NULL DEFAULT 1,
        rotation INTEGER NOT NULL DEFAULT 0,
        progress_revision INTEGER NOT NULL DEFAULT 0,
        annotations_revision INTEGER NOT NULL DEFAULT 0,
        annotations TEXT NOT NULL DEFAULT '[]'
      )`);
      return operation(db);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, "PDF_LIBRARY_UNAVAILABLE", "The PDF library could not be opened or saved. Check available disk space and retry.");
    } finally {
      db?.close();
    }
  }

  function row(db: Database.Database, id: string): DocumentRow {
    if (!idPattern.test(id)) throw notFound();
    const result = db.prepare("SELECT * FROM pdf_documents WHERE id = ?").get(id) as DocumentRow | undefined;
    if (!result) throw notFound();
    return result;
  }

  function summaryRow(db: Database.Database, id: string): SummaryRow {
    const result = db.prepare(`SELECT ${summaryColumns} FROM pdf_documents WHERE id = ?`).get(id) as SummaryRow | undefined;
    if (!result) throw notFound();
    return result;
  }

  return {
    async list(): Promise<Response> {
      const documents = await database((db) => (db.prepare(`SELECT ${summaryColumns} FROM pdf_documents ORDER BY imported_at DESC, id DESC`).all() as SummaryRow[]).map(toSummary));
      return Response.json({ documents }, { headers: noStore });
    },

    async importPdf(request: Request): Promise<Response> {
      assertSameOrigin(request);
      const boundary = readBoundary(request);
      assertDeclaredSize(request, PDF_MAX_FILE_BYTES + multipartOverheadLimit);
      const directory = path.join(root(), "files");
      await mkdir(directory, { recursive: true });
      const id = randomUUID();
      const temporary = path.join(directory, `.pending-${id}.tmp`);
      const destination = path.join(directory, `${id}.pdf`);
      let staged = false;
      try {
        const uploaded = await streamMultipart(request, boundary, temporary);
        await rename(temporary, destination);
        staged = true;
        const timestamp = new Date().toISOString();
        const document = await database((db) => db.transaction(() => {
          db.prepare(`INSERT INTO pdf_documents (id, title, file_name, size, imported_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`).run(id, uploaded.title, uploaded.fileName, uploaded.size, timestamp, timestamp);
          return toDocument(row(db, id));
        })());
        staged = false;
        return Response.json({ document }, { status: 201, headers: noStore });
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(503, "PDF_LIBRARY_UNAVAILABLE", "The PDF could not be saved. Check available disk space and retry.");
      } finally {
        await rm(temporary, { force: true });
        if (staged) await rm(destination, { force: true });
      }
    },

    async getDocument(id: string): Promise<Response> {
      if (!idPattern.test(id)) throw notFound();
      const document = await database((db) => toDocument(row(db, id)));
      return Response.json({ document }, { headers: noStore });
    },

    async file(request: Request, id: string): Promise<Response> {
      if (!idPattern.test(id)) throw notFound();
      const document = await database((db) => toSummary(summaryRow(db, id)));
      // IDs are generated UUIDs, never filenames or user-supplied paths.
      const filename = path.join(root(), "files", `${id}.pdf`);
      let storedSize: number;
      try {
        const stored = await stat(filename);
        if (!stored.isFile()) throw notFound();
        storedSize = stored.size;
      } catch { throw notFound(); }
      if (storedSize !== document.size) throw new ApiError(409, "PDF_FILE_CHANGED", "The saved PDF no longer matches its original size. Restore it from a data backup.");
      const etag = `"${id}"`;
      const headers: Record<string, string> = {
        "Content-Type": "application/pdf",
        "Content-Disposition": inlineDisposition(document.fileName),
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "Cache-Control": "private, no-store",
        ETag: etag,
      };
      const requestedRange = request.headers.get("range");
      const ifRange = request.headers.get("if-range");
      const range = requestedRange && (!ifRange || ifRange === etag) ? parseRange(requestedRange, storedSize) : undefined;
      if (range === null) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${storedSize}` } });
      const start = range?.start ?? 0;
      const end = range?.end ?? storedSize - 1;
      headers["Content-Length"] = String(end - start + 1);
      if (range) headers["Content-Range"] = `bytes ${start}-${end}/${storedSize}`;
      if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
      const stream = createReadStream(filename, { start, end });
      const cancel = () => stream.destroy();
      request.signal.addEventListener("abort", cancel, { once: true });
      stream.once("close", () => request.signal.removeEventListener("abort", cancel));
      if (request.signal.aborted) stream.destroy();
      return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
    },

    async patchProgress(request: Request, id: string): Promise<Response> {
      assertSameOrigin(request);
      if (!idPattern.test(id)) throw notFound();
      const body = await readBoundedJson(request);
      assertOnlyFields(body, ["revision", "progress"]);
      const revision = readRevision(body.revision);
      if (!isPdfProgress(body.progress)) throw validation("progress", "Use a positive page, scale from 0.1 to 8, and rotation of 0, 90, 180 or 270 degrees.");
      const progress = body.progress;
      const document = await database((db) => db.transaction(() => {
        const previous = row(db, id);
        if (previous.progress_revision !== revision) throw conflict(previous);
        db.prepare(`UPDATE pdf_documents SET page = ?, scale = ?, rotation = ?,
          progress_revision = progress_revision + 1, updated_at = ? WHERE id = ?`).run(progress.page, progress.scale, progress.rotation, new Date().toISOString(), id);
        return toDocument(row(db, id));
      })());
      return Response.json({ document }, { headers: noStore });
    },

    async patchAnnotations(request: Request, id: string): Promise<Response> {
      assertSameOrigin(request);
      if (!idPattern.test(id)) throw notFound();
      const body = await readBoundedJson(request);
      assertOnlyFields(body, ["revision", "annotations"]);
      const revision = readRevision(body.revision);
      if (!isPdfAnnotations(body.annotations)) throw validation("annotations", "PDF annotations contain invalid, duplicate or oversized entries.");
      const annotations = JSON.stringify(body.annotations);
      const document = await database((db) => db.transaction(() => {
        const previous = row(db, id);
        if (previous.annotations_revision !== revision) throw conflict(previous);
        db.prepare(`UPDATE pdf_documents SET annotations = ?,
          annotations_revision = annotations_revision + 1, updated_at = ? WHERE id = ?`).run(annotations, new Date().toISOString(), id);
        return toDocument(row(db, id));
      })());
      return Response.json({ document }, { headers: noStore });
    },
  };
}

function toSummary(row: SummaryRow): PdfDocumentSummary {
  return {
    id: row.id, title: row.title, fileName: row.file_name, size: row.size,
    importedAt: row.imported_at, updatedAt: row.updated_at,
    progress: { page: row.page, scale: row.scale, rotation: row.rotation },
    progressRevision: row.progress_revision, annotationsRevision: row.annotations_revision,
  };
}

function toDocument(row: DocumentRow): PdfDocument {
  return { ...toSummary(row), annotations: JSON.parse(row.annotations) };
}

function readBoundary(request: Request): string {
  const contentType = request.headers.get("content-type") ?? "";
  const match = /^multipart\/form-data\s*;\s*boundary=(?:"([^"\r\n]+)"|([^;\s]+))\s*$/iu.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || boundary.length > 70 || !/^[A-Za-z0-9'()+_,./:=? -]+$/u.test(boundary) || boundary.endsWith(" ")) {
    throw new ApiError(415, "INVALID_PDF_UPLOAD", "Upload a PDF using multipart form data with a file field and optional title.");
  }
  return boundary;
}

function assertDeclaredSize(request: Request, limit: number): void {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/u.test(length) || BigInt(length) > BigInt(limit))) {
    throw new ApiError(413, "PDF_BODY_TOO_LARGE", "PDF files must not exceed 512 MiB; annotation updates must not exceed 4 MiB.");
  }
}

/** Only one small header/tail buffer is retained while the original streams to disk. */
async function streamMultipart(request: Request, boundary: string, temporary: string): Promise<{ fileName: string; title: string; size: number }> {
  if (!request.body) throw malformedUpload();
  const reader = request.body.getReader();
  const first = Buffer.from(`--${boundary}\r\n`);
  const marker = Buffer.from(`\r\n--${boundary}`);
  let pending = Buffer.alloc(0);
  let phase: "start" | "headers" | "body" | "end" = "start";
  let part: "file" | "title" | undefined;
  let fileName: string | undefined;
  let titleBytes: Buffer | undefined;
  let handle: FileHandle | undefined;
  let size = 0;
  let received = 0;
  let magic = Buffer.alloc(0);

  async function consume(bytes: Buffer): Promise<void> {
    if (part === "file") {
      size += bytes.byteLength;
      if (size > PDF_MAX_FILE_BYTES) throw new ApiError(413, "PDF_TOO_LARGE", "PDF files must not exceed 512 MiB.");
      if (magic.length < 8) magic = Buffer.concat([magic, bytes.subarray(0, 8 - magic.length)]);
      if (magic.length === 8 && !validPdfMagic(magic)) throw invalidPdf();
      if (bytes.length > 0) await handle!.writeFile(bytes);
    } else if (part === "title") {
      if ((titleBytes?.length ?? 0) + bytes.length > PDF_TITLE_MAX_LENGTH * 4) throw validation("title", `PDF titles must not exceed ${PDF_TITLE_MAX_LENGTH} characters.`);
      titleBytes = Buffer.concat([titleBytes ?? Buffer.alloc(0), bytes]);
    } else throw malformedUpload();
  }

  try {
    while (true) {
      if (request.signal.aborted) throw new ApiError(499, "PDF_UPLOAD_CANCELED", "The PDF import was canceled.");
      const chunk = await reader.read();
      if (request.signal.aborted) throw new ApiError(499, "PDF_UPLOAD_CANCELED", "The PDF import was canceled.");
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > PDF_MAX_FILE_BYTES + multipartOverheadLimit) throw new ApiError(413, "PDF_TOO_LARGE", "PDF files must not exceed 512 MiB.");
      pending = Buffer.concat([pending, chunk.value]);
      while (true) {
        if (phase === "start") {
          if (pending.length < first.length) break;
          if (!pending.subarray(0, first.length).equals(first)) throw malformedUpload();
          pending = pending.subarray(first.length);
          phase = "headers";
        } else if (phase === "headers") {
          const end = pending.indexOf("\r\n\r\n");
          if (end < 0) { if (pending.length > headerLimit) throw malformedUpload(); break; }
          if (end > headerLimit) throw malformedUpload();
          const parsed = readPartHeaders(pending.subarray(0, end).toString("utf8"));
          if (parsed.name === "file" && parsed.fileName !== undefined && !fileName) {
            if (!validFileName(parsed.fileName)) throw validation("file", "Choose a PDF with a valid filename.");
            fileName = parsed.fileName;
            handle = await open(temporary, "wx");
            part = "file";
          } else if (parsed.name === "title" && parsed.fileName === undefined && titleBytes === undefined) {
            titleBytes = Buffer.alloc(0);
            part = "title";
          } else throw malformedUpload();
          pending = pending.subarray(end + 4);
          phase = "body";
        } else if (phase === "body") {
          let end = pending.indexOf(marker);
          while (end >= 0 && pending.length >= end + marker.length + 2) {
            const suffix = pending.subarray(end + marker.length, end + marker.length + 2).toString("ascii");
            if (suffix === "--" || suffix === "\r\n") break;
            end = pending.indexOf(marker, end + marker.length);
          }
          if (end >= 0 && pending.length >= end + marker.length + 2) {
            await consume(pending.subarray(0, end));
            if (part === "file") { await handle!.sync(); await handle!.close(); handle = undefined; }
            const last = pending.subarray(end + marker.length, end + marker.length + 2).toString("ascii") === "--";
            pending = pending.subarray(end + marker.length + 2);
            phase = last ? "end" : "headers";
            part = undefined;
          } else {
            const retain = marker.length + 2;
            if (pending.length > retain) {
              await consume(pending.subarray(0, pending.length - retain));
              pending = pending.subarray(pending.length - retain);
            }
            break;
          }
        } else {
          if (pending.length > 2 || (pending.length === 2 && !pending.equals(Buffer.from("\r\n")))) throw malformedUpload();
          break;
        }
      }
    }
    if (phase !== "end" || (pending.length !== 0 && !pending.equals(Buffer.from("\r\n")))) throw malformedUpload();
    if (!fileName || size === 0) throw new ApiError(400, "EMPTY_PDF", "Choose a nonempty PDF file.");
    if (!validPdfMagic(magic)) throw invalidPdf();
    let title: string;
    try { title = titleBytes === undefined ? fileName.replace(/\.pdf$/iu, "") : new TextDecoder("utf-8", { fatal: true }).decode(titleBytes).trim(); }
    catch { throw validation("title", "PDF titles must contain valid text."); }
    if (!title || title.length > PDF_TITLE_MAX_LENGTH || /[\u0000-\u001f\u007f]/u.test(title)) throw validation("title", `Use a PDF title from 1 to ${PDF_TITLE_MAX_LENGTH} characters.`);
    return { fileName, title, size };
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (request.signal.aborted) throw new ApiError(499, "PDF_UPLOAD_CANCELED", "The PDF import was canceled.");
    throw error;
  } finally {
    reader.releaseLock();
    await handle?.close();
  }
}

function readPartHeaders(headers: string): { name: string; fileName?: string } {
  let disposition: string | undefined;
  for (const line of headers.split("\r\n")) {
    const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*(.*)$/u.exec(line);
    if (!match) throw malformedUpload();
    if (match[1].toLowerCase() === "content-disposition") {
      if (disposition !== undefined) throw malformedUpload();
      disposition = match[2];
    }
  }
  if (!disposition || !/^form-data\s*;/iu.test(disposition)) throw malformedUpload();
  const name = /(?:^|;)\s*name="([^"\r\n]*)"/iu.exec(disposition)?.[1];
  const fileName = /(?:^|;)\s*filename="([^"\r\n]*)"/iu.exec(disposition)?.[1];
  if (!name) throw malformedUpload();
  return { name, ...(fileName === undefined ? {} : { fileName }) };
}

async function readBoundedJson(request: Request): Promise<Record<string, unknown>> {
  assertDeclaredSize(request, jsonBodyLimit);
  if (!request.body) throw validation("body", "Supply a JSON object.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (request.signal.aborted) throw new ApiError(499, "PDF_UPDATE_CANCELED", "The PDF update was canceled.");
      const chunk = await reader.read();
      if (request.signal.aborted) throw new ApiError(499, "PDF_UPDATE_CANCELED", "The PDF update was canceled.");
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > jsonBodyLimit) throw new ApiError(413, "PDF_BODY_TOO_LARGE", "Annotation updates must not exceed 4 MiB.");
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks, size).toString("utf8")); }
  catch { throw new ApiError(400, "INVALID_JSON", "The request body must be valid JSON."); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new ApiError(400, "INVALID_JSON", "The request body must be a JSON object.");
  return parsed as Record<string, unknown>;
}

function readRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw validation("revision", "Supply the current non-negative revision.");
  return value as number;
}

function parseRange(value: string, size: number): { start: number; end: number } | null {
  const matched = /^bytes=(\d*)-(\d*)$/u.exec(value);
  if (!matched || (!matched[1] && !matched[2])) return null;
  if (!matched[1]) {
    const suffix = Number(matched[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(matched[1]);
  const end = matched[2] ? Number(matched[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

function validFileName(name: string): boolean {
  return name.length > 0 && name !== "." && name !== ".." && Buffer.byteLength(name, "utf8") <= PDF_TITLE_MAX_LENGTH * 4 && !/[\\/\u0000-\u001f\u007f]/u.test(name);
}

function inlineDisposition(name: string): string {
  const fallback = name.replace(/[^a-zA-Z0-9._-]/gu, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function validPdfMagic(bytes: Buffer): boolean { return /^%PDF-[12]\.[0-9]/u.test(bytes.toString("latin1")); }
function invalidPdf(): ApiError { return new ApiError(415, "INVALID_PDF", "The selected file does not have a valid PDF header."); }
function notFound(): ApiError { return new ApiError(404, "PDF_NOT_FOUND", "The PDF was not found in this app."); }
function malformedUpload(): ApiError { return new ApiError(400, "INVALID_PDF_UPLOAD", "Upload one PDF using the file field and an optional title field."); }
function validation(field: string, message: string): ApiError { return new ApiError(400, "VALIDATION_ERROR", message, { field }); }
function conflict(row: DocumentRow): ApiError { return new ApiError(409, "PDF_REVISION_CONFLICT", "This PDF was updated in another window. Reload the latest state before saving.", { document: toDocument(row) }); }
