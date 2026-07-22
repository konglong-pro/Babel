import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type * as FolderCollectionRoute from "@/app/api/folders/route";
import type * as FolderItemRoute from "@/app/api/folders/[id]/route";
import type * as NoteCollectionRoute from "@/app/api/notes/route";
import type * as NoteItemRoute from "@/app/api/notes/[id]/route";
import type * as NoteBacklinksRoute from "@/app/api/notes/[id]/backlinks/route";
import type * as NoteTitlesRoute from "@/app/api/notes/titles/route";
import type * as SearchRoute from "@/app/api/search/route";
import type * as TemplateCollectionRoute from "@/app/api/templates/route";
import type * as TemplateItemRoute from "@/app/api/templates/[id]/route";
import type * as UploadRoute from "@/app/api/uploads/notes/[filename]/route";
import type * as DatabaseModule from "@/lib/db/client";
import type * as HttpRequestModule from "@/lib/http/request";
import type * as RepositoryModule from "@/lib/repositories";
import type * as StorageModule from "@/lib/storage";
import type { NoteImageUpload } from "@/lib/storage";

let temporaryRoot = "";
let uploadDirectory = "";
let database: typeof DatabaseModule;
let httpRequest: typeof HttpRequestModule;
let repositories: typeof RepositoryModule;
let storage: typeof StorageModule;
let folderCollectionRoute: typeof FolderCollectionRoute;
let folderItemRoute: typeof FolderItemRoute;
let noteCollectionRoute: typeof NoteCollectionRoute;
let noteItemRoute: typeof NoteItemRoute;
let noteBacklinksRoute: typeof NoteBacklinksRoute;
let noteTitlesRoute: typeof NoteTitlesRoute;
let searchRoute: typeof SearchRoute;
let templateCollectionRoute: typeof TemplateCollectionRoute;
let templateItemRoute: typeof TemplateItemRoute;
let uploadRoute: typeof UploadRoute;

before(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "esperanto-test-"));
  uploadDirectory = path.join(temporaryRoot, "uploads");
  process.env.ESPERANTO_DATABASE_PATH = path.join(temporaryRoot, "sqlite.db");
  process.env.ESPERANTO_UPLOAD_DIRECTORY = uploadDirectory;
  database = await import("@/lib/db/client");
  migrate(database.db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  [
    repositories,
    httpRequest,
    storage,
    folderCollectionRoute,
    folderItemRoute,
    noteCollectionRoute,
    noteItemRoute,
    noteBacklinksRoute,
    noteTitlesRoute,
    searchRoute,
    templateCollectionRoute,
    templateItemRoute,
    uploadRoute,
  ] =
    await Promise.all([
      import("@/lib/repositories"),
      import("@/lib/http/request"),
      import("@/lib/storage"),
      import("@/app/api/folders/route"),
      import("@/app/api/folders/[id]/route"),
      import("@/app/api/notes/route"),
      import("@/app/api/notes/[id]/route"),
      import("@/app/api/notes/[id]/backlinks/route"),
      import("@/app/api/notes/titles/route"),
      import("@/app/api/search/route"),
      import("@/app/api/templates/route"),
      import("@/app/api/templates/[id]/route"),
      import("@/app/api/uploads/notes/[filename]/route"),
    ]);
});

after(async () => {
  database.sqlite.close();
  await rm(temporaryRoot, { recursive: true, force: true });
});

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
const gif = Buffer.from("GIF89a\x01", "binary");
const webp = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x01, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "ascii"),
]);
const invalidPng = Buffer.from("not a png");

