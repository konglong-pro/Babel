import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ApiError } from "../http/errors";
import { assertSameOrigin } from "../http/request";
import {
  DOCUMENT_IMPORT_MAX_BYTES,
  DOCUMENT_IMPORT_MAX_MARKDOWN_BYTES,
  documentImportExtension,
  type DocumentConversionResult,
} from "./document-core";

const originalIdPattern = /^[0-9a-f]{64}$/u;
const workerOutputLimit = DOCUMENT_IMPORT_MAX_MARKDOWN_BYTES * 6 + 64 * 1024;
const conversionTimeoutMs = 120_000;
let activeConversions = 0;

export interface DocumentWorkerRuntime {
  python: string;
  worker: string;
}

export interface DocumentImportOptions {
  originalRoot: () => string;
  /** Used by integration tests; production resolves Babel's isolated runtime. */
  resolveRuntime?: () => Promise<DocumentWorkerRuntime>;
}

export function createDocumentImportHandlers(options: DocumentImportOptions) {
  const runtime = options.resolveRuntime ?? resolveDocumentWorkerRuntime;
  return {
    async capability(): Promise<Response> {
      const result = await runDocumentWorker(await runtime(), ["--probe"], undefined, 15_000);
      if (result.ready !== true || typeof result.sdkVersion !== "string") {
        throw unavailableRuntime();
      }
      return Response.json({ ready: true, sdkVersion: result.sdkVersion }, {
        headers: { "Cache-Control": "no-store" },
      });
    },
    async convert(request: Request): Promise<Response> {
      assertSameOrigin(request);
      const name = readDocumentFileName(request);
      if (activeConversions >= 2) {
        throw new ApiError(503, "CONVERTER_BUSY", "Two files are already being converted. Please retry shortly.");
      }
      activeConversions += 1;
      let directory: string | undefined;
      try {
        const resolvedRuntime = await runtime();
        const bytes = await readDocumentBytes(request);
        directory = await mkdtemp(path.join(os.tmpdir(), "babel-document-"));
        const extension = documentImportExtension(name)!;
        const sourcePath = path.join(directory, `source${extension}`);
        await writeFile(sourcePath, bytes, { flag: "wx" });
        const result = await runDocumentWorker(resolvedRuntime, [sourcePath, extension], request.signal);
        const converted = validateConversionResult(result);
        return Response.json(converted, { headers: { "Cache-Control": "no-store" } });
      } finally {
        activeConversions -= 1;
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    },
    async saveOriginal(request: Request): Promise<Response> {
      assertSameOrigin(request);
      const name = readDocumentFileName(request);
      const bytes = await readDocumentBytes(request);
      const root = path.resolve(/* turbopackIgnore: true */ options.originalRoot());
      // Content + name identify an immutable original. Retrying a failed note
      // save cannot duplicate it or remove a source already used by a saved note.
      const id = createHash("sha256").update(name).update("\0").update(bytes).digest("hex");
      await mkdir(root, { recursive: true });
      const temporary = path.join(root, `.pending-${randomUUID()}`);
      const destination = path.join(root, id);
      await mkdir(temporary);
      try {
        await writeFile(path.join(temporary, "source"), bytes, { flag: "wx" });
        await writeFile(path.join(temporary, "metadata.json"), JSON.stringify({ version: 1, name, size: bytes.byteLength }), { flag: "wx" });
        try {
          await rename(temporary, destination);
        } catch (error) {
          // Concurrent/repeated saves of the same original are idempotent.
          if (!(await originalExists(destination, name, bytes.byteLength))) throw error;
        }
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
      return Response.json({ url: `/api/imports/documents/originals/${id}` }, { status: 201 });
    },
    async readOriginal(id: string): Promise<Response> {
      if (!originalIdPattern.test(id)) throw originalNotFound();
      const directory = path.join(path.resolve(/* turbopackIgnore: true */ options.originalRoot()), id);
      let metadata: { name: string; size: number };
      let bytes: Buffer;
      try {
        metadata = validateOriginalMetadata(JSON.parse(await readFile(path.join(directory, "metadata.json"), "utf8")));
        bytes = await readFile(path.join(directory, "source"));
        if (bytes.byteLength !== metadata.size) throw originalNotFound();
      } catch {
        throw originalNotFound();
      }
      const fallbackName = metadata.name.replace(/[^a-zA-Z0-9._-]/gu, "_");
      const encodedName = encodeURIComponent(metadata.name).replace(/['()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
          "Content-Length": String(bytes.byteLength),
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
          "Content-Security-Policy": "sandbox",
        },
      });
    },
  };
}

export async function resolveDocumentWorkerRuntime(): Promise<DocumentWorkerRuntime> {
  let root = process.cwd();
  while (true) {
    try {
      await access(path.join(root, "babel.apps.json"));
      const worker = path.join(root, "scripts", "markitdown", "worker.py");
      const python = process.env.BABEL_MARKITDOWN_PYTHON
        ? path.resolve(/* turbopackIgnore: true */ process.env.BABEL_MARKITDOWN_PYTHON)
        : path.join(root, ".runtime", "markitdown", ...(process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"]));
      await Promise.all([access(worker), access(python)]);
      return { python, worker };
    } catch {
      const parent = path.dirname(root);
      if (parent === root) throw unavailableRuntime();
      root = parent;
    }
  }
}

export function readDocumentFileName(request: Request): string {
  const encoded = request.headers.get("x-babel-file-name");
  let name = "";
  try { name = encoded === null ? "" : decodeURIComponent(encoded); } catch { /* Reject invalid encoding below. */ }
  if (!validFileName(name)) {
    throw new ApiError(400, "INVALID_FILE_NAME", "Choose a file with a valid filename.");
  }
  if (!documentImportExtension(name)) {
    throw new ApiError(415, "UNSUPPORTED_DOCUMENT", "Supported files: DOCX, PPTX, XLSX, XLS, PDF, HTML, TXT, CSV, JSON, XML and EPUB.");
  }
  return name;
}

export async function readDocumentBytes(request: Request): Promise<Buffer> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/u.test(declaredLength) && BigInt(declaredLength) > BigInt(DOCUMENT_IMPORT_MAX_BYTES)) {
    throw oversizedDocument();
  }
  if (!request.body) throw new ApiError(400, "EMPTY_DOCUMENT", "The selected file is empty.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (request.signal.aborted) throw canceledConversion();
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > DOCUMENT_IMPORT_MAX_BYTES) throw oversizedDocument();
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (size === 0) throw new ApiError(400, "EMPTY_DOCUMENT", "The selected file is empty.");
  return Buffer.concat(chunks, size);
}

export function validateConversionResult(result: Record<string, unknown>): DocumentConversionResult {
  if (typeof result.markdown !== "string" ||
      !(result.title === null || typeof result.title === "string") ||
      !Array.isArray(result.warnings) || result.warnings.some((warning) => typeof warning !== "string") ||
      typeof result.sdkVersion !== "string") {
    throw new ApiError(502, "INVALID_CONVERSION", "The converter returned an invalid result. Please retry.");
  }
  if (Buffer.byteLength(result.markdown, "utf8") > DOCUMENT_IMPORT_MAX_MARKDOWN_BYTES) {
    throw new ApiError(413, "MARKDOWN_TOO_LARGE", "Converted Markdown must not exceed 10 MiB. Split the source into smaller files.");
  }
  if (!result.markdown.trim()) {
    throw new ApiError(422, "NO_EXTRACTABLE_TEXT", "No text could be extracted. Scanned PDFs and images require OCR before importing.");
  }
  return result as unknown as DocumentConversionResult;
}

export function runDocumentWorker(
  runtime: DocumentWorkerRuntime,
  args: string[],
  signal?: AbortSignal,
  timeoutMs = conversionTimeoutMs,
): Promise<Record<string, unknown>> {
  if (signal?.aborted) return Promise.reject(canceledConversion());
  return new Promise((resolve, reject) => {
    const child = spawn(runtime.python, ["-I", "-X", "utf8", runtime.worker, ...args], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONUTF8: "1" },
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: ApiError | undefined;
    const stop = (error: ApiError) => {
      failure ??= error;
      child.kill();
    };
    const cancel = () => stop(canceledConversion());
    const timer = setTimeout(() => stop(new ApiError(504, "CONVERSION_TIMEOUT", "Conversion exceeded two minutes. Split the source into smaller files and retry.")), timeoutMs);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > workerOutputLimit) { stop(new ApiError(413, "MARKDOWN_TOO_LARGE", "The converted document exceeds the Markdown size limit.")); return; }
      if (!failure) chunks.push(chunk);
    });
    // Drain stderr without forwarding document text or private paths to users.
    child.stderr.resume();
    const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
    child.on("error", () => {
      finish();
      reject(unavailableRuntime());
    });
    child.on("close", (code) => {
      finish();
      if (failure) { reject(failure); return; }
      let result: Record<string, unknown>;
      try {
        const decoded: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) throw new Error();
        result = decoded as Record<string, unknown>;
      } catch {
        reject(new ApiError(502, "CONVERSION_FAILED", "The file could not be converted. Check that it is intact and is not password protected."));
        return;
      }
      if (result.error && typeof result.error === "object") {
        const error = result.error as Record<string, unknown>;
        const workerCodes: Record<string, string> = {
          empty_document: "EMPTY_DOCUMENT", unsupported_format: "UNSUPPORTED_DOCUMENT",
          input_too_large: "DOCUMENT_TOO_LARGE", output_too_large: "MARKDOWN_TOO_LARGE",
          no_extractable_text: "NO_EXTRACTABLE_TEXT", unsafe_archive: "UNSAFE_ARCHIVE",
          encrypted_document: "ENCRYPTED_DOCUMENT", sdk_unavailable: "SDK_UNAVAILABLE",
          sdk_version_mismatch: "SDK_UNAVAILABLE",
        };
        const safeErrors: Record<string, number> = {
          EMPTY_DOCUMENT: 400, UNSUPPORTED_DOCUMENT: 415, DOCUMENT_TOO_LARGE: 413,
          MARKDOWN_TOO_LARGE: 413, NO_EXTRACTABLE_TEXT: 422, UNSAFE_ARCHIVE: 422,
          ENCRYPTED_DOCUMENT: 422, CONVERSION_FAILED: 422, SDK_UNAVAILABLE: 503,
        };
        const reportedCode = typeof error.code === "string" ? (workerCodes[error.code] ?? error.code) : "CONVERSION_FAILED";
        const errorCode = reportedCode in safeErrors ? reportedCode : "CONVERSION_FAILED";
        reject(new ApiError(safeErrors[errorCode], errorCode, typeof error.message === "string" ? error.message : "The file could not be converted."));
      } else if (code !== 0) {
        reject(new ApiError(422, "CONVERSION_FAILED", "The file could not be converted. Check the source file and retry."));
      } else {
        resolve(result);
      }
    });
  });
}

