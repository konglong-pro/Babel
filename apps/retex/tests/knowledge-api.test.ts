import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

let temporaryDirectory = "";
let database: typeof import("../src/lib/db/client");
let repositories: typeof import("../src/lib/repositories");
let noteImageStorage: typeof import("../src/lib/storage/note-images");
let collectionRoute: typeof import("../src/app/api/knowledge/route");
let itemRoute: typeof import("../src/app/api/knowledge/[id]/route");

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "retex-api-test-"));
  process.env.RETEX_DATABASE_PATH = path.join(temporaryDirectory, "sqlite.db");
  process.env.RETEX_NOTE_UPLOAD_DIRECTORY = path.join(temporaryDirectory, "uploads");
  database = await import("../src/lib/db/client");
  migrate(database.db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  [repositories, noteImageStorage, collectionRoute, itemRoute] = await Promise.all([
    import("../src/lib/repositories"),
    import("../src/lib/storage/note-images"),
    import("../src/app/api/knowledge/route"),
    import("../src/app/api/knowledge/[id]/route"),
  ]);
});

after(() => {
  database.sqlite.close();
  const resolved = path.resolve(temporaryDirectory);
  const temporaryRoot = path.resolve(os.tmpdir());
  assert.ok(resolved.startsWith(`${temporaryRoot}${path.sep}retex-api-test-`));
  rmSync(resolved, { recursive: true, force: true });
});

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("knowledge API accepts parent pages and rejects cycles and non-empty deletion", async () => {
  const folder = repositories.createFolder({ type: "knowledge", name: "API tree" });
  const parent = repositories.createKnowledge({ folderId: folder.id, title: "API parent" });

  const createResponse = await collectionRoute.POST(
    jsonRequest("http://localhost/api/knowledge", "POST", {
      folderId: folder.id,
      parentId: parent.id,
      title: "API child",
    }),
  );
  assert.equal(createResponse.status, 201);
  const child = (await createResponse.json()) as { id: number; parentId: number | null };
  assert.equal(child.parentId, parent.id);

  const cycleResponse = await itemRoute.PATCH(
    jsonRequest(`http://localhost/api/knowledge/${parent.id}`, "PATCH", {
      parentId: child.id,
    }),
    { params: Promise.resolve({ id: String(parent.id) }) },
  );
  assert.equal(cycleResponse.status, 409);

  const deleteResponse = await itemRoute.DELETE(
    new Request(`http://localhost/api/knowledge/${parent.id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: String(parent.id) }) },
  );
  assert.equal(deleteResponse.status, 409);
  assert.equal((await deleteResponse.json() as { error: { code: string } }).error.code, "NOT_EMPTY");
});

test("knowledge Markdown images stage, enforce ownership, and clean up atomically", async () => {
  const folder = repositories.createFolder({ type: "knowledge", name: "API images" });
  const createdResponse = await collectionRoute.POST(
    new Request("http://localhost/api/knowledge", {
      method: "POST",
      body: noteForm(
        {
          folderId: folder.id,
          title: "Illustrated knowledge",
          contentMd: "![Tiny](retex-upload://tiny)",
        },
        [["tiny", png, "image/png"]],
      ),
    }),
  );
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()) as { id: number; contentMd: string };
  const [imagePath] = repositories.listNoteImagePaths("knowledge", created.id);
  assert.ok(imagePath);
  assert.match(created.contentMd, /\/api\/uploads\/notes\/[A-Za-z0-9.-]+/);
  assert.deepEqual((await noteImageStorage.readNoteImage(imagePath)).data, png);

  assert.throws(
    () => repositories.updateKnowledge(created.id, { contentMd: "Removed directly." }),
    (error: unknown) =>
      error instanceof repositories.RepositoryError && error.code === "CONFLICT",
  );
  assert.throws(
    () => repositories.deleteKnowledge(created.id),
    (error: unknown) =>
      error instanceof repositories.RepositoryError && error.code === "CONFLICT",
  );

  const foreignResponse = await itemRoute.PATCH(
    jsonRequest(`http://localhost/api/knowledge/${created.id}`, "PATCH", {
      contentMd: "![Foreign](/api/uploads/notes/not-owned.png)",
    }),
    { params: Promise.resolve({ id: String(created.id) }) },
  );
  assert.equal(foreignResponse.status, 409);
  assert.equal(repositories.getKnowledge(created.id)?.contentMd, created.contentMd);
  assert.deepEqual((await noteImageStorage.readNoteImage(imagePath)).data, png);

  const copiedImageResponse = await collectionRoute.POST(
    jsonRequest("http://localhost/api/knowledge", "POST", {
      folderId: folder.id,
      title: "Copied managed image",
      contentMd: created.contentMd,
    }),
  );
  assert.equal(copiedImageResponse.status, 409);

  const missingContent = await collectionRoute.POST(
    new Request("http://localhost/api/knowledge", {
      method: "POST",
      body: noteForm(
        { folderId: folder.id, title: "Missing image content" },
        [["missing", png, "image/png"]],
      ),
    }),
  );
  assert.equal(missingContent.status, 400);
  const missingPatchContent = await itemRoute.PATCH(
    new Request(`http://localhost/api/knowledge/${created.id}`, {
      method: "PATCH",
      body: noteForm(
        { title: "Uploads still require content" },
        [["patch-missing", png, "image/png"]],
      ),
    }),
    { params: Promise.resolve({ id: String(created.id) }) },
  );
  assert.equal(missingPatchContent.status, 400);

  const unreferencedUpload = await collectionRoute.POST(
    new Request("http://localhost/api/knowledge", {
      method: "POST",
      body: noteForm(
        {
          folderId: folder.id,
          title: "Unreferenced upload",
          contentMd: "No image placeholder.",
        },
        [["unused", png, "image/png"]],
      ),
    }),
  );
  assert.equal(unreferencedUpload.status, 400);

  const beforeRollback = await uploadFiles();
  const failedCreate = await collectionRoute.POST(
    new Request("http://localhost/api/knowledge", {
      method: "POST",
      body: noteForm(
        {
          folderId: 999_999,
          title: "Rollback staged image",
          contentMd: "![Rollback](retex-upload://rollback)",
        },
        [["rollback", png, "image/png"]],
      ),
    }),
  );
  assert.equal(failedCreate.status, 404);
  assert.deepEqual(await uploadFiles(), beforeRollback);

  const imageCountBeforeAtomicFailure = database.sqlite
    .prepare("SELECT count(*) FROM note_image")
    .pluck()
    .get();
  database.sqlite.exec(`
    CREATE TRIGGER fail_knowledge_image_atomic
    BEFORE INSERT ON note_link
    WHEN NEW.source_kind = 'knowledge' AND NEW.target_title_key = 'atomic image target'
    BEGIN
      SELECT RAISE(ABORT, 'forced knowledge image failure');
    END;
  `);
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const atomicFailure = await collectionRoute.POST(
      new Request("http://localhost/api/knowledge", {
        method: "POST",
        body: noteForm(
          {
            folderId: folder.id,
            title: "Atomic image failure",
            contentMd:
              "[[Atomic image target]] ![Atomic](retex-upload://atomic)",
          },
          [["atomic", png, "image/png"]],
        ),
      }),
    );
    assert.notEqual(atomicFailure.status, 201);
  } finally {
    console.error = originalConsoleError;
    database.sqlite.exec("DROP TRIGGER IF EXISTS fail_knowledge_image_atomic");
  }
  assert.equal(
    database.sqlite.prepare("SELECT count(*) FROM note_image").pluck().get(),
    imageCountBeforeAtomicFailure,
  );
  assert.equal(
    repositories.listKnowledge().some(({ title }) => title === "Atomic image failure"),
    false,
  );
  assert.deepEqual(await uploadFiles(), beforeRollback);

  const addImageResponse = await itemRoute.PATCH(
    new Request(`http://localhost/api/knowledge/${created.id}`, {
      method: "PATCH",
      body: noteForm(
        {
          contentMd: `${created.contentMd}\n\n![Second](retex-upload://second)`,
        },
        [["second", png, "image/png"]],
      ),
    }),
    { params: Promise.resolve({ id: String(created.id) }) },
  );
  assert.equal(addImageResponse.status, 200);
  const ownedAfterAdd = repositories.listNoteImagePaths("knowledge", created.id);
  assert.equal(ownedAfterAdd.length, 2);
  const addedImagePath = ownedAfterAdd.find((ownedPath) => ownedPath !== imagePath);
  assert.ok(addedImagePath);
  assert.deepEqual((await noteImageStorage.readNoteImage(addedImagePath)).data, png);

  const removeResponse = await itemRoute.PATCH(
    jsonRequest(`http://localhost/api/knowledge/${created.id}`, "PATCH", {
      contentMd: "The image was removed.",
    }),
    { params: Promise.resolve({ id: String(created.id) }) },
  );
  assert.equal(removeResponse.status, 200);
  assert.deepEqual(repositories.listNoteImagePaths("knowledge", created.id), []);
  await assert.rejects(noteImageStorage.readNoteImage(imagePath), { code: "NOT_FOUND" });
  await assert.rejects(noteImageStorage.readNoteImage(addedImagePath), { code: "NOT_FOUND" });

  const deleteCreateResponse = await collectionRoute.POST(
    new Request("http://localhost/api/knowledge", {
      method: "POST",
      body: noteForm(
        {
          folderId: folder.id,
          title: "Delete illustrated knowledge",
          contentMd: "![Delete](retex-upload://delete)",
        },
        [["delete", png, "image/png"]],
      ),
    }),
  );
  assert.equal(deleteCreateResponse.status, 201);
  const deleteCreated = (await deleteCreateResponse.json()) as { id: number };
  const [deleteImagePath] = repositories.listNoteImagePaths(
    "knowledge",
    deleteCreated.id,
  );
  assert.ok(deleteImagePath);

  const deleteResponse = await itemRoute.DELETE(
    new Request(`http://localhost/api/knowledge/${deleteCreated.id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: String(deleteCreated.id) }) },
  );
  assert.equal(deleteResponse.status, 204);
  assert.equal(repositories.getKnowledge(deleteCreated.id), null);
  await assert.rejects(noteImageStorage.readNoteImage(deleteImagePath), { code: "NOT_FOUND" });
});

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);

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
  try {
    return (await readdir(process.env.RETEX_NOTE_UPLOAD_DIRECTORY!)).sort();
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
