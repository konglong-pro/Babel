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
let uploadRoute: typeof UploadRoute;

before(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "herodotus-test-"));
  uploadDirectory = path.join(temporaryRoot, "uploads");
  process.env.HERODOTUS_DATABASE_PATH = path.join(temporaryRoot, "sqlite.db");
  process.env.HERODOTUS_UPLOAD_DIRECTORY = uploadDirectory;
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

test("Herodotus backend integration", async (t) => {
    await t.test("migration seeds the two editable root folders in order", () => {
      assert.deepEqual(
        repositories.listFolders().map(({ name, parentId }) => ({ name, parentId })),
        [
          { name: "History", parentId: null },
          { name: "Literature", parentId: null },
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
            Origin: "http://localhost",
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
                .map((token) => `![${token}](herodotus-upload://${token})`)
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
        .map((token) => `![${token}](herodotus-upload://${token})`)
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
          "Content-Type": "multipart/form-data; boundary=herodotus-test",
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
        .map((token) => `![${token}](herodotus-upload://${token})`)
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
          contentMd: "![image](herodotus-upload://image)",
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
          contentMd: "![image](herodotus-upload://image)",
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
        tags: [" Roman law ", "roman law", "History"],
      });
      assert.deepEqual(note.tags, ["Roman law", "History"]);
      assert.ok(repositories.listNotes(history.id).some(({ id }) => id === note.id));
      assert.equal(repositories.searchNotes("古罗马").notes[0]?.id, note.id);
      assert.equal(repositories.searchNotes("history").notes[0]?.id, note.id);
      assert.deepEqual(repositories.searchNotes("   "), { notes: [] });

      const literature = repositories.listFolders()[1];
      const moved = repositories.updateNote(note.id, { folderId: literature.id }).note;
      assert.equal(moved.folderId, literature.id);
      assert.throws(
        () => repositories.deleteFolder(literature.id),
        (error: unknown) =>
          error instanceof repositories.RepositoryError && error.code === "NOT_EMPTY",
      );
    });

    await t.test("partial concurrent image staging rolls back successful siblings", async () => {
      const before = await uploadFiles();
      const uploads = new Map<string, NoteImageUpload>([
        ["good", upload(png, "image/png")],
        ["bad", upload(invalidPng, "image/png")],
      ]);
      await assert.rejects(
        storage.stageNoteImages(
          "![good](herodotus-upload://good) ![bad](herodotus-upload://bad)",
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
        storage.stageNoteImages("![missing](herodotus-upload://missing)", new Map()),
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
        "![Recovered](herodotus-upload://recovered)",
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
        ({ name }) => name === "Literature",
      );
      assert.ok(literature);
      const folderId = literature.id;
      const before = await uploadFiles();
      const partial = noteForm(
        {
          folderId,
          title: "Bad pair",
          contentMd:
            "![good](herodotus-upload://good) ![bad](herodotus-upload://bad)",
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
          contentMd: "![image](herodotus-upload://one)",
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
        ({ name }) => name === "Literature",
      );
      assert.ok(literature);
      const folderId = literature.id;
      const createForm = noteForm(
        {
          folderId,
          title: "Illustrated note",
          contentMd: "![Tiny](herodotus-upload://tiny)",
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
        ({ name }) => name === "Literature",
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
              contentMd: "![Delete](herodotus-upload://delete)",
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
