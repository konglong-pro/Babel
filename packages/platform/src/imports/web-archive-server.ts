import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { ApiError } from "../http/errors";
import { assertSameOrigin } from "../http/request";
import {
  WEB_ARCHIVE_CONTENT_SECURITY_POLICY,
  WEB_ARCHIVE_MAX_BYTES,
  parseWebArchive,
  renderWebArchiveSnapshot,
} from "./web-archive-core";

const idPattern = /^[a-f0-9]{64}$/u;

export function createWebArchiveHandlers(options: { originalRoot: () => string }) {
  const archiveRoot = () => path.join(path.resolve(/* turbopackIgnore: true */ options.originalRoot()), "web-archives");
  return {
    async saveWebArchive(request: Request): Promise<Response> {
      assertSameOrigin(request);
      const archive = parseWebArchive(await readWebArchiveBytes(request));
      const bytes = Buffer.from(JSON.stringify(archive), "utf8");
      const id = digest(bytes);
      const root = archiveRoot();
      await mkdir(root, { recursive: true });
      const temporary = path.join(root, `.pending-${randomUUID()}`);
      const destination = path.join(root, id);
      await mkdir(temporary);
      try {
        await writeFile(path.join(temporary, "archive.json"), bytes, { flag: "wx" });
        try { await rename(temporary, destination); }
        catch (error) {
          // Repeated and concurrent note saves share the same immutable source.
          let existing: Buffer | undefined;
          try { existing = await readStoredArchive(destination); } catch { /* Reject corruption below. */ }
          if (!existing?.equals(bytes)) throw error;
        }
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
      return Response.json({ url: `/api/imports/web-archive/snapshots/${id}` }, {
        status: 201, headers: { "Cache-Control": "private, no-store" },
      });
    },
    async readWebArchive(id: string): Promise<Response> {
      if (!idPattern.test(id)) throw notFound();
      let html: string;
      try {
        const bytes = await readStoredArchive(path.join(archiveRoot(), id));
        if (digest(bytes) !== id) throw notFound();
        html = renderWebArchiveSnapshot(parseWebArchive(bytes));
      } catch { throw notFound(); }
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": WEB_ARCHIVE_CONTENT_SECURITY_POLICY,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      });
    },
  };
}

/** Count streamed bytes even when Content-Length is missing or understated. */
export async function readWebArchiveBytes(request: Request): Promise<Buffer> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/u.test(declaredLength) && BigInt(declaredLength) > BigInt(WEB_ARCHIVE_MAX_BYTES)) throw oversized();
  if (!request.body) throw empty();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  request.signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (request.signal.aborted) throw canceled();
      const next = await reader.read();
      if (request.signal.aborted) throw canceled();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > WEB_ARCHIVE_MAX_BYTES) throw oversized();
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    request.signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  if (size === 0) throw empty();
  return Buffer.concat(chunks, size);
}

async function readStoredArchive(directory: string): Promise<Buffer> {
  const file = await open(path.join(directory, "archive.json"), "r");
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > WEB_ARCHIVE_MAX_BYTES) throw notFound();
    // Files are immutable after atomic rename; validate bytes and hash again on read.
    return await file.readFile();
  } finally { await file.close(); }
}
function digest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function oversized(): ApiError { return new ApiError(413, "WEB_ARCHIVE_TOO_LARGE", "The archive exceeds 150 MiB. Export a smaller selection."); }
function empty(): ApiError { return new ApiError(400, "EMPTY_WEB_ARCHIVE", "The selected archive is empty."); }
function canceled(): ApiError { return new ApiError(499, "WEB_ARCHIVE_CANCELED", "Archive upload was canceled."); }
function notFound(): ApiError { return new ApiError(404, "WEB_ARCHIVE_NOT_FOUND", "The original layout was not found in this app."); }