test("Esperanto backend integration", async (t) => {
    await t.test("migration seeds the three editable root folders in order", () => {
      assert.deepEqual(
        repositories.listFolders().map(({ name, parentId }) => ({ name, parentId })),
        [
          { name: "Vocabulary", parentId: null },
          { name: "Grammar", parentId: null },
          { name: "Expressions", parentId: null },
        ],
      );
    });

    await t.test("folder hierarchy prevents cycles and non-empty deletion", () => {
      const history = repositories.listFolders()[0];
      const ancientRome = repositories.createFolder({
        name: "Ancient Rome",
        parentId: history.id,
      });
      const sources = repositories.createFolder({
        name: "Sources",
        parentId: ancientRome.id,
      });

      assert.throws(
        () => repositories.updateFolder(ancientRome.id, { parentId: sources.id }),
        (error: unknown) =>
          error instanceof repositories.RepositoryError && error.code === "CONFLICT",
      );
      assert.throws(
        () => repositories.deleteFolder(ancientRome.id),
        (error: unknown) =>
          error instanceof repositories.RepositoryError && error.code === "NOT_EMPTY",
      );
    });

    await t.test("mutating routes reject foreign origins with unified errors", async () => {
      const before = repositories.listFolders().length;
      const foreignCreate = await folderCollectionRoute.POST(
        new Request("http://localhost/api/folders", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://attacker.example",
          },
          body: JSON.stringify({ name: "Cross-origin folder", parentId: null }),
        }),
      );
      assert.equal(foreignCreate.status, 403);
      assert.deepEqual(await foreignCreate.json(), {
        error: {
          code: "FORBIDDEN_ORIGIN",
          message: "Cross-origin mutations are not allowed.",
        },
      });
      assert.equal(repositories.listFolders().length, before);

      const sameOriginCreate = await folderCollectionRoute.POST(
        new Request("http://localhost/api/folders", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://127.0.0.1",
          },
          body: JSON.stringify({ name: "Origin checked", parentId: null }),
        }),
      );
      assert.equal(sameOriginCreate.status, 201);
      const created = (await sameOriginCreate.json()) as { id: number; name: string };

      const foreignPatch = await folderItemRoute.PATCH(
        new Request(`http://localhost/api/folders/${created.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "null",
          },
          body: JSON.stringify({ name: "Changed" }),
        }),
        { params: Promise.resolve({ id: String(created.id) }) },
      );
      assert.equal(foreignPatch.status, 403);
      assert.equal(repositories.getFolder(created.id)?.name, "Origin checked");

      const foreignDelete = await folderItemRoute.DELETE(
        new Request(`http://localhost/api/folders/${created.id}`, {
          method: "DELETE",
          headers: { Origin: "https://attacker.example" },
        }),
        { params: Promise.resolve({ id: String(created.id) }) },
      );
      assert.equal(foreignDelete.status, 403);
      assert.ok(repositories.getFolder(created.id));

      const cleanup = await folderItemRoute.DELETE(
        new Request(`http://localhost/api/folders/${created.id}`, { method: "DELETE" }),
        { params: Promise.resolve({ id: String(created.id) }) },
      );
      assert.equal(cleanup.status, 204);

      const foreignNote = await noteCollectionRoute.POST(
        new Request("http://localhost/api/notes", {
          method: "POST",
          headers: { Origin: "https://attacker.example" },
          body: noteForm({
            folderId: repositories.listFolders()[0].id,
            title: "Cross-origin note",
            contentMd: "",
            tags: [],
          }),
        }),
      );
      assert.equal(foreignNote.status, 403);
      assert.equal(
        repositories.listNotes().some(({ title }) => title === "Cross-origin note"),
        false,
      );
    });

    await t.test("note template CRUD is independent and enforces names, size, and image safety", async () => {
      const foreign = await templateCollectionRoute.POST(
        new Request("http://localhost/api/templates", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://attacker.example",
          },
          body: JSON.stringify({ name: "Foreign", contentMd: "" }),
        }),
      );
      assert.equal(foreign.status, 403);

      const contentMd = "# Weekly review\n\n## Wins\n\n## Questions";
      const createdResponse = await templateCollectionRoute.POST(
        new Request("http://localhost/api/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Weekly Review", contentMd }),
        }),
      );
      assert.equal(createdResponse.status, 201);
      const created = (await createdResponse.json()) as { id: number; name: string; contentMd: string };
      assert.equal(created.name, "Weekly Review");
      assert.equal(created.contentMd, contentMd);

      const duplicate = await templateCollectionRoute.POST(
        new Request("http://localhost/api/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "weekly review", contentMd: "" }),
        }),
      );
      assert.equal(duplicate.status, 409);
      assert.equal(((await duplicate.json()) as { error: { code: string } }).error.code, "CONFLICT");

      const longName = await templateCollectionRoute.POST(
        new Request("http://localhost/api/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "x".repeat(121), contentMd: "" }),
        }),
      );
      assert.equal(longName.status, 400);

      for (const forbiddenContent of [
        "![Pending](esperanto-upload://draft-image)",
        "![Owned](/api/uploads/notes/00000000-0000-0000-0000-000000000000.png)",
      ]) {
        const response = await templateCollectionRoute.POST(
          new Request("http://localhost/api/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: `Forbidden ${forbiddenContent.length}`, contentMd: forbiddenContent }),
          }),
        );
        assert.equal(response.status, 400);
        assert.equal(
          ((await response.json()) as { error: { code: string } }).error.code,
          "VALIDATION",
        );
      }

      assert.throws(
        () => repositories.createNoteTemplate({
          name: "Oversized",
          contentMd: "x".repeat((10 * 1024 * 1024) + 1),
        }),
        (error: unknown) =>
          error instanceof repositories.RepositoryError && error.code === "CONTENT_TOO_LARGE",
      );

      const copiedNote = repositories.createNote({
        folderId: repositories.listFolders()[0].id,
        title: "Copied template body",
        contentMd: created.contentMd,
      });
      const updatedResponse = await templateItemRoute.PATCH(
        new Request(`http://localhost/api/templates/${created.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "WEEKLY REVIEW", contentMd: "# Changed" }),
        }),
        { params: Promise.resolve({ id: String(created.id) }) },
      );
      assert.equal(updatedResponse.status, 200);
      assert.equal(repositories.getNote(copiedNote.id)?.contentMd, contentMd);

      const listed = await templateCollectionRoute.GET();
      assert.equal(listed.status, 200);
      assert.deepEqual(
        ((await listed.json()) as Array<{ id: number }>).map(({ id }) => id),
        [created.id],
      );

      const deleted = await templateItemRoute.DELETE(
        new Request(`http://localhost/api/templates/${created.id}`, { method: "DELETE" }),
        { params: Promise.resolve({ id: String(created.id) }) },
      );
      assert.equal(deleted.status, 204);
      assert.equal(repositories.getNote(copiedNote.id)?.contentMd, contentMd);
      assert.ok(repositories.deleteNote(copiedNote.id));
    });

    await t.test("note writes enforce the 10 MiB UTF-8 Markdown limit", async () => {
      const title = "Oversized Markdown";
      const contentMd = "史".repeat(Math.floor((10 * 1024 * 1024) / 3) + 1);
      const expectedError = {
        error: {
          code: "CONTENT_TOO_LARGE",
          message: "Markdown content must not exceed 10 MiB.",
        },
      };
      const response = await noteCollectionRoute.POST(
        new Request("http://localhost/api/notes", {
          method: "POST",
          body: noteForm({
            folderId: repositories.listFolders()[0].id,
            title,
            contentMd,
            tags: [],
          }),
        }),
      );

      assert.equal(response.status, 413);
      assert.deepEqual(await response.json(), expectedError);
      assert.equal(
        repositories.listNotes().some((note) => note.title === title),
        false,
      );

      assert.throws(
        () =>
          repositories.createNote({
            folderId: repositories.listFolders()[0].id,
            title,
            contentMd,
          }),
        (error: unknown) =>
          error instanceof repositories.RepositoryError &&
          error.code === "CONTENT_TOO_LARGE",
      );

      const existing = repositories.createNote({
        folderId: repositories.listFolders()[0].id,
        title: "Existing note",
        contentMd: "Keep this content.",
      });
      const patchResponse = await noteItemRoute.PATCH(
        new Request(`http://localhost/api/notes/${existing.id}`, {
          method: "PATCH",
          body: noteForm({ contentMd }),
        }),
        { params: Promise.resolve({ id: String(existing.id) }) },
      );
      assert.equal(patchResponse.status, 413);
      assert.deepEqual(await patchResponse.json(), expectedError);
      assert.equal(repositories.getNote(existing.id)?.contentMd, "Keep this content.");
      assert.ok(repositories.deleteNote(existing.id));
    });

    await t.test("note saves reject more than 50 new images before staging", async () => {
      const title = "Too many images";
      const tokens = Array.from(
        { length: storage.NOTE_NEW_IMAGE_MAX_COUNT + 1 },
        (_, index) => `image-${index}`,
      );
      const images: ReadonlyArray<readonly [string, Buffer, string]> = tokens.map(
        (token) => [token, png, "image/png"] as const,
      );
      const before = await uploadFiles();
      const response = await noteCollectionRoute.POST(
        new Request("http://localhost/api/notes", {
          method: "POST",
          body: noteForm(
            {
              folderId: repositories.listFolders()[0].id,
              title,
              contentMd: tokens
                .map((token) => `![${token}](esperanto-upload://${token})`)
                .join("\n"),
              tags: [],
            },
            images,
          ),
        }),
      );

      assert.equal(response.status, 413);
      assert.deepEqual(await response.json(), {
        error: {
          code: "TOO_MANY_IMAGES",
          message: "A note save may include at most 50 new images.",
        },
      });
      assert.equal(
        repositories.listNotes().some((note) => note.title === title),
        false,
      );
      assert.deepEqual(await uploadFiles(), before);
    });

    await t.test("logical note save size is checked before upload bodies are read", async () => {
      const tokens = Array.from({ length: 10 }, (_, index) => `large-${index}`);
      const uploads = new Map<string, NoteImageUpload>(
        tokens.map((token) => [
          token,
          {
            type: "image/png",
            size: storage.NOTE_IMAGE_MAX_BYTES,
            async arrayBuffer(): Promise<ArrayBuffer> {
              throw new Error("Aggregate limits must be checked before reading uploads.");
            },
          },
        ]),
      );
      const contentMd = tokens
        .map((token) => `![${token}](esperanto-upload://${token})`)
        .join("\n");
      const before = await uploadFiles();

      await assert.rejects(
        storage.stageNoteImages(contentMd, uploads),
        (error: unknown) =>
          error instanceof storage.ImageStorageError &&
          error.code === "REQUEST_TOO_LARGE",
      );
      assert.deepEqual(await uploadFiles(), before);
    });

    await t.test("wire size is rejected before multipart parsing", async () => {
      let formDataCalled = false;
      const request = {
        headers: new Headers({
          "Content-Length": String(160 * 1024 * 1024 + 1),
        }),
        async formData(): Promise<FormData> {
          formDataCalled = true;
          throw new Error("Multipart parsing must not run for a trusted oversized body.");
        },
      } as Request;

      await assert.rejects(
        httpRequest.readNoteMultipart(request),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          (error as { code: string }).code === "REQUEST_TOO_LARGE",
      );
      assert.equal(formDataCalled, false);

      let invalidHeaderParsed = false;
      const parsed = await httpRequest.readNoteMultipart({
        headers: new Headers({ "Content-Length": "not-a-decimal-length" }),
        async formData(): Promise<FormData> {
          invalidHeaderParsed = true;
          return noteForm({});
        },
      } as Request);
      assert.equal(invalidHeaderParsed, true);
      assert.deepEqual(parsed.payload, {});
      assert.equal(parsed.uploads.size, 0);

      for (const contentLength of [undefined, "1", "not-a-decimal-length"]) {
        const headers = new Headers({
          "Content-Type": "multipart/form-data; boundary=esperanto-test",
        });
        if (contentLength !== undefined) {
          headers.set("Content-Length", contentLength);
        }
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Uint8Array.from([0x01, 0x02]));
            controller.enqueue(Uint8Array.from([0x03, 0x04]));
          },
        });

        await assert.rejects(
          httpRequest.readNoteMultipart({ headers, body } as Request, 3),
          (error: unknown) =>
            error instanceof Error &&
            "code" in error &&
            (error as { code: string }).code === "REQUEST_TOO_LARGE",
        );
      }
    });

    await t.test("final Markdown expansion cannot exceed the logical save limit", async () => {
      const largePng = Buffer.alloc(storage.NOTE_IMAGE_MAX_BYTES, 0);
      png.copy(largePng);
      const mediumPng = Buffer.alloc(1024 * 1024, 0);
      png.copy(mediumPng);
      const uploads = new Map<string, NoteImageUpload>();
      for (let index = 0; index < 9; index += 1) {
        uploads.set(`large-${index}`, upload(largePng, "image/png"));
      }
      uploads.set("medium", upload(mediumPng, "image/png"));

      const placeholders = [...uploads.keys()]
        .map((token) => `![${token}](esperanto-upload://${token})`)
        .join("\n");
      const targetContentBytes =
        storage.NOTE_SAVE_MAX_BYTES -
        9 * storage.NOTE_IMAGE_MAX_BYTES -
        mediumPng.byteLength;
      const contentMd =
        placeholders + "x".repeat(targetContentBytes - placeholders.length);
      const before = await uploadFiles();

      await assert.rejects(
        storage.stageNoteImages(contentMd, uploads),
        (error: unknown) =>
          error instanceof storage.ImageStorageError &&
          error.code === "REQUEST_TOO_LARGE",
      );
      assert.deepEqual(await uploadFiles(), before);
      assert.deepEqual(await stagingContents(), []);
    });

    await t.test("invalid note business data does not read or persist uploads", async () => {
      let uploadRead = false;
      const before = await uploadFiles();
      const body = multipartLike(
        {
          folderId: 999_999,
          title: "Missing folder",
          contentMd: "![image](esperanto-upload://image)",
          tags: [],
        },
        "image",
        {
          type: "image/png",
          size: png.byteLength,
          async arrayBuffer(): Promise<ArrayBuffer> {
            uploadRead = true;
            return Uint8Array.from(png).buffer;
          },
        },
      );
      const response = await noteCollectionRoute.POST(
        {
          url: "http://localhost/api/notes",
          headers: new Headers(),
          formData: async () => body,
        } as unknown as Request,
      );

      assert.equal(response.status, 404);
      assert.equal(uploadRead, false);
      assert.deepEqual(await uploadFiles(), before);

      const existing = repositories.createNote({
        folderId: repositories.listFolders()[0].id,
        title: "Prevalidated patch",
        contentMd: "unchanged",
      });
      const patchBody = multipartLike(
        {
          folderId: 999_999,
          contentMd: "![image](esperanto-upload://image)",
        },
        "image",
        {
          type: "image/png",
          size: png.byteLength,
          async arrayBuffer(): Promise<ArrayBuffer> {
            uploadRead = true;
            return Uint8Array.from(png).buffer;
          },
        },
      );
      const patchResponse = await noteItemRoute.PATCH(
        {
          url: `http://localhost/api/notes/${existing.id}`,
          headers: new Headers(),
          formData: async () => patchBody,
        } as unknown as Request,
        { params: Promise.resolve({ id: String(existing.id) }) },
      );
      assert.equal(patchResponse.status, 404);
      assert.equal(uploadRead, false);
      assert.equal(repositories.getNote(existing.id)?.contentMd, "unchanged");
      assert.deepEqual(await uploadFiles(), before);
      assert.ok(repositories.deleteNote(existing.id));
    });

    await t.test("notes support nested pages and expose parentId through the API", async () => {
      const history = repositories.listFolders()[0];
      const parentResponse = await noteCollectionRoute.POST(
        new Request("http://localhost/api/notes", {
          method: "POST",
          body: noteForm({
            folderId: history.id,
            parentId: null,
            title: "Parent page",
            contentMd: "",
            tags: [],
          }),
        }),
      );
      assert.equal(parentResponse.status, 201);
      const parent = (await parentResponse.json()) as { id: number; parentId: number | null };
      assert.equal(parent.parentId, null);

      const childResponse = await noteCollectionRoute.POST(
        new Request("http://localhost/api/notes", {
          method: "POST",
          body: noteForm({
            folderId: history.id,
            parentId: parent.id,
            title: "Child page",
            contentMd: "",
            tags: [],
          }),
        }),
      );
      assert.equal(childResponse.status, 201);
      const child = (await childResponse.json()) as { id: number; parentId: number | null };
      assert.equal(child.parentId, parent.id);
      assert.equal(repositories.getNote(child.id)?.parentId, parent.id);
    });

    await t.test("note hierarchy rejects cycles, moves subtrees, and protects parents", async () => {
      const [history, literature] = repositories.listFolders();
      const root = repositories.createNote({
        folderId: history.id,
        title: "Movable root",
      });
      const child = repositories.createNote({
        folderId: history.id,
        parentId: root.id,
        title: "Movable child",
      });
      const grandchild = repositories.createNote({
        folderId: history.id,
        parentId: child.id,
        title: "Movable grandchild",
      });

      assert.throws(
        () => repositories.updateNote(root.id, { parentId: grandchild.id }),
        (error: unknown) =>
          error instanceof repositories.RepositoryError && error.code === "CONFLICT",
      );
      assert.throws(
        () => repositories.createNote({
          folderId: literature.id,
          parentId: root.id,
          title: "Wrong-folder child",
        }),
        (error: unknown) =>
          error instanceof repositories.RepositoryError && error.code === "CONFLICT",
      );

      const leaf = repositories.createNote({
        folderId: history.id,
        parentId: root.id,
        title: "Movable leaf",
      });
      const movedLeaf = repositories.updateNote(leaf.id, {
        folderId: literature.id,
      }).note;
      assert.equal(movedLeaf.parentId, null);
      assert.equal(movedLeaf.folderId, literature.id);

      const moved = repositories.updateNote(child.id, { folderId: literature.id }).note;
      assert.equal(moved.parentId, null);
      assert.equal(moved.folderId, literature.id);
      assert.equal(repositories.getNote(grandchild.id)?.folderId, literature.id);
      assert.equal(repositories.getNote(grandchild.id)?.parentId, child.id);

      assert.throws(
        () => repositories.deleteNote(child.id),
        (error: unknown) =>
          error instanceof repositories.RepositoryError && error.code === "NOT_EMPTY",
      );
      const deleteResponse = await noteItemRoute.DELETE(
        new Request(`http://localhost/api/notes/${child.id}`, { method: "DELETE" }),
        { params: Promise.resolve({ id: String(child.id) }) },
      );
      assert.equal(deleteResponse.status, 409);
      assert.equal((await deleteResponse.json() as { error: { code: string } }).error.code, "NOT_EMPTY");
    });

    await t.test("notes support recursive listing, moving, normalized tags, and search", () => {
      const history = repositories.listFolders()[0];
      const ancientRome = repositories.listFolders().find(
        ({ name }) => name === "Ancient Rome",
      );
      assert.ok(ancientRome);
      const note = repositories.createNote({
        folderId: ancientRome.id,
        title: "The Twelve Tables",
        contentMd: "这是一份关于古罗马十二表法的历史记录。",
        tags: [" Roman law ", "roman law", "Vocabulary"],
      });
      assert.deepEqual(note.tags, ["Roman law", "Vocabulary"]);
      assert.ok(repositories.listNotes(history.id).some(({ id }) => id === note.id));
      assert.equal(repositories.searchNotes("古罗马").notes[0]?.id, note.id);
      assert.equal(repositories.searchNotes("vocabulary").notes[0]?.id, note.id);
      assert.deepEqual(repositories.searchNotes("   "), {
        notes: [],
        total: 0,
        limit: 50,
        offset: 0,
      });

      const literature = repositories.listFolders()[1];
      const moved = repositories.updateNote(note.id, { folderId: literature.id }).note;
      assert.equal(moved.folderId, literature.id);
      assert.throws(
        () => repositories.deleteFolder(literature.id),
        (error: unknown) =>
          error instanceof repositories.RepositoryError && error.code === "NOT_EMPTY",
      );
    });

    await t.test("search ranks an exact title above a newer body-only match", () => {
      const folderId = repositories.listFolders()[0].id;
      const query = "Esperanto search tracer alpha";
      const exactTitle = repositories.createNote({ folderId, title: query });
      const bodyOnly = repositories.createNote({
        folderId,
        title: "Newer Esperanto body result",
        contentMd: `This note contains ${query} in its body.`,
      });

      const result = repositories.searchNotes(query);

      assert.deepEqual(result.notes.map(({ id }) => id), [exactTitle.id, bodyOnly.id]);
      assert.deepEqual(result.notes[0]?.match.matchedFields, ["title"]);
      assert.equal(result.notes[0]?.match.snippet.field, "title");
      assert.deepEqual(result.notes[1]?.match.matchedFields, ["content"]);

      const emojiPrefix = repositories.createNote({
        folderId,
        title: "😀😀😀needle",
      });
      const asciiPrefix = repositories.createNote({
        folderId,
        title: "xxxxxneedle",
      });
      assert.deepEqual(
        repositories.searchNotes("needle").notes
          .filter(({ id }) => id === emojiPrefix.id || id === asciiPrefix.id)
          .map(({ id }) => id),
        [emojiPrefix.id, asciiPrefix.id],
      );
    });

    await t.test("search paginates globally ranked results and keeps its index synchronized", () => {
      const folderId = repositories.listFolders()[0].id;
      const query = "esperanto-page-index-needle";
      const first = repositories.createNote({ folderId, title: query });
      const second = repositories.createNote({
        folderId,
        title: `Prefix ${query}`,
      });
      const third = repositories.createNote({
        folderId,
        title: "Body result",
        contentMd: query,
      });

      const firstPage = repositories.searchNotes(query, { limit: 1, offset: 0 });
      const secondPage = repositories.searchNotes(query, { limit: 1, offset: 1 });
      assert.equal(firstPage.total, 3);
      assert.deepEqual(firstPage.notes.map(({ id }) => id), [first.id]);
      assert.deepEqual(secondPage.notes.map(({ id }) => id), [second.id]);

      const later = repositories.createNote({ folderId, title: "Not indexed yet" });
      repositories.updateNote(later.id, { title: `Updated ${query}` });
      assert.equal(
        repositories.searchNotes(query).notes.some(({ id }) => id === later.id),
        true,
      );
      repositories.deleteNote(third.id);
      assert.equal(repositories.searchNotes(query).total, 3);
    });

    await t.test("search API returns safe match details without full bodies", async () => {
      const folderId = repositories.listFolders()[0].id;
      const query = "esperanto-api-C++-needle";
      const note = repositories.createNote({
        folderId,
        title: "Esperanto API search contract",
        contentMd: `Private full body containing ${query}.`,
        tags: [`tag-${query}`],
      });
      const response = await searchRoute.GET(
        new Request(`http://localhost/api/search?q=${encodeURIComponent(query)}`),
      );

      assert.equal(response.status, 200);
      const payload = await response.json() as {
        notes: Array<Record<string, unknown> & { id: number; match: Record<string, unknown> }>;
      };
      const result = payload.notes.find(({ id }) => id === note.id);
      assert.ok(result);
      assert.ok(result.match);
      assert.equal("contentMd" in result, false);
      assert.equal("score" in result, false);
      assert.equal("rank" in result, false);
    });

    await t.test("search ranks decoded tags without counting JSON escapes", () => {
      const folderId = repositories.listFolders()[0].id;
      const fourBackslashes = repositories.createNote({
        folderId,
        title: "Esperanto four backslashes",
        tags: [String.raw`a\b\c\d\e`],
      });
      const threeBackslashes = repositories.createNote({
        folderId,
        title: "Esperanto three backslashes",
        tags: [String.raw`a\b\c\d`],
      });

      const results = repositories.searchNotes("\\").notes;
      assert.deepEqual(
        results
          .filter(({ id }) => id === fourBackslashes.id || id === threeBackslashes.id)
          .map(({ id }) => id),
        [fourBackslashes.id, threeBackslashes.id],
      );
      assert.equal(
        results
          .find(({ id }) => id === fourBackslashes.id)
          ?.match.tags[0]?.parts.filter(({ highlighted }) => highlighted).length,
        4,
      );

      const storedOnly = repositories.searchNotes("[").notes.find(
        ({ id }) => id === fourBackslashes.id,
      );
      assert.deepEqual(storedOnly?.match.matchedFields, ["tags"]);
      assert.deepEqual(storedOnly?.match.snippet, {
        field: "tags",
        parts: [{ text: "Tag data match", highlighted: false }],
        truncatedStart: false,
        truncatedEnd: false,
      });
    });

    await t.test("wikilink indexes, APIs, and lifecycle stay deterministic", async () => {
      const folderId = repositories.listFolders()[0].id;
      const firstTarget = repositories.createNote({
        folderId,
        title: "M3 Wiki Target",
      });
      const secondTarget = repositories.createNote({
        folderId,
        title: "M3   WIKI target",
      });
      assert.ok(firstTarget.id < secondTarget.id);

      const source = repositories.createNote({
        folderId,
        title: "Link Source M3",
        contentMd: [
          "[[ M3   wiki TARGET |Primary alias]] and [[m3 wiki target]]",
          "[[M3 Missing Target]]",
          "`[[M3 Inline Hidden]]`",
          "```md",
          "[[M3 Fence Hidden]]",
          "```",
        ].join("\r\n"),
      });
      const expectedLinks = [
        { titleKey: "m3 missing target", targetId: null },
        { titleKey: "m3 wiki target", targetId: firstTarget.id },
      ];
      assert.deepEqual(source.links, expectedLinks);
      assert.deepEqual(repositories.listOutgoingNoteLinks(source.id), expectedLinks);

      const detailResponse = await noteItemRoute.GET(
        new Request(`http://localhost/api/notes/${source.id}`),
        { params: Promise.resolve({ id: String(source.id) }) },
      );
      assert.equal(detailResponse.status, 200);
      const detail = (await detailResponse.json()) as {
        id: number;
        links: Array<{ titleKey: string; targetId: number | null }>;
      };
      assert.equal(detail.id, source.id);
      assert.deepEqual(detail.links, expectedLinks);

      const backlinksResponse = await noteBacklinksRoute.GET(
        new Request(`http://localhost/api/notes/${firstTarget.id}/backlinks`),
        { params: Promise.resolve({ id: String(firstTarget.id) }) },
      );
      assert.equal(backlinksResponse.status, 200);
      assert.deepEqual(await backlinksResponse.json(), [
        { id: source.id, title: source.title, folderId },
      ]);
      assert.deepEqual(repositories.listBacklinks(secondTarget.id), []);

      const titlesResponse = await noteTitlesRoute.GET(
        new Request("http://localhost/api/notes/titles?q=m3&limit=10"),
      );
      assert.equal(titlesResponse.status, 200);
      const titles = (await titlesResponse.json()) as Array<{ id: number; title: string }>;
      assert.deepEqual(
        new Set(titles.map(({ id }) => id)),
        new Set([firstTarget.id, secondTarget.id]),
      );
      const limitedTitles = await noteTitlesRoute.GET(
        new Request("http://localhost/api/notes/titles?q=m3&limit=1"),
      );
      assert.equal(limitedTitles.status, 200);
      assert.equal(((await limitedTitles.json()) as unknown[]).length, 1);

      repositories.updateNote(firstTarget.id, { title: "M3 Alternate Target" });
      assert.deepEqual(repositories.listOutgoingNoteLinks(source.id), [
        expectedLinks[0],
        { titleKey: "m3 wiki target", targetId: secondTarget.id },
      ]);

      repositories.updateNote(firstTarget.id, { title: "M3 Wiki Target" });
      assert.equal(
        repositories.listOutgoingNoteLinks(source.id)[1]?.targetId,
        firstTarget.id,
      );

      repositories.deleteNote(firstTarget.id);
      assert.equal(
        repositories.listOutgoingNoteLinks(source.id)[1]?.targetId,
        secondTarget.id,
      );

      repositories.updateNote(secondTarget.id, { title: "M3 Renamed Target" });
      assert.equal(repositories.listOutgoingNoteLinks(source.id)[1]?.targetId, null);

      repositories.updateNote(secondTarget.id, { title: "M3 Wiki Target" });
      assert.equal(
        repositories.listOutgoingNoteLinks(source.id)[1]?.targetId,
        secondTarget.id,
      );

      repositories.deleteNote(secondTarget.id);
      assert.equal(repositories.listOutgoingNoteLinks(source.id)[1]?.targetId, null);
      const replacement = repositories.createNote({
        folderId,
        title: "m3 wiki target",
      });
      assert.equal(
        repositories.listOutgoingNoteLinks(source.id)[1]?.targetId,
        replacement.id,
      );

      const firstRebuild = repositories.rebuildAllNoteLinks();
      assert.deepEqual(firstRebuild, {
        sources: repositories.listNotes().length,
        links: 2,
        unresolved: [
          {
            sourceId: source.id,
            sourceTitle: source.title,
            targetTitleKey: "m3 missing target",
          },
        ],
      });
      assert.deepEqual(repositories.rebuildAllNoteLinks(), firstRebuild);

      repositories.deleteNote(source.id);
      assert.deepEqual(repositories.listOutgoingNoteLinks(source.id), []);
      assert.deepEqual(repositories.listBacklinks(replacement.id), []);

      const missingBacklinks = await noteBacklinksRoute.GET(
        new Request("http://localhost/api/notes/999999/backlinks"),
        { params: Promise.resolve({ id: "999999" }) },
      );
      assert.equal(missingBacklinks.status, 404);
    });

    await t.test("title suggestions use escaped SQL prefixes and bounded results", () => {
      const folderId = repositories.listFolders()[0].id;
      const literal = repositories.createNote({
        folderId,
        title: "M3 %_ literal prefix",
      });
      repositories.createNote({
        folderId,
        title: "Before M3 %_ literal prefix",
      });
      const slash = repositories.createNote({
        folderId,
        title: "M3 slash\\ literal prefix",
      });
      const unicode = repositories.createNote({
        folderId,
        title: "Ĉapitro   Du",
      });

      assert.deepEqual(repositories.listNoteTitles("m3 %_", 20), [
        { id: literal.id, title: literal.title },
      ]);
      assert.deepEqual(repositories.listNoteTitles("m3 slash\\", 20), [
        { id: slash.id, title: slash.title },
      ]);
      assert.deepEqual(repositories.listNoteTitles("ĉa", 20), [
        { id: unicode.id, title: unicode.title },
      ]);
      assert.deepEqual(repositories.listNoteTitles("ĉapitro du", 20), [
        { id: unicode.id, title: unicode.title },
      ]);
      assert.equal(repositories.listNoteTitles("", 1).length, 1);
    });

    await t.test("wikilink replacement and write failures are atomic", () => {
      const folderId = repositories.listFolders()[1].id;
      const targetA = repositories.createNote({
        folderId,
        title: "M3 Atomic Target A",
      });
      const targetB = repositories.createNote({
        folderId,
        title: "M3 Atomic Target B",
      });
      const source = repositories.createNote({
        folderId,
        title: "M3 Atomic Source",
        contentMd: "Before [[M3 Atomic Target A]]",
      });

      assert.deepEqual(repositories.listOutgoingNoteLinks(source.id), [
        { titleKey: "m3 atomic target a", targetId: targetA.id },
      ]);
      assert.deepEqual(repositories.listBacklinks(targetA.id), [
        { id: source.id, title: source.title, folderId },
      ]);

      const replaced = repositories.updateNote(source.id, {
        contentMd: "After [[M3 Atomic Target B]]",
      }).note;
      assert.deepEqual(replaced.links, [
        { titleKey: "m3 atomic target b", targetId: targetB.id },
      ]);
      assert.deepEqual(repositories.listBacklinks(targetA.id), []);
      assert.deepEqual(repositories.listBacklinks(targetB.id), [
        { id: source.id, title: source.title, folderId },
      ]);

      const triggerName = "test_note_link_insert_failure";
      const imageCountBefore = database.sqlite
        .prepare("SELECT count(*) FROM note_image")
        .pluck()
        .get();
      const noteCountBefore = repositories.listNotes().length;
      database.sqlite.exec(`
        CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON note_link
        BEGIN
          SELECT RAISE(ABORT, 'forced note_link insert failure');
        END;
      `);
      try {
        assert.throws(
          () => repositories.updateNote(
            source.id,
            { contentMd: "Failed [[M3 Atomic Target A]] ![Rollback](/api/uploads/notes/m3-update-rollback.png)" },
            ["data/uploads/notes/m3-update-rollback.png"],
          ),
          /forced note_link insert failure/,
        );
        assert.deepEqual(repositories.getNote(source.id), replaced);
        assert.deepEqual(repositories.listBacklinks(targetA.id), []);
        assert.deepEqual(repositories.listBacklinks(targetB.id), [
          { id: source.id, title: source.title, folderId },
        ]);
        assert.equal(
          database.sqlite.prepare("SELECT count(*) FROM note_image").pluck().get(),
          imageCountBefore,
        );

        assert.throws(
          () => repositories.createNote(
            {
              folderId,
              title: "M3 Failed Atomic Create",
              contentMd: "[[M3 Atomic Target A]] ![Rollback](/api/uploads/notes/m3-create-rollback.png)",
            },
            ["data/uploads/notes/m3-create-rollback.png"],
          ),
          /forced note_link insert failure/,
        );
        assert.equal(repositories.listNotes().length, noteCountBefore);
        assert.equal(
          repositories.listNotes().some(({ title }) => title === "M3 Failed Atomic Create"),
          false,
        );
        assert.equal(
          database.sqlite.prepare("SELECT count(*) FROM note_image").pluck().get(),
          imageCountBefore,
        );
      } finally {
        database.sqlite.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
      }

      repositories.deleteNote(source.id);
      repositories.deleteNote(targetA.id);
      repositories.deleteNote(targetB.id);
    });

    await t.test("partial concurrent image staging rolls back successful siblings", async () => {
      const before = await uploadFiles();
      const uploads = new Map<string, NoteImageUpload>([
        ["good", upload(png, "image/png")],
        ["bad", upload(invalidPng, "image/png")],
      ]);
      await assert.rejects(
        storage.stageNoteImages(
          "![good](esperanto-upload://good) ![bad](esperanto-upload://bad)",
          uploads,
        ),
        (error: unknown) =>
          error instanceof storage.ImageStorageError && error.code === "INVALID_CONTENT",
      );
      assert.deepEqual(await uploadFiles(), before);

      await assert.rejects(
        storage.saveNoteImage(upload(png, "image/svg+xml")),
        (error: unknown) =>
          error instanceof storage.ImageStorageError && error.code === "INVALID_TYPE",
      );
      await assert.rejects(
        storage.saveNoteImage({
          type: "image/png",
          size: storage.NOTE_IMAGE_MAX_BYTES + 1,
          async arrayBuffer() {
            throw new Error("Oversized uploads must be rejected before reading.");
          },
        }),
        (error: unknown) =>
          error instanceof storage.ImageStorageError && error.code === "FILE_TOO_LARGE",
      );
      await assert.rejects(
        storage.stageNoteImages("![missing](esperanto-upload://missing)", new Map()),
        (error: unknown) =>
          error instanceof storage.ImageStorageError && error.code === "INVALID_CONTENT",
      );
      assert.throws(
        () => storage.normalizeStoredNoteImagePath("../escape.png"),
        (error: unknown) =>
          error instanceof storage.ImageStorageError && error.code === "INVALID_PATH",
      );
    });

    await t.test("all image signatures support quarantine restore and finalize", async () => {
      const imagePaths = await Promise.all([
        storage.saveNoteImage(upload(jpeg, "image/jpeg")),
        storage.saveNoteImage(upload(gif, "image/gif")),
        storage.saveNoteImage(upload(webp, "image/webp")),
      ]);
      const expectedTypes = ["image/jpeg", "image/gif", "image/webp"];
      for (const [index, imagePath] of imagePaths.entries()) {
        assert.equal((await storage.readNoteImage(imagePath)).contentType, expectedTypes[index]);
      }

      const quarantine = await storage.quarantineNoteImages(imagePaths);
      for (const imagePath of imagePaths) {
        await assert.rejects(storage.readNoteImage(imagePath), { code: "NOT_FOUND" });
      }
      await storage.restoreQuarantinedNoteImages(quarantine);
      for (const imagePath of imagePaths) {
        assert.ok((await storage.readNoteImage(imagePath)).size > 0);
      }
      assert.deepEqual(await stagingContents(), []);

      const finalized = await storage.quarantineNoteImages(imagePaths);
      await storage.finalizeQuarantinedNoteImages(finalized);
      for (const imagePath of imagePaths) {
        await assert.rejects(storage.readNoteImage(imagePath), { code: "NOT_FOUND" });
      }
      const missing = await storage.quarantineNoteImages([
        "data/uploads/notes/already-missing.png",
      ]);
      assert.deepEqual(missing.entries, []);
      await storage.finalizeQuarantinedNoteImages(missing);
      assert.deepEqual(await stagingContents(), []);
    });

    await t.test("storage recovery restores owned quarantine and removes only generated orphans", async () => {
      const folderId = repositories.listFolders()[0].id;
      const staged = await storage.stageNoteImages(
        "![Recovered](esperanto-upload://recovered)",
        new Map([["recovered", upload(png, "image/png")]]),
      );
      const note = repositories.createNote(
        {
          folderId,
          title: "Crash recovery",
          contentMd: staged.contentMd,
          tags: [],
        },
        staged.imagePaths,
      );
      await storage.quarantineNoteImages(staged.imagePaths);
      await assert.rejects(storage.readNoteImage(staged.imagePaths[0]), {
        code: "NOT_FOUND",
      });

      await storage.recoverNoteImageStorage();

      assert.deepEqual((await storage.readNoteImage(staged.imagePaths[0])).data, png);
      assert.deepEqual(await stagingContents(), []);

      const orphanPath = await storage.saveNoteImage(upload(png, "image/png"));
      const arbitraryPath = path.join(uploadDirectory, "personal.png");
      await writeFile(arbitraryPath, png);
      await storage.recoverNoteImageStorage();

      await assert.rejects(storage.readNoteImage(orphanPath), { code: "NOT_FOUND" });
      assert.deepEqual(await storage.readNoteImage("personal.png"), {
        data: png,
        contentType: "image/png",
        fileName: "personal.png",
        imagePath: "data/uploads/notes/personal.png",
        size: png.byteLength,
      });

      const deleted = await noteItemRoute.DELETE(
        new Request(`http://localhost/api/notes/${note.id}`, { method: "DELETE" }),
        { params: Promise.resolve({ id: String(note.id) }) },
      );
      assert.equal(deleted.status, 204);
    });

    await t.test("image mutation lock preserves the full critical-section order", async () => {
      const events: string[] = [];
      let signalFirstStarted!: () => void;
      let releaseFirst!: () => void;
      const firstStarted = new Promise<void>((resolve) => {
        signalFirstStarted = resolve;
      });
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      const first = storage.withNoteImageMutationLock(async () => {
        events.push("first-start");
        signalFirstStarted();
        await firstGate;
        events.push("first-end");
      });
      await firstStarted;
      const second = storage.withNoteImageMutationLock(async () => {
        events.push("second-start");
      });
      await Promise.resolve();
      assert.deepEqual(events, ["first-start"]);

      releaseFirst();
      await Promise.all([first, second]);
      assert.deepEqual(events, ["first-start", "first-end", "second-start"]);
    });

    await t.test("storage recovery waits for an active image mutation", async () => {
      let signalMutationStarted!: () => void;
      let releaseMutation!: () => void;
      const mutationStarted = new Promise<void>((resolve) => {
        signalMutationStarted = resolve;
      });
      const mutationGate = new Promise<void>((resolve) => {
        releaseMutation = resolve;
      });

      const mutation = storage.withNoteImageMutationLock(async () => {
        signalMutationStarted();
        await mutationGate;
      });
      await mutationStarted;
      let recoveryEntered = false;
      const recovery = storage.recoverNoteImageStorage(async () => {
        recoveryEntered = true;
      });
      await Promise.resolve();
      assert.equal(recoveryEntered, false);

      releaseMutation();
      await Promise.all([mutation, recovery]);
      assert.equal(recoveryEntered, true);
    });

    await t.test("multipart API rolls back partial and database failures", async () => {
      const literature = repositories.listFolders().find(
        ({ name }) => name === "Grammar",
      );
      assert.ok(literature);
      const folderId = literature.id;
      const before = await uploadFiles();
      const partial = noteForm(
        {
          folderId,
          title: "Bad pair",
          contentMd:
            "![good](esperanto-upload://good) ![bad](esperanto-upload://bad)",
          tags: [],
        },
        [
          ["good", png, "image/png"],
          ["bad", invalidPng, "image/png"],
        ],
      );
      const partialResponse = await noteCollectionRoute.POST(
        new Request("http://localhost/api/notes", { method: "POST", body: partial }),
      );
      assert.equal(partialResponse.status, 400);
      assert.deepEqual(await uploadFiles(), before);

      const missingFolder = noteForm(
        {
          folderId: 999_999,
          title: "Rollback",
          contentMd: "![image](esperanto-upload://one)",
          tags: [],
        },
        [["one", png, "image/png"]],
      );
      const missingResponse = await noteCollectionRoute.POST(
        new Request("http://localhost/api/notes", {
          method: "POST",
          body: missingFolder,
        }),
      );
      assert.equal(missingResponse.status, 404);
      assert.deepEqual(await uploadFiles(), before);
    });

    await t.test("managed image lifecycle enforces ownership and cleans files", async () => {
      const literature = repositories.listFolders().find(
        ({ name }) => name === "Grammar",
      );
      assert.ok(literature);
      const folderId = literature.id;
      const createForm = noteForm(
        {
          folderId,
          title: "Illustrated note",
          contentMd: "![Tiny](esperanto-upload://tiny)",
          tags: ["Image"],
        },
        [["tiny", png, "image/png"]],
      );
      const createdResponse = await noteCollectionRoute.POST(
        new Request("http://localhost/api/notes", { method: "POST", body: createForm }),
      );
      assert.equal(createdResponse.status, 201);
      const created = (await createdResponse.json()) as {
        id: number;
        contentMd: string;
      };
      const fileName = /\/api\/uploads\/notes\/([A-Za-z0-9.-]+)/.exec(
        created.contentMd,
      )?.[1];
      assert.ok(fileName);

      const managedPath = `data/uploads/notes/${fileName}`;
      assert.deepEqual(
        [...storage.managedImagePathsInMarkdown([
          `![Root](/api/uploads/notes/${fileName})`,
          `![Relative](api/uploads/notes/${fileName})`,
          `![Parent](../api/uploads/notes/${fileName})`,
          `![Angle](</api/uploads/notes/${fileName}> "title")`,
          `![Reference][asset]`,
          `[asset]: /api/uploads/notes/${fileName} "reference title"`,
        ].join("\n"))],
        [managedPath],
      );
      assert.deepEqual(
        [...storage.managedImagePathsInMarkdown([
          `Plain prose /api/uploads/notes/${fileName}`,
          `![External](https://example.com/api/uploads/notes/${fileName})`,
          `\`![Code](/api/uploads/notes/${fileName})\``,
          `\\[Escaped](/api/uploads/notes/${fileName})`,
          `[unused]: /api/uploads/notes/${fileName}`,
        ].join("\n"))],
        [],
      );

      const served = await uploadRoute.GET(
        new Request(`http://localhost/api/uploads/notes/${fileName}`),
        { params: Promise.resolve({ filename: fileName }) },
      );
      assert.equal(served.status, 200);
      assert.equal(served.headers.get("content-type"), "image/png");
      assert.deepEqual(Buffer.from(await served.arrayBuffer()), png);

      const copiedUrl = noteForm({
        folderId,
        title: "Image thief",
        contentMd: `![Copied](/api/uploads/notes/${fileName})`,
        tags: [],
      });
      const copiedResponse = await noteCollectionRoute.POST(
        new Request("http://localhost/api/notes", { method: "POST", body: copiedUrl }),
      );
      assert.equal(copiedResponse.status, 409);

      const relativeCopy = noteForm({
        folderId,
        title: "Relative image thief",
        contentMd: `![Copied](api/uploads/notes/${fileName})`,
        tags: [],
      });
      const relativeCopyResponse = await noteCollectionRoute.POST(
        new Request("http://localhost/api/notes", { method: "POST", body: relativeCopy }),
      );
      assert.equal(relativeCopyResponse.status, 409);

      assert.deepEqual(
        [...storage.managedImagePathsInMarkdown(
          `![External](https://example.com/api/uploads/notes/${fileName})`,
        )],
        [],
      );

      const foreignPatchResponse = await noteItemRoute.PATCH(
        new Request(`http://localhost/api/notes/${created.id}`, {
          method: "PATCH",
          headers: { Origin: "https://attacker.example" },
          body: noteForm({ contentMd: "Should not be saved." }),
        }),
        { params: Promise.resolve({ id: String(created.id) }) },
      );
      assert.equal(foreignPatchResponse.status, 403);
      const foreignDeleteResponse = await noteItemRoute.DELETE(
        new Request(`http://localhost/api/notes/${created.id}`, {
          method: "DELETE",
          headers: { Origin: "https://attacker.example" },
        }),
        { params: Promise.resolve({ id: String(created.id) }) },
      );
      assert.equal(foreignDeleteResponse.status, 403);

      const rollbackPatch = noteForm({
        contentMd: "![Foreign](/api/uploads/notes/not-owned.png)",
      });
      const rollbackResponse = await noteItemRoute.PATCH(
        new Request(`http://localhost/api/notes/${created.id}`, {
          method: "PATCH",
          body: rollbackPatch,
        }),
        { params: Promise.resolve({ id: String(created.id) }) },
      );
      assert.equal(rollbackResponse.status, 409);
      assert.equal(repositories.getNote(created.id)?.contentMd, created.contentMd);
      assert.deepEqual((await storage.readNoteImage(fileName)).data, png);
      assert.deepEqual(await stagingContents(), []);

      const removeImage = noteForm({ contentMd: "The image was removed." });
      const updatedResponse = await noteItemRoute.PATCH(
        new Request(`http://localhost/api/notes/${created.id}`, {
          method: "PATCH",
          body: removeImage,
        }),
        { params: Promise.resolve({ id: String(created.id) }) },
      );
      assert.equal(updatedResponse.status, 200);
      assert.deepEqual(repositories.listNoteImagePaths(created.id), []);
      assert.deepEqual(await stagingContents(), []);
      await assert.rejects(
        storage.readNoteImage(fileName),
        (error: unknown) =>
          error instanceof storage.ImageStorageError && error.code === "NOT_FOUND",
      );

      const traversal = await uploadRoute.GET(
        new Request("http://localhost/api/uploads/notes/traversal"),
        { params: Promise.resolve({ filename: "../secret.png" }) },
      );
      assert.equal(traversal.status, 400);

      const deleteResponse = await noteItemRoute.DELETE(
        new Request(`http://localhost/api/notes/${created.id}`, { method: "DELETE" }),
        { params: Promise.resolve({ id: String(created.id) }) },
      );
      assert.equal(deleteResponse.status, 204);
      assert.equal(repositories.getNote(created.id), null);
    });

    await t.test("deleting a note quarantines and finalizes its owned image", async () => {
      const literature = repositories.listFolders().find(
        ({ name }) => name === "Grammar",
      );
      assert.ok(literature);
      const folderId = literature.id;
      const response = await noteCollectionRoute.POST(
        new Request("http://localhost/api/notes", {
          method: "POST",
          body: noteForm(
            {
              folderId,
              title: "Delete with image",
              contentMd: "![Delete](esperanto-upload://delete)",
              tags: [],
            },
            [["delete", png, "image/png"]],
          ),
        }),
      );
      assert.equal(response.status, 201);
      const created = (await response.json()) as { id: number; contentMd: string };
      const fileName = /\/api\/uploads\/notes\/([A-Za-z0-9.-]+)/.exec(
        created.contentMd,
      )?.[1];
      assert.ok(fileName);

      const deleted = await noteItemRoute.DELETE(
        new Request(`http://localhost/api/notes/${created.id}`, { method: "DELETE" }),
        { params: Promise.resolve({ id: String(created.id) }) },
      );
      assert.equal(deleted.status, 204);
      assert.equal(repositories.getNote(created.id), null);
      await assert.rejects(storage.readNoteImage(fileName), { code: "NOT_FOUND" });
      assert.deepEqual(await stagingContents(), []);
    });
});