function validFileName(name: string): boolean {
  return name.length > 0 && Buffer.byteLength(name, "utf8") <= 240 && !/[\\/\u0000-\u001f\u007f]/u.test(name) && name !== "." && name !== "..";
}
function validateOriginalMetadata(value: unknown): { name: string; size: number } {
  if (typeof value !== "object" || value === null) throw originalNotFound();
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.name !== "string" || !validFileName(record.name) ||
      !documentImportExtension(record.name) || typeof record.size !== "number" ||
      !Number.isSafeInteger(record.size) || record.size < 1 || record.size > DOCUMENT_IMPORT_MAX_BYTES) throw originalNotFound();
  return { name: record.name, size: record.size };
}
async function originalExists(directory: string, name: string, size: number): Promise<boolean> {
  try {
    const metadata = validateOriginalMetadata(JSON.parse(await readFile(path.join(directory, "metadata.json"), "utf8")));
    return metadata.name === name && metadata.size === size;
  } catch { return false; }
}
function unavailableRuntime(): ApiError {
  return new ApiError(503, "SDK_UNAVAILABLE", "The local converter is not installed. Run npm run import:setup from the Babel folder, then retry.");
}
function oversizedDocument(): ApiError {
  return new ApiError(413, "DOCUMENT_TOO_LARGE", "Source files must not exceed 50 MiB.");
}
function canceledConversion(): ApiError {
  return new ApiError(499, "CONVERSION_CANCELED", "Conversion was canceled.");
}
function originalNotFound(): ApiError {
  return new ApiError(404, "ORIGINAL_NOT_FOUND", "The original file was not found in this app.");
}
