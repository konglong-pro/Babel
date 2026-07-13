import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
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
import type * as UploadRoute from "@/app/api/uploads/notes/[filename]/route";
import type * as DatabaseModule from "@/lib/db/client";
import type * as RepositoryModule from "@/lib/repositories";
import type * as StorageModule from "@/lib/storage";
import type { NoteImageUpload } from "@/lib/storage";

let temporaryRoot = "";
let uploadDirectory = "";
let database: typeof DatabaseModule;
let repositories: typeof RepositoryModule;
let storage: typeof StorageModule;
let folderCollectionRoute: typeof FolderCollectionRoute;
let folderItemRoute: typeof FolderItemRoute;
let noteCollectionRoute: typeof NoteCollectionRoute;
let noteItemRoute: typeof NoteItemRoute;
let noteBacklinksRoute: typeof NoteBacklinksRoute;
let noteTitlesRoute: typeof NoteTitlesRoute;
let uploadRoute: typeof UploadRoute;

before(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "__APP_ID__-test-"));
  uploadDirectory = path.join(temporaryRoot, "uploads");
  process.env.__APP_ENV_PREFIX___DATABASE_PATH = path.join(temporaryRoot, "sqlite.db");
  process.env.__APP_ENV_PREFIX___UPLOAD_DIRECTORY = uploadDirectory;
  database = await import("@/lib/db/client");
  migrate(database.db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  [
    repositories,
    storage,
    folderCollectionRoute,
    folderItemRoute,
    noteCollectionRoute,
    noteItemRoute,
    noteBacklinksRoute,
    noteTitlesRoute,
    uploadRoute,
  ] =
    await Promise.all([
      import("@/lib/repositories"),
      import("@/lib/storage"),
      import("@/app/api/folders/route"),
      import("@/app/api/folders/[id]/route"),
      import("@/app/api/notes/route"),
      import("@/app/api/notes/[id]/route"),
      import("@/app/api/notes/[id]/backlinks/route"),
      import("@/app/api/notes/titles/route"),
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

test("__APP_NAME__ backend integration", async (t) => {
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
      const vocabulary = repositories.listFolders()[0];
      const verbs = repositories.createFolder({ name: "Verbs", parentId: vocabulary.id });
      const phrasal = repositories.createFolder({ name: "Phrasal", parentId: verbs.id });

      assert.throws(
        () => repositories.updateFolder(verbs.id, { parentId: phrasal.id }),
        (error: unknown) =>
          error instanceof repositories.RepositoryError && error.code === "CONFLICT",
      );
      assert.throws(
        () => repositories.deleteFolder(verbs.id),
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

    await t.test("notes support recursive listing, moving, normalized tags, and search", () => {
      const vocabulary = repositories.listFolders()[0];
      const verbs = repositories.listFolders().find(({ name }) => name === "Verbs");
      assert.ok(verbs);
      const note = repositories.createNote({
        folderId: verbs.id,
        title: "Take off",
        contentMd: "A useful phrasal verb for departure.",
        tags: [" Phrasal ", "phrasal", "Travel"],
      });
      assert.deepEqual(note.tags, ["Phrasal", "Travel"]);
      assert.ok(repositories.listNotes(vocabulary.id).some(({ id }) => id === note.id));
      assert.equal(repositories.searchNotes("departure").notes[0]?.id, note.id);
      assert.equal(repositories.searchNotes("travel").notes[0]?.id, note.id);
      assert.deepEqual(repositories.searchNotes("   "), { notes: [] });

      const grammar = repositories.listFolders()[1];
      const moved = repositories.updateNote(note.id, { folderId: grammar.id }).note;
      assert.equal(moved.folderId, grammar.id);
      assert.throws(
        () => repositories.deleteFolder(grammar.id),
        (error: unknown) =>
          error instanceof repositories.RepositoryError && error.code === "NOT_EMPTY",
      );
    });

    await t.test("notes form a guarded hierarchy and move their descendants together", () => {
      const vocabulary = repositories.listFolders()[0];
      const grammar = repositories.listFolders()[1];
      const parent = repositories.createNote({
        folderId: vocabulary.id,
        parentId: null,
        title: "Parent page",
      });
      const child = repositories.createNote({
        folderId: vocabulary.id,
        parentId: parent.id,
        title: "Child page",
      });
      const grandchild = repositories.createNote({
        folderId: vocabulary.id,
        parentId: child.id,
        title: "Grandchild page",
      });

      assert.equal(child.parentId, parent.id);
      assert.throws(
        () => repositories.updateNote(parent.id, { parentId: grandchild.id }),
        (error: unknown) =>
          error instanceof repositories.RepositoryError && error.code === "CONFLICT",
      );
      assert.throws(
        () => repositories.deleteNote(parent.id),
        (error: unknown) =>
          error instanceof repositories.RepositoryError && error.code === "NOT_EMPTY",
      );

      const moved = repositories.updateNote(parent.id, { folderId: grammar.id }).note;
      assert.equal(moved.parentId, null);
      assert.deepEqual(
        [parent.id, child.id, grandchild.id].map((id) => repositories.getNote(id)?.folderId),
        [grammar.id, grammar.id, grammar.id],
      );

      const vocabularyRoot = repositories.createNote({
        folderId: vocabulary.id,
        title: "Vocabulary root",
      });
      assert.throws(
        () => repositories.createNote({
          folderId: grammar.id,
          parentId: vocabularyRoot.id,
          title: "Cross-folder child",
        }),
        (error: unknown) =>
          error instanceof repositories.RepositoryError && error.code === "CONFLICT",
      );
      const reparented = repositories.updateNote(child.id, {
        folderId: vocabulary.id,
        parentId: vocabularyRoot.id,
      }).note;
      assert.equal(reparented.parentId, vocabularyRoot.id);
      assert.equal(repositories.getNote(grandchild.id)?.folderId, vocabulary.id);
    });

    await t.test("note routes expose parent pages and reject cyclic or non-empty mutations", async () => {
      const folderId = repositories.listFolders()[0].id;
      const parentResponse = await noteCollectionRoute.POST(
        new Request("http://localhost/api/notes", {
          method: "POST",
          body: noteForm({ folderId, parentId: null, title: "API parent" }),
        }),
      );
      assert.equal(parentResponse.status, 201);
      const parent = (await parentResponse.json()) as { id: number; parentId: number | null };
      assert.equal(parent.parentId, null);

      const childResponse = await noteCollectionRoute.POST(
        new Request("http://localhost/api/notes", {
          method: "POST",
          body: noteForm({ folderId, parentId: parent.id, title: "API child" }),
        }),
      );
      assert.equal(childResponse.status, 201);
      const child = (await childResponse.json()) as { id: number; parentId: number | null };
      assert.equal(child.parentId, parent.id);

      const cycle = await noteItemRoute.PATCH(
        new Request(`http://localhost/api/notes/${parent.id}`, {
          method: "PATCH",
          body: noteForm({ parentId: child.id }),
        }),
        { params: Promise.resolve({ id: String(parent.id) }) },
      );
      assert.equal(cycle.status, 409);

      const nonEmpty = await noteItemRoute.DELETE(
        new Request(`http://localhost/api/notes/${parent.id}`, { method: "DELETE" }),
        { params: Promise.resolve({ id: String(parent.id) }) },
      );
      assert.equal(nonEmpty.status, 409);
    });

    await t.test("wikilink indexes, APIs, and lifecycle stay deterministic", async () => {
      const folderId = repositories.listFolders()[0].id;
      const firstTarget = repositories.createNote({
        folderId,
        title: "M2 Wiki Target",
      });
      const secondTarget = repositories.createNote({
        folderId,
        title: "M2   WIKI target",
      });
      assert.ok(firstTarget.id < secondTarget.id);

      const source = repositories.createNote({
        folderId,
        title: "M2 Link Source",
        contentMd: [
          "[[ M2   wiki TARGET |Primary alias]] and [[m2 wiki target]]",
          "[[M2 Missing Target]]",
          "`[[M2 Inline Hidden]]`",
          "```md",
          "[[M2 Fence Hidden]]",
          "```",
        ].join("\r\n"),
      });
      const expectedLinks = [
        { titleKey: "m2 missing target", targetId: null },
        { titleKey: "m2 wiki target", targetId: firstTarget.id },
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
        new Request("http://localhost/api/notes/titles?q=m2%20wiki%20target&limit=10"),
      );
      assert.equal(titlesResponse.status, 200);
      const titles = (await titlesResponse.json()) as Array<{ id: number; title: string }>;
      assert.deepEqual(
        new Set(titles.map(({ id }) => id)),
        new Set([firstTarget.id, secondTarget.id]),
      );
      const limitedTitles = await noteTitlesRoute.GET(
        new Request("http://localhost/api/notes/titles?q=m2&limit=1"),
      );
      assert.equal(limitedTitles.status, 200);
      assert.equal(((await limitedTitles.json()) as unknown[]).length, 1);

      repositories.updateNote(firstTarget.id, { title: "M2 Alternate Target" });
      assert.deepEqual(repositories.listOutgoingNoteLinks(source.id), [
        expectedLinks[0],
        { titleKey: "m2 wiki target", targetId: secondTarget.id },
      ]);

      repositories.updateNote(firstTarget.id, { title: "M2 Wiki Target" });
      assert.equal(
        repositories.listOutgoingNoteLinks(source.id)[1]?.targetId,
        firstTarget.id,
      );

      repositories.deleteNote(firstTarget.id);
      assert.equal(
        repositories.listOutgoingNoteLinks(source.id)[1]?.targetId,
        secondTarget.id,
      );

      repositories.updateNote(secondTarget.id, { title: "M2 Renamed Target" });
      assert.equal(repositories.listOutgoingNoteLinks(source.id)[1]?.targetId, null);

      repositories.updateNote(secondTarget.id, { title: "M2 Wiki Target" });
      assert.equal(
        repositories.listOutgoingNoteLinks(source.id)[1]?.targetId,
        secondTarget.id,
      );

      repositories.deleteNote(secondTarget.id);
      assert.equal(repositories.listOutgoingNoteLinks(source.id)[1]?.targetId, null);
      const replacement = repositories.createNote({
        folderId,
        title: "m2 wiki target",
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
            targetTitleKey: "m2 missing target",
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

    await t.test("wikilink replacement and write failures are atomic", () => {
      const folderId = repositories.listFolders()[1].id;
      const targetA = repositories.createNote({
        folderId,
        title: "M2 Atomic Target A",
      });
      const targetB = repositories.createNote({
        folderId,
        title: "M2 Atomic Target B",
      });
      const source = repositories.createNote({
        folderId,
        title: "M2 Atomic Source",
        contentMd: "Before [[M2 Atomic Target A]]",
      });

      assert.deepEqual(repositories.listOutgoingNoteLinks(source.id), [
        { titleKey: "m2 atomic target a", targetId: targetA.id },
      ]);
      assert.deepEqual(repositories.listBacklinks(targetA.id), [
        { id: source.id, title: source.title, folderId },
      ]);

      const replaced = repositories.updateNote(source.id, {
        contentMd: "After [[M2 Atomic Target B]]",
      }).note;
      assert.deepEqual(replaced.links, [
        { titleKey: "m2 atomic target b", targetId: targetB.id },
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
            { contentMd: "Failed [[M2 Atomic Target A]] ![Rollback](/api/uploads/notes/m2-update-rollback.png)" },
            ["data/uploads/notes/m2-update-rollback.png"],
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
              title: "M2 Failed Atomic Create",
              contentMd: "[[M2 Atomic Target A]] ![Rollback](/api/uploads/notes/m2-create-rollback.png)",
            },
            ["data/uploads/notes/m2-create-rollback.png"],
          ),
          /forced note_link insert failure/,
        );
        assert.equal(repositories.listNotes().length, noteCountBefore);
        assert.equal(
          repositories.listNotes().some(({ title }) => title === "M2 Failed Atomic Create"),
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
          "![good](__APP_ID__-upload://good) ![bad](__APP_ID__-upload://bad)",
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
        storage.stageNoteImages("![missing](__APP_ID__-upload://missing)", new Map()),
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

    await t.test("multipart API rolls back partial and database failures", async () => {
      const folderId = repositories.listFolders()[2].id;
      const before = await uploadFiles();
      const partial = noteForm(
        {
          folderId,
          title: "Bad pair",
          contentMd:
            "![good](__APP_ID__-upload://good) ![bad](__APP_ID__-upload://bad)",
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
          contentMd: "![image](__APP_ID__-upload://one)",
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
      const folderId = repositories.listFolders()[2].id;
      const createForm = noteForm(
        {
          folderId,
          title: "Illustrated note",
          contentMd: "![Tiny](__APP_ID__-upload://tiny)",
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
      const folderId = repositories.listFolders()[2].id;
      const response = await noteCollectionRoute.POST(
        new Request("http://localhost/api/notes", {
          method: "POST",
          body: noteForm(
            {
              folderId,
              title: "Delete with image",
              contentMd: "![Delete](__APP_ID__-upload://delete)",
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