function upload(data: Buffer, type: string): NoteImageUpload {
  return {
    type,
    size: data.byteLength,
    async arrayBuffer() {
      return Uint8Array.from(data).buffer;
    },
  };
}

function noteForm(
  payload: Record<string, unknown>,
  images: ReadonlyArray<readonly [string, Buffer, string]> = [],
): FormData {
  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  for (const [token, data, type] of images) {
    form.append(
      `image:${token}`,
      new Blob([Uint8Array.from(data)], { type }),
      `${token}.png`,
    );
  }
  return form;
}

function multipartLike(
  payload: Record<string, unknown>,
  token: string,
  image: NoteImageUpload,
): FormData {
  const entries: ReadonlyArray<readonly [string, string | NoteImageUpload]> = [
    ["payload", JSON.stringify(payload)],
    [`image:${token}`, image],
  ];
  return {
    getAll(field: string): Array<string | NoteImageUpload> {
      return entries.filter(([name]) => name === field).map(([, value]) => value);
    },
    entries(): IterableIterator<[string, FormDataEntryValue]> {
      return entries[Symbol.iterator]() as IterableIterator<[
        string,
        FormDataEntryValue,
      ]>;
    },
  } as unknown as FormData;
}

async function uploadFiles(): Promise<string[]> {
  await mkdir(uploadDirectory, { recursive: true });
  return (await readdir(uploadDirectory)).sort();
}

async function stagingContents(): Promise<string[]> {
  try {
    return (await readdir(path.join(uploadDirectory, ".staging"))).sort();
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}
