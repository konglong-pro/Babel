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
let storage: typeof import("../src/lib/storage");
let collectionRoute: typeof import("../src/app/api/exercises/route");
let itemRoute: typeof import("../src/app/api/exercises/[id]/route");
let previousDatabasePath: string | undefined;
let previousExerciseUploadDirectory: string | undefined;
let previousNoteUploadDirectory: string | undefined;

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "retex-exercise-images-api-"));
  previousDatabasePath = process.env.RETEX_DATABASE_PATH;
  previousExerciseUploadDirectory = process.env.RETEX_UPLOAD_DIRECTORY;
  previousNoteUploadDirectory = process.env.RETEX_NOTE_UPLOAD_DIRECTORY;
  process.env.RETEX_DATABASE_PATH = path.join(temporaryDirectory, "sqlite.db");
  process.env.RETEX_UPLOAD_DIRECTORY = path.join(
    temporaryDirectory,
    "uploads",
    "exercises",
  );
  process.env.RETEX_NOTE_UPLOAD_DIRECTORY = path.join(
    temporaryDirectory,
    "uploads",
    "notes",
  );

  database = await import("../src/lib/db/client");
  migrate(database.db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  [repositories, storage, collectionRoute, itemRoute] = await Promise.all([
    import("../src/lib/repositories"),
    import("../src/lib/storage"),
    import("../src/app/api/exercises/route"),
    import("../src/app/api/exercises/[id]/route"),
  ]);
});

after(() => {
  database.sqlite.close();
  restoreEnvironment("RETEX_DATABASE_PATH", previousDatabasePath);
  restoreEnvironment("RETEX_UPLOAD_DIRECTORY", previousExerciseUploadDirectory);
  restoreEnvironment("RETEX_NOTE_UPLOAD_DIRECTORY", previousNoteUploadDirectory);

  const resolved = path.resolve(temporaryDirectory);
  const temporaryRoot = path.resolve(os.tmpdir());
  assert.ok(resolved.startsWith(`${temporaryRoot}${path.sep}retex-exercise-images-api-`));
  rmSync(resolved, { recursive: true, force: true });
});

