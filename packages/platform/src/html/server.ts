import { createHash, randomUUID } from "node:crypto";
import { lstatSync, renameSync } from "node:fs";
import { lstat, mkdir, open, rm, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import Database from "better-sqlite3";
import { ApiError } from "../http/errors";
import { assertOnlyFields, assertSameOrigin } from "../http/request";
import {
  HTML_FOLDER_MAX_DEPTH, HTML_FOLDER_NAME_MAX_LENGTH, HTML_MAX_BUNDLE_BYTES, HTML_MAX_BUNDLE_FILES, HTML_MAX_DOCUMENT_BYTES, HTML_TITLE_MAX_LENGTH,
  htmlFolderNameKey, isHtmlAnnotations, isHtmlProgress, normalizeHtmlAssetPath,
  type HtmlAnnotation, type HtmlBundle, type HtmlDocument, type HtmlDocumentSummary, type HtmlFolder, type HtmlProgress,
} from "./core";
import { htmlResourceMime, streamHtmlBundle, type StoredHtmlFile } from "./upload";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const noStore = { "Cache-Control": "private, no-store" };
const bodyLimit = 4 * 1024 * 1024;
interface BundleRow { id: string; size: number; imported_at: string; files: string; digest: string }
interface FolderRow { id: string; name: string; name_key: string; parent_id: string | null; created_at: string; updated_at: string }
interface DocumentRow {
  id: string; title: string; file_name: string; entry_path: string; bundle_id: string; folder_id: string | null; size: number;
  imported_at: string; updated_at: string; position: number; scale: number; progress_revision: number; annotations_revision: number; annotations: string;
}
const summaryColumns = "id, title, file_name, entry_path, bundle_id, folder_id, size, imported_at, updated_at, position, scale, progress_revision, annotations_revision";
type SummaryRow = Omit<DocumentRow, "annotations">;

export function createHtmlLibraryHandlers(options: { root: () => string }) {
  const root = () => path.resolve(/* turbopackIgnore: true */ options.root());
  const bundleRoot = () => path.join(root(), "bundles");
  async function database<T>(operation: (db: Database.Database) => T): Promise<T> {
    let db: Database.Database | undefined;
    try {
      await directory(root());
      const filename = path.join(root(), "metadata.sqlite");
      try { if (!(await lstat(filename)).isFile()) throw unavailable(); } catch (error) { if (!missing(error)) throw error; }
      db = new Database(filename);
      db.pragma("busy_timeout = 5000"); db.pragma("journal_mode = DELETE"); db.pragma("synchronous = FULL"); db.pragma("foreign_keys = ON");
      db.exec(`CREATE TABLE IF NOT EXISTS html_bundles (id TEXT PRIMARY KEY, size INTEGER NOT NULL, imported_at TEXT NOT NULL, files TEXT NOT NULL, digest TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS html_folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL, parent_id TEXT REFERENCES html_folders(id) ON DELETE RESTRICT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE UNIQUE INDEX IF NOT EXISTS html_folders_sibling_name ON html_folders (COALESCE(parent_id, ''), name_key);
        CREATE TABLE IF NOT EXISTS html_documents (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, file_name TEXT NOT NULL, entry_path TEXT NOT NULL,
          bundle_id TEXT NOT NULL REFERENCES html_bundles(id) ON DELETE RESTRICT,
          folder_id TEXT REFERENCES html_folders(id) ON DELETE RESTRICT, size INTEGER NOT NULL,
          imported_at TEXT NOT NULL, updated_at TEXT NOT NULL, position REAL NOT NULL DEFAULT 0, scale REAL NOT NULL DEFAULT 1,
          progress_revision INTEGER NOT NULL DEFAULT 0, annotations_revision INTEGER NOT NULL DEFAULT 0, annotations TEXT NOT NULL DEFAULT '[]');
        CREATE INDEX IF NOT EXISTS html_documents_folder ON html_documents (folder_id);
        CREATE INDEX IF NOT EXISTS html_documents_bundle ON html_documents (bundle_id)`);
      return operation(db);
    } catch (error) { if (error instanceof ApiError) throw error; throw unavailable(); }
    finally { db?.close(); }
  }

  function documentRow(db: Database.Database, id: string): DocumentRow {
    if (!idPattern.test(id)) throw notFound();
    const row = db.prepare("SELECT * FROM html_documents WHERE id = ?").get(id) as DocumentRow | undefined;
    if (!row) throw notFound();
    return row;
  }
  function bundleRow(db: Database.Database, id: string): BundleRow {
    if (!idPattern.test(id)) throw bundleNotFound();
    const row = db.prepare("SELECT * FROM html_bundles WHERE id = ?").get(id) as BundleRow | undefined;
    if (!row) throw bundleNotFound();
    return row;
  }
  function document(db: Database.Database, id: string): HtmlDocument {
    const row = documentRow(db, id);
    return { ...toSummary(row), annotations: JSON.parse(row.annotations) as HtmlAnnotation[], bundle: toBundle(bundleRow(db, row.bundle_id)) };
  }
  function quarantine(id: string): { original: string; removed: string } | null {
    if (!idPattern.test(id)) throw unavailable();
    const original = path.join(bundleRoot(), id);
    try {
      if (!lstatSync(bundleRoot()).isDirectory() || !lstatSync(original).isDirectory()) throw unavailable();
      const removed = path.join(bundleRoot(), `.deleted-${id}-${randomUUID()}`);
      renameSync(original, removed); return { original, removed };
    } catch (error) { if (missing(error)) return null; throw error; }
  }
  function restore(staged: { original: string; removed: string } | null) { if (staged) renameSync(staged.removed, staged.original); }
  async function discard(staged: { original: string; removed: string } | null) {
    if (!staged) return;
    try { await rm(staged.removed, { recursive: true, force: true }); }
    catch (error) { console.error("A deleted HTML bundle remains in its inaccessible quarantine directory.", error); }
  }

  return {
    async list(): Promise<Response> {
      const library = await database((db) => db.transaction(() => ({
        documents: (db.prepare(`SELECT ${summaryColumns} FROM html_documents ORDER BY imported_at DESC, id DESC`).all() as SummaryRow[]).map(toSummary),
        folders: folderRows(db).map(toFolder),
      }))());
      return Response.json(library, { headers: noStore });
    },

    async importBundle(request: Request): Promise<Response> {
      assertSameOrigin(request);
      const id = importId(request);
      await directory(root()); await directory(bundleRoot());
      const temporary = path.join(bundleRoot(), `.pending-${id}-${randomUUID()}`);
      const destination = path.join(bundleRoot(), id);
      await mkdir(temporary);
      let staged = false;
      try {
        const uploaded = await streamHtmlBundle(request, temporary);
        const result = await database((db) => db.transaction(() => {
          const previous = db.prepare("SELECT * FROM html_bundles WHERE id = ?").get(id) as BundleRow | undefined;
          if (previous) {
            if (previous.digest !== uploaded.digest) throw importConflict();
            return { bundle: toBundle(previous), stored: storedFiles(previous), imported: false };
          }
          if (!lstatSync(bundleRoot()).isDirectory()) throw unavailable();
          try { lstatSync(destination); throw importInProgress(); } catch (error) { if (!missing(error)) throw error; }
          renameSync(temporary, destination); staged = true;
          db.prepare("INSERT INTO html_bundles (id, size, imported_at, files, digest) VALUES (?, ?, ?, ?, ?)")
            .run(id, uploaded.size, new Date().toISOString(), JSON.stringify(uploaded.files), uploaded.digest);
          return { bundle: toBundle(bundleRow(db, id)), stored: uploaded.files, imported: true };
        }).immediate());
        staged = false;
        if (!result.imported) await assertOriginalBundle(destination, result.stored);
        return Response.json({ bundle: result.bundle }, { status: result.imported ? 201 : 200, headers: noStore });
      } catch (error) { if (error instanceof ApiError) throw error; throw unavailable(); }
      finally {
        await rm(temporary, { recursive: true, force: true });
        if (staged) await rm(destination, { recursive: true, force: true });
      }
    },

    async getBundle(id: string): Promise<Response> {
      const bundle = await database((db) => toBundle(bundleRow(db, id)));
      return Response.json({ bundle }, { headers: noStore });
    },

    async deleteBundle(request: Request, id: string): Promise<Response> {
      assertSameOrigin(request); if (!idPattern.test(id)) throw bundleNotFound();
      let staged: ReturnType<typeof quarantine> = null;
      try {
        await database((db) => db.transaction(() => {
          bundleRow(db, id);
          if (db.prepare("SELECT 1 FROM html_documents WHERE bundle_id = ? LIMIT 1").get(id)) throw new ApiError(409, "HTML_BUNDLE_IN_USE", "This resource bundle belongs to an imported document and cannot be discarded.");
          staged = quarantine(id); db.prepare("DELETE FROM html_bundles WHERE id = ?").run(id);
        }).immediate());
      } catch (error) { restore(staged); throw error; }
      await discard(staged);
      return new Response(null, { status: 204, headers: noStore });
    },

    async importDocument(request: Request): Promise<Response> {
      assertSameOrigin(request);
      const id = importId(request);
      const body = await readJson(request);
      assertOnlyFields(body, ["bundleId", "entryPath", "title", "folderId"]);
      const bundleId = readId(body.bundleId, "bundleId");
      const entryPath = normalizeHtmlAssetPath(body.entryPath);
      if (!entryPath || !/\.html?$/iu.test(entryPath)) throw validation("entryPath", "Choose a .html or .htm entry from the uploaded bundle.");
      const title = readTitle(body.title === undefined ? entryPath.split("/").at(-1)!.replace(/\.html?$/iu, "") : body.title);
      const folderId = readNullableId(body.folderId === undefined ? null : body.folderId, "folderId");
      const result = await database((db) => db.transaction(() => {
        const previous = db.prepare("SELECT * FROM html_documents WHERE id = ?").get(id) as DocumentRow | undefined;
        if (previous) {
          if (previous.bundle_id !== bundleId || previous.entry_path !== entryPath || previous.title !== title) throw importConflict();
          return { document: document(db, id), imported: false };
        }
        const bundle = bundleRow(db, bundleId);
        const entry = storedFiles(bundle).find((file) => file.path === entryPath);
        if (!entry || entry.size < 1) throw validation("entryPath", "The HTML entry was not found in this resource bundle.");
        if (entry.size > HTML_MAX_DOCUMENT_BYTES) throw validation("entryPath", "HTML documents must not exceed 64 MiB each.");
        if (folderId !== null) folderRow(db, folderId);
        const timestamp = new Date().toISOString();
        db.prepare("INSERT INTO html_documents (id, title, file_name, entry_path, bundle_id, folder_id, size, imported_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(id, title, entryPath.split("/").at(-1), entryPath, bundleId, folderId, entry.size, timestamp, timestamp);
        return { document: document(db, id), imported: true };
      }).immediate());
      return Response.json({ document: result.document }, { status: result.imported ? 201 : 200, headers: noStore });
    },

    async getDocument(id: string): Promise<Response> {
      return Response.json({ document: await database((db) => document(db, id)) }, { headers: noStore });
    },

    async moveDocument(request: Request, id: string): Promise<Response> {
      assertSameOrigin(request); if (!idPattern.test(id)) throw notFound();
      const body = await readJson(request); assertOnlyFields(body, ["folderId"]);
      const folderId = readNullableId(body.folderId, "folderId");
      const updated = await database((db) => db.transaction(() => {
        documentRow(db, id); if (folderId !== null) folderRow(db, folderId);
        db.prepare("UPDATE html_documents SET folder_id = ?, updated_at = ? WHERE id = ?").run(folderId, new Date().toISOString(), id);
        return document(db, id);
      }).immediate());
      return Response.json({ document: updated }, { headers: noStore });
    },

    async deleteDocument(request: Request, id: string): Promise<Response> {
      assertSameOrigin(request); if (!idPattern.test(id)) throw notFound();
      let staged: ReturnType<typeof quarantine> = null;
      try {
        await database((db) => db.transaction(() => {
          const row = documentRow(db, id);
          db.prepare("DELETE FROM html_documents WHERE id = ?").run(id);
          if (!db.prepare("SELECT 1 FROM html_documents WHERE bundle_id = ? LIMIT 1").get(row.bundle_id)) {
            staged = quarantine(row.bundle_id); db.prepare("DELETE FROM html_bundles WHERE id = ?").run(row.bundle_id);
          }
        }).immediate());
      } catch (error) { restore(staged); throw error; }
      await discard(staged);
      return new Response(null, { status: 204, headers: noStore });
    },

    async asset(request: Request, id: string, resourcePath: string | readonly string[]): Promise<Response> {
      if (!idPattern.test(id)) throw notFound();
      const filename = normalizeHtmlAssetPath(typeof resourcePath === "string" ? resourcePath : resourcePath.join("/"));
      if (!filename) throw notFound();
      const source = await database((db) => {
        const row = documentRow(db, id); const bundle = bundleRow(db, row.bundle_id);
        const file = storedFiles(bundle).find((entry) => entry.path === filename);
        if (!file) throw notFound();
        // A directory import shares assets, but deleting an entry must revoke its
        // original HTML even when another document still owns the same bundle.
        if (/\.(?:html?|xhtml)$/iu.test(file.path) && !db.prepare("SELECT 1 FROM html_documents WHERE bundle_id = ? AND entry_path = ? LIMIT 1").get(row.bundle_id, file.path)) throw notFound();
        return { file, bundleId: row.bundle_id };
      });
      let handle: FileHandle | undefined;
      try {
        const directory = path.join(bundleRoot(), source.bundleId);
        if (!(await lstat(bundleRoot())).isDirectory() || !(await lstat(directory)).isDirectory()) throw notFound();
        const physical = path.join(directory, String(source.file.index));
        if (!(await lstat(physical)).isFile()) throw notFound();
        handle = await open(physical, "r");
        const stats = await handle.stat();
        if (!stats.isFile() || stats.size !== source.file.size) throw notFound();
        const headers = new Headers({ ...noStore, "Content-Type": source.file.mimeType,
          "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "cross-origin", "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes",
          "Content-Disposition": disposition(source.file.path),
        });
        const range = request.headers.get("range");
        const bounds = range === null ? { start: 0, end: stats.size - 1 } : parseRange(range, stats.size);
        if (!bounds) { headers.set("Content-Range", `bytes */${stats.size}`); await handle.close(); handle = undefined; return new Response(null, { status: 416, headers }); }
        const status = range === null ? 200 : 206;
        headers.set("Content-Length", String(Math.max(0, bounds.end - bounds.start + 1)));
        if (range !== null) headers.set("Content-Range", `bytes ${bounds.start}-${bounds.end}/${stats.size}`);
        if (request.method === "HEAD" || stats.size === 0) { await handle.close(); handle = undefined; return new Response(null, { status, headers }); }
        const stream = handle.createReadStream(bounds); handle = undefined;
        return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers });
      } catch (error) { await handle?.close(); if (error instanceof ApiError) throw error; throw notFound(); }
    },

    async patchProgress(request: Request, id: string): Promise<Response> {
      assertSameOrigin(request); if (!idPattern.test(id)) throw notFound();
      const body = await readJson(request); assertOnlyFields(body, ["revision", "progress"]);
      const revision = readRevision(body.revision);
      if (!isHtmlProgress(body.progress)) throw validation("progress", "Use a reading position from 0 to 1 and a zoom from 10% to 800%.");
      const progress: HtmlProgress = body.progress;
      const updated = await database((db) => db.transaction(() => {
        const previous = documentRow(db, id); if (previous.progress_revision !== revision) throw conflict(document(db, id));
        db.prepare("UPDATE html_documents SET position = ?, scale = ?, progress_revision = progress_revision + 1, updated_at = ? WHERE id = ?")
          .run(progress.position, progress.scale, new Date().toISOString(), id);
        return document(db, id);
      }).immediate());
      return Response.json({ document: updated }, { headers: noStore });
    },

    async patchAnnotations(request: Request, id: string): Promise<Response> {
      assertSameOrigin(request); if (!idPattern.test(id)) throw notFound();
      const body = await readJson(request); assertOnlyFields(body, ["revision", "annotations"]);
      const revision = readRevision(body.revision);
      if (!isHtmlAnnotations(body.annotations)) throw validation("annotations", "HTML annotations contain invalid, duplicate or oversized text anchors.");
      const annotations = JSON.stringify(body.annotations);
      const updated = await database((db) => db.transaction(() => {
        const previous = documentRow(db, id); if (previous.annotations_revision !== revision) throw conflict(document(db, id));
        db.prepare("UPDATE html_documents SET annotations = ?, annotations_revision = annotations_revision + 1, updated_at = ? WHERE id = ?")
          .run(annotations, new Date().toISOString(), id);
        return document(db, id);
      }).immediate());
      return Response.json({ document: updated }, { headers: noStore });
    },

    async createFolder(request: Request): Promise<Response> {
      assertSameOrigin(request); const body = await readJson(request); assertOnlyFields(body, ["name", "parentId"]);
      const name = readFolderName(body.name); const parentId = readNullableId(body.parentId === undefined ? null : body.parentId, "parentId");
      const folder = await database((db) => db.transaction(() => {
        assertPlacement(db, parentId); assertUniqueName(db, name, parentId);
        const id = randomUUID(); const timestamp = new Date().toISOString();
        db.prepare("INSERT INTO html_folders (id, name, name_key, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(id, name, htmlFolderNameKey(name), parentId, timestamp, timestamp);
        return toFolder(folderRow(db, id));
      }).immediate());
      return Response.json({ folder }, { status: 201, headers: noStore });
    },

    async patchFolder(request: Request, id: string): Promise<Response> {
      assertSameOrigin(request); if (!idPattern.test(id)) throw folderNotFound();
      const body = await readJson(request); assertOnlyFields(body, ["name", "parentId"]);
      if (body.name === undefined && body.parentId === undefined) throw validation("body", "Supply a folder name or parent folder to update.");
      const name = body.name === undefined ? undefined : readFolderName(body.name);
      const parentId = body.parentId === undefined ? undefined : readNullableId(body.parentId, "parentId");
      const folder = await database((db) => db.transaction(() => {
        const previous = folderRow(db, id); const nextName = name ?? previous.name; const nextParent = parentId === undefined ? previous.parent_id : parentId;
        assertPlacement(db, nextParent, id); assertUniqueName(db, nextName, nextParent, id);
        db.prepare("UPDATE html_folders SET name = ?, name_key = ?, parent_id = ?, updated_at = ? WHERE id = ?")
          .run(nextName, htmlFolderNameKey(nextName), nextParent, new Date().toISOString(), id);
        return toFolder(folderRow(db, id));
      }).immediate());
      return Response.json({ folder }, { headers: noStore });
    },

    async deleteFolder(request: Request, id: string): Promise<Response> {
      assertSameOrigin(request); if (!idPattern.test(id)) throw folderNotFound();
      await database((db) => db.transaction(() => {
        folderRow(db, id);
        if (db.prepare("SELECT 1 FROM html_folders WHERE parent_id = ? LIMIT 1").get(id) || db.prepare("SELECT 1 FROM html_documents WHERE folder_id = ? LIMIT 1").get(id))
          throw new ApiError(409, "HTML_FOLDER_NOT_EMPTY", "Move the HTML documents and subfolders out before deleting this folder.");
        db.prepare("DELETE FROM html_folders WHERE id = ?").run(id);
      }).immediate());
      return new Response(null, { status: 204, headers: noStore });
    },
  };
}

function toSummary(row: SummaryRow): HtmlDocumentSummary {
  return { id: row.id, title: row.title, fileName: row.file_name, entryPath: row.entry_path, bundleId: row.bundle_id, folderId: row.folder_id,
    size: row.size, importedAt: row.imported_at, updatedAt: row.updated_at, progress: { position: row.position, scale: row.scale },
    progressRevision: row.progress_revision, annotationsRevision: row.annotations_revision };
}
function storedFiles(row: BundleRow): StoredHtmlFile[] {
  if (typeof row.files !== "string" || row.files.length > 16 * 1024 * 1024) throw unavailable();
  const files: unknown = JSON.parse(row.files);
  if (!Array.isArray(files) || files.length < 1 || files.length > HTML_MAX_BUNDLE_FILES) throw unavailable();
  const names = new Set<string>(); const indices = new Set<number>(); let total = 0;
  for (const value of files) {
    if (!value || typeof value !== "object") throw unavailable();
    const file = value as Partial<StoredHtmlFile>;
    if (normalizeHtmlAssetPath(file.path) !== file.path || typeof file.path !== "string" || file.mimeType !== htmlResourceMime(file.path) ||
      !Number.isSafeInteger(file.index) || (file.index as number) < 0 || (file.index as number) >= HTML_MAX_BUNDLE_FILES ||
      !Number.isSafeInteger(file.size) || (file.size as number) < 0 || (file.size as number) > HTML_MAX_BUNDLE_BYTES ||
      typeof file.digest !== "string" || !/^[a-f0-9]{64}$/u.test(file.digest)) throw unavailable();
    const name = file.path.toLowerCase(); if (names.has(name) || indices.has(file.index as number)) throw unavailable();
    names.add(name); indices.add(file.index as number); total += file.size as number;
  }
  if (total > HTML_MAX_BUNDLE_BYTES || total !== row.size) throw unavailable();
  return files as StoredHtmlFile[];
}
function toBundle(row: BundleRow): HtmlBundle { return { id: row.id, size: row.size, importedAt: row.imported_at, files: storedFiles(row).map(({ path, size, mimeType }) => ({ path, size, mimeType })) }; }
function folderRows(db: Database.Database): FolderRow[] { return db.prepare("SELECT * FROM html_folders ORDER BY name_key, id").all() as FolderRow[]; }
function toFolder(row: FolderRow): HtmlFolder { return { id: row.id, name: row.name, parentId: row.parent_id, createdAt: row.created_at, updatedAt: row.updated_at }; }
function folderRow(db: Database.Database, id: string): FolderRow {
  if (!idPattern.test(id)) throw folderNotFound();
  const folder = db.prepare("SELECT * FROM html_folders WHERE id = ?").get(id) as FolderRow | undefined;
  if (!folder) throw folderNotFound(); return folder;
}
function assertUniqueName(db: Database.Database, name: string, parent: string | null, except = "") {
  if (db.prepare("SELECT 1 FROM html_folders WHERE parent_id IS ? AND name_key = ? AND id <> ? LIMIT 1").get(parent, htmlFolderNameKey(name), except))
    throw new ApiError(409, "HTML_FOLDER_EXISTS", "A folder with this name already exists here.");
}
function assertPlacement(db: Database.Database, parent: string | null, moving?: string) {
  const folders = folderRows(db); const byId = new Map(folders.map((folder) => [folder.id, folder])); const ancestors = new Set<string>();
  for (let id = parent; id !== null;) {
    if (id === moving || ancestors.has(id)) throw validation("parentId", "A folder cannot be placed inside itself or one of its subfolders.");
    const folder = byId.get(id); if (!folder) throw folderNotFound(); ancestors.add(id); id = folder.parent_id;
  }
  let height = 1;
  if (moving !== undefined) {
    const pending = [{ id: moving, depth: 1 }]; const seen = new Set<string>();
    while (pending.length) {
      const entry = pending.pop()!; if (seen.has(entry.id)) throw validation("parentId", "The folder hierarchy contains a cycle."); seen.add(entry.id); height = Math.max(height, entry.depth);
      for (const folder of folders) if (folder.parent_id === entry.id) pending.push({ id: folder.id, depth: entry.depth + 1 });
    }
  }
  if (ancestors.size + height > HTML_FOLDER_MAX_DEPTH) throw validation("parentId", `HTML folders can be nested up to ${HTML_FOLDER_MAX_DEPTH} levels.`);
}
function readFolderName(value: unknown): string {
  if (typeof value !== "string") throw validation("name", "Supply a folder name.");
  const name = value.trim().normalize("NFC");
  if (!name || name.length > HTML_FOLDER_NAME_MAX_LENGTH || name === "." || name === ".." || /[\\/\u0000-\u001f\u007f-\u009f]/u.test(name)) throw validation("name", "Use a folder name from 1 to 120 characters without slashes or control characters.");
  return name;
}
function readTitle(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > HTML_TITLE_MAX_LENGTH || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw validation("title", "Use a document title from 1 to 240 characters.");
  return value.trim();
}
function readId(value: unknown, field: string): string { if (typeof value !== "string" || !idPattern.test(value.toLowerCase())) throw validation(field, "Supply a valid version 4 UUID."); return value.toLowerCase(); }
function readNullableId(value: unknown, field: string): string | null { return value === null ? null : readId(value, field); }
function importId(request: Request): string { const value = request.headers.get("X-Babel-Html-Import-Id"); return value === null ? randomUUID() : readId(value, "importId"); }
function readRevision(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw validation("revision", "Supply the current non-negative revision."); return value as number; }

async function directory(filename: string): Promise<void> {
  try { if (!(await lstat(filename)).isDirectory()) throw unavailable(); }
  catch (error) { if (!missing(error)) throw error; await mkdir(filename, { recursive: true }); if (!(await lstat(filename)).isDirectory()) throw unavailable(); }
}
async function assertOriginalBundle(directory: string, files: readonly StoredHtmlFile[]): Promise<void> {
  try {
    if (!(await lstat(path.dirname(directory))).isDirectory() || !(await lstat(directory)).isDirectory()) throw unavailable();
    for (const file of files) {
      const filename = path.join(directory, String(file.index)); if (!(await lstat(filename)).isFile()) throw unavailable();
      const handle = await open(filename, "r");
      try {
        if ((await handle.stat()).size !== file.size) throw unavailable();
        const digest = createHash("sha256"); for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk);
        if (digest.digest("hex") !== file.digest) throw new ApiError(409, "HTML_FILE_CHANGED", "A saved HTML resource no longer matches its original. Restore it from a backup.");
      } finally { await handle.close(); }
    }
  } catch (error) { if (error instanceof ApiError) throw error; throw unavailable(); }
}
async function readJson(request: Request): Promise<Record<string, unknown>> {
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/u.test(declared) && BigInt(declared) > BigInt(bodyLimit)) throw tooLarge();
  if (!request.body) throw validation("body", "Supply a JSON object.");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  request.signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (request.signal.aborted) throw new ApiError(499, "HTML_UPDATE_CANCELED", "The HTML update was canceled.");
      const next = await reader.read(); if (request.signal.aborted) throw new ApiError(499, "HTML_UPDATE_CANCELED", "The HTML update was canceled.");
      if (next.done) break; size += next.value.byteLength; if (size > bodyLimit) throw tooLarge(); chunks.push(next.value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { request.signal.removeEventListener("abort", cancel); reader.releaseLock(); }
  let body: unknown; try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size))); } catch { throw validation("body", "The request body must be a valid JSON object."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw validation("body", "The request body must be a JSON object."); return body as Record<string, unknown>;
}
function parseRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value); if (!match || (!match[1] && !match[2]) || size === 0) return null;
  if (!match[1]) { const suffix = Number(match[2]); return Number.isSafeInteger(suffix) && suffix > 0 ? { start: Math.max(0, size - suffix), end: size - 1 } : null; }
  const start = Number(match[1]); const end = match[2] ? Number(match[2]) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start < size && end >= start ? { start, end: Math.min(end, size - 1) } : null;
}
function disposition(filename: string): string {
  const name = filename.split("/").at(-1)!; const fallback = name.replace(/[^a-zA-Z0-9._-]/gu, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  const kind = /\.(?:svg|html?|xml)$/iu.test(filename) || htmlResourceMime(filename) === "application/octet-stream" ? "attachment" : "inline";
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
function missing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
function unavailable(): ApiError { return new ApiError(503, "HTML_LIBRARY_UNAVAILABLE", "The HTML library could not be opened or saved. Check disk space and file access, then retry."); }
function notFound(): ApiError { return new ApiError(404, "HTML_NOT_FOUND", "The HTML document or resource was not found in this app."); }
function bundleNotFound(): ApiError { return new ApiError(404, "HTML_BUNDLE_NOT_FOUND", "The HTML resource bundle was not found. Choose the files again."); }
function folderNotFound(): ApiError { return new ApiError(404, "HTML_FOLDER_NOT_FOUND", "The HTML folder was not found. Reload the library and choose a folder again."); }
function importConflict(): ApiError { return new ApiError(409, "HTML_IMPORT_ID_CONFLICT", "This import ID belongs to different HTML content. Choose the files again to start a new import."); }
function importInProgress(): ApiError { return new ApiError(409, "HTML_IMPORT_IN_PROGRESS", "An import with this ID is still finishing. Reload the library and retry."); }
function conflict(document: HtmlDocument): ApiError { return new ApiError(409, "HTML_REVISION_CONFLICT", "This HTML document was updated in another window. Reload its latest state before saving.", { document }); }
function validation(field: string, message: string): ApiError { return new ApiError(400, "VALIDATION_ERROR", message, { field }); }
function tooLarge(): ApiError { return new ApiError(413, "HTML_BODY_TOO_LARGE", "HTML metadata updates must not exceed 4 MiB."); }