test("exercise Markdown images share ownership across answer and solution", async () => {
  const folder = repositories.createFolder({ type: "exercise", name: "Image API" });
  const primaryImagePath = await storage.saveExerciseImage(upload(png, "image/png"));
  const createResponse = await collectionRoute.POST(
    new Request("http://localhost/api/exercises", {
      method: "POST",
      body: noteForm(
        {
          folderId: folder.id,
          title: "Illustrated exercise",
          imagePath: primaryImagePath,
          answerMd: [
            "![Shared answer](retex-upload://shared)",
            "![Answer only](retex-upload://answer)",
          ].join("\n"),
          solutionMd: [
            "![Shared solution](retex-upload://shared)",
            "![Solution only](retex-upload://solution)",
          ].join("\n"),
        },
        [
          ["shared", png, "image/png"],
          ["answer", gif, "image/gif"],
          ["solution", webp, "image/webp"],
        ],
      ),
    }),
  );

  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()) as {
    id: number;
    imagePath: string;
    answerMd: string;
    solutionMd: string;
  };
  assert.equal(created.imagePath, primaryImagePath);
  assert.equal(created.answerMd.includes("retex-upload://"), false);
  assert.equal(created.solutionMd.includes("retex-upload://"), false);

  const answerPaths = [...storage.managedImagePathsInMarkdown(created.answerMd)];
  const solutionPaths = [...storage.managedImagePathsInMarkdown(created.solutionMd)];
  const sharedImagePath = answerPaths.find((imagePath) => solutionPaths.includes(imagePath));
  const answerOnlyImagePath = answerPaths.find(
    (imagePath) => !solutionPaths.includes(imagePath),
  );
  const solutionOnlyImagePath = solutionPaths.find(
    (imagePath) => !answerPaths.includes(imagePath),
  );
  assert.ok(sharedImagePath);
  assert.ok(answerOnlyImagePath);
  assert.ok(solutionOnlyImagePath);
  assert.deepEqual(
    repositories.listNoteImagePaths("exercise", created.id),
    [answerOnlyImagePath, sharedImagePath, solutionOnlyImagePath].sort(),
  );
  assert.equal(
    database.sqlite
      .prepare("SELECT count(*) FROM note_image WHERE source_kind = 'exercise' AND source_id = ?")
      .pluck()
      .get(created.id),
    3,
  );
  assert.equal(
    repositories.listNoteImagePaths("exercise", created.id).includes(primaryImagePath),
    false,
  );
  assert.deepEqual((await storage.readExerciseImage(primaryImagePath)).data, png);

  const patchResponse = await itemRoute.PATCH(
    jsonRequest(`http://localhost/api/exercises/${created.id}`, "PATCH", {
      answerMd: "The answer no longer contains an image.",
    }),
    { params: Promise.resolve({ id: String(created.id) }) },
  );
  assert.equal(patchResponse.status, 200);
  const patched = (await patchResponse.json()) as {
    answerMd: string;
    solutionMd: string;
  };
  assert.equal(patched.answerMd, "The answer no longer contains an image.");
  assert.equal(patched.solutionMd, created.solutionMd);
  assert.deepEqual(
    repositories.listNoteImagePaths("exercise", created.id),
    [sharedImagePath, solutionOnlyImagePath].sort(),
  );
  await assert.rejects(
    storage.readNoteImage(answerOnlyImagePath),
    hasStorageCode("NOT_FOUND"),
  );
  assert.deepEqual((await storage.readNoteImage(sharedImagePath)).data, png);
  assert.deepEqual((await storage.readNoteImage(solutionOnlyImagePath)).data, webp);
  assert.deepEqual((await storage.readExerciseImage(primaryImagePath)).data, png);
  assert.deepEqual(await noteStagingFiles(), []);

  const deleteResponse = await itemRoute.DELETE(
    new Request(`http://localhost/api/exercises/${created.id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: String(created.id) }) },
  );
  assert.equal(deleteResponse.status, 204);
  assert.equal(repositories.getExercise(created.id), null);
  assert.deepEqual(repositories.listNoteImagePaths("exercise", created.id), []);
  await assert.rejects(storage.readNoteImage(sharedImagePath), hasStorageCode("NOT_FOUND"));
  await assert.rejects(
    storage.readNoteImage(solutionOnlyImagePath),
    hasStorageCode("NOT_FOUND"),
  );
  await assert.rejects(
    storage.readExerciseImage(primaryImagePath),
    hasStorageCode("NOT_FOUND"),
  );
  assert.deepEqual(await noteStagingFiles(), []);
});

test("exercise API keeps JSON compatibility and validates multipart uploads", async () => {
  const folder = repositories.createFolder({ type: "exercise", name: "Request formats" });
  const primaryImagePath = await storage.saveExerciseImage(upload(jpeg, "image/jpeg"));
  const createResponse = await collectionRoute.POST(
    jsonRequest("http://localhost/api/exercises", "POST", {
      folderId: folder.id,
      title: "JSON exercise",
      imagePath: primaryImagePath,
      answerMd: "JSON answer",
      solutionMd: "JSON solution",
    }),
  );
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()) as {
    id: number;
    imagePath: string;
    answerMd: string;
  };
  assert.equal(created.imagePath, primaryImagePath);
  assert.deepEqual(repositories.listNoteImagePaths("exercise", created.id), []);

  const jsonPatch = await itemRoute.PATCH(
    jsonRequest(`http://localhost/api/exercises/${created.id}`, "PATCH", {
      answerMd: "Updated through JSON",
    }),
    { params: Promise.resolve({ id: String(created.id) }) },
  );
  assert.equal(jsonPatch.status, 200);
  assert.equal(
    ((await jsonPatch.json()) as { answerMd: string }).answerMd,
    "Updated through JSON",
  );

  const missingMarkdown = await itemRoute.PATCH(
    new Request(`http://localhost/api/exercises/${created.id}`, {
      method: "PATCH",
      body: noteForm(
        { title: "Uploads still require Markdown" },
        [["missing", png, "image/png"]],
      ),
    }),
    { params: Promise.resolve({ id: String(created.id) }) },
  );
  assert.equal(missingMarkdown.status, 400);
  assert.equal(
    ((await missingMarkdown.json()) as { error: { code: string } }).error.code,
    "VALIDATION_ERROR",
  );
  assert.equal(repositories.getExercise(created.id)?.title, "JSON exercise");
  assert.deepEqual(repositories.listNoteImagePaths("exercise", created.id), []);
  assert.deepEqual(await noteUploadFiles(), []);
  assert.deepEqual((await storage.readExerciseImage(primaryImagePath)).data, jpeg);

  const duplicateUploadForm = noteForm(
    {
      answerMd: "![Duplicate](retex-upload://duplicate)",
    },
    [["duplicate", png, "image/png"]],
  );
  duplicateUploadForm.append(
    "image:duplicate",
    new Blob([Uint8Array.from(png)], { type: "image/png" }),
    "duplicate-again.png",
  );
  const duplicateUpload = await itemRoute.PATCH(
    new Request(`http://localhost/api/exercises/${created.id}`, {
      method: "PATCH",
      body: duplicateUploadForm,
    }),
    { params: Promise.resolve({ id: String(created.id) }) },
  );
  assert.equal(duplicateUpload.status, 400);
  assert.equal(
    ((await duplicateUpload.json()) as { error: { code: string } }).error.code,
    "VALIDATION_ERROR",
  );
  assert.deepEqual(repositories.listNoteImagePaths("exercise", created.id), []);
  assert.deepEqual(await noteUploadFiles(), []);
  assert.deepEqual((await storage.readExerciseImage(primaryImagePath)).data, jpeg);

  const deleteResponse = await itemRoute.DELETE(
    new Request(`http://localhost/api/exercises/${created.id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: String(created.id) }) },
  );
  assert.equal(deleteResponse.status, 204);
  await assert.rejects(
    storage.readExerciseImage(primaryImagePath),
    hasStorageCode("NOT_FOUND"),
  );
});

test("exercise PATCH removes a replacement primary image when note image staging fails", async () => {
  const folder = repositories.createFolder({ type: "exercise", name: "Patch rollback" });
  const originalImagePath = await storage.saveExerciseImage(upload(jpeg, "image/jpeg"));
  const createResponse = await collectionRoute.POST(
    jsonRequest("http://localhost/api/exercises", "POST", {
      folderId: folder.id,
      title: "Original exercise",
      imagePath: originalImagePath,
      answerMd: "Original answer",
      solutionMd: "Original solution",
    }),
  );
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()) as { id: number };

  const replacementImagePath = await storage.saveExerciseImage(
    upload(png, "image/png"),
  );
  const patchResponse = await itemRoute.PATCH(
    new Request(`http://localhost/api/exercises/${created.id}`, {
      method: "PATCH",
      body: noteForm(
        {
          imagePath: replacementImagePath,
          answerMd: [
            "![Valid](retex-upload://valid)",
            "![Invalid](retex-upload://invalid)",
          ].join("\n"),
        },
        [
          ["valid", png, "image/png"],
          ["invalid", Buffer.from("not a PNG", "utf8"), "image/png"],
        ],
      ),
    }),
    { params: Promise.resolve({ id: String(created.id) }) },
  );

  assert.equal(patchResponse.status, 400);
  assert.equal(
    ((await patchResponse.json()) as { error: { code: string } }).error.code,
    "INVALID_CONTENT",
  );
  const unchanged = repositories.getExercise(created.id);
  assert.equal(unchanged?.imagePath, originalImagePath);
  assert.equal(unchanged?.answerMd, "Original answer");
  assert.equal(unchanged?.solutionMd, "Original solution");
  assert.deepEqual(repositories.listNoteImagePaths("exercise", created.id), []);
  assert.deepEqual((await storage.readExerciseImage(originalImagePath)).data, jpeg);
  await assert.rejects(
    storage.readExerciseImage(replacementImagePath),
    hasStorageCode("NOT_FOUND"),
  );
  assert.deepEqual(await noteUploadFiles(), []);
  assert.deepEqual(await noteStagingFiles(), []);

  const deleteResponse = await itemRoute.DELETE(
    new Request(`http://localhost/api/exercises/${created.id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: String(created.id) }) },
  );
  assert.equal(deleteResponse.status, 204);
});

test("exercise PATCH removes a replacement primary image when multipart fields are duplicated", async () => {
  const folder = repositories.createFolder({ type: "exercise", name: "Multipart rollback" });
  const originalImagePath = await storage.saveExerciseImage(upload(jpeg, "image/jpeg"));
  const createResponse = await collectionRoute.POST(
    jsonRequest("http://localhost/api/exercises", "POST", {
      folderId: folder.id,
      title: "Multipart original",
      imagePath: originalImagePath,
      answerMd: "Original answer",
      solutionMd: "Original solution",
    }),
  );
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()) as { id: number };

  const replacementImagePath = await storage.saveExerciseImage(
    upload(png, "image/png"),
  );
  const duplicateUploadForm = noteForm(
    {
      imagePath: replacementImagePath,
      answerMd: "![Duplicate](retex-upload://duplicate)",
    },
    [["duplicate", png, "image/png"]],
  );
  duplicateUploadForm.append(
    "image:duplicate",
    new Blob([Uint8Array.from(png)], { type: "image/png" }),
    "duplicate-again.png",
  );
  const patchResponse = await itemRoute.PATCH(
    new Request(`http://localhost/api/exercises/${created.id}`, {
      method: "PATCH",
      body: duplicateUploadForm,
    }),
    { params: Promise.resolve({ id: String(created.id) }) },
  );

  assert.equal(patchResponse.status, 400);
  assert.equal(
    ((await patchResponse.json()) as { error: { code: string } }).error.code,
    "VALIDATION_ERROR",
  );
  const unchanged = repositories.getExercise(created.id);
  assert.equal(unchanged?.imagePath, originalImagePath);
  assert.equal(unchanged?.answerMd, "Original answer");
  assert.equal(unchanged?.solutionMd, "Original solution");
  assert.deepEqual(repositories.listNoteImagePaths("exercise", created.id), []);
  assert.deepEqual((await storage.readExerciseImage(originalImagePath)).data, jpeg);
  await assert.rejects(
    storage.readExerciseImage(replacementImagePath),
    hasStorageCode("NOT_FOUND"),
  );
  assert.deepEqual(await noteUploadFiles(), []);
  assert.deepEqual(await noteStagingFiles(), []);

  const deleteResponse = await itemRoute.DELETE(
    new Request(`http://localhost/api/exercises/${created.id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: String(created.id) }) },
  );
  assert.equal(deleteResponse.status, 204);
});

test("exercise PATCH removes a replacement primary image when field validation fails", async () => {
  const folder = repositories.createFolder({ type: "exercise", name: "Field rollback" });
  const originalImagePath = await storage.saveExerciseImage(upload(jpeg, "image/jpeg"));
  const createResponse = await collectionRoute.POST(
    jsonRequest("http://localhost/api/exercises", "POST", {
      folderId: folder.id,
      title: "Field original",
      imagePath: originalImagePath,
      answerMd: "Original answer",
      solutionMd: "Original solution",
    }),
  );
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()) as { id: number };

  const replacementImagePath = await storage.saveExerciseImage(
    upload(png, "image/png"),
  );
  const patchResponse = await itemRoute.PATCH(
    jsonRequest(`http://localhost/api/exercises/${created.id}`, "PATCH", {
      imagePath: replacementImagePath,
      folderId: 0,
    }),
    { params: Promise.resolve({ id: String(created.id) }) },
  );

  assert.equal(patchResponse.status, 400);
  assert.equal(
    ((await patchResponse.json()) as { error: { code: string } }).error.code,
    "VALIDATION_ERROR",
  );
  const unchanged = repositories.getExercise(created.id);
  assert.equal(unchanged?.imagePath, originalImagePath);
  assert.equal(unchanged?.folderId, folder.id);
  assert.equal(unchanged?.answerMd, "Original answer");
  assert.equal(unchanged?.solutionMd, "Original solution");
  assert.deepEqual(repositories.listNoteImagePaths("exercise", created.id), []);
  assert.deepEqual((await storage.readExerciseImage(originalImagePath)).data, jpeg);
  await assert.rejects(
    storage.readExerciseImage(replacementImagePath),
    hasStorageCode("NOT_FOUND"),
  );
  assert.deepEqual(await noteUploadFiles(), []);
  assert.deepEqual(await noteStagingFiles(), []);

  const deleteResponse = await itemRoute.DELETE(
    new Request(`http://localhost/api/exercises/${created.id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: String(created.id) }) },
  );
  assert.equal(deleteResponse.status, 204);
});

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
const gif = Buffer.from("GIF89a\x01", "binary");
const webp = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x01, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "ascii"),
]);

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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

function upload(data: Buffer, type: string): {
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
} {
  return {
    type,
    size: data.byteLength,
    async arrayBuffer() {
      return Uint8Array.from(data).buffer;
    },
  };
}

function hasStorageCode(code: string): (error: unknown) => boolean {
  return (error: unknown) =>
    error instanceof storage.ImageStorageError && error.code === code;
}

async function noteUploadFiles(): Promise<string[]> {
  try {
    return (await readdir(process.env.RETEX_NOTE_UPLOAD_DIRECTORY!))
      .filter((entry) => entry !== ".staging")
      .sort();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

async function noteStagingFiles(): Promise<string[]> {
  try {
    return (
      await readdir(path.join(process.env.RETEX_NOTE_UPLOAD_DIRECTORY!, ".staging"))
    ).sort();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
