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
let previousNoteUploadDirectory: string | undefined;

before(async () => {
  temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "retex-exercise-markdown-api-"),
  );
  previousDatabasePath = process.env.RETEX_DATABASE_PATH;
  previousNoteUploadDirectory = process.env.RETEX_NOTE_UPLOAD_DIRECTORY;
  process.env.RETEX_DATABASE_PATH = path.join(temporaryDirectory, "sqlite.db");
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
  restoreEnvironment("RETEX_NOTE_UPLOAD_DIRECTORY", previousNoteUploadDirectory);

  const resolved = path.resolve(temporaryDirectory);
  const temporaryRoot = path.resolve(os.tmpdir());
  assert.ok(
    resolved.startsWith(`${temporaryRoot}${path.sep}retex-exercise-markdown-api-`),
  );
  rmSync(resolved, { recursive: true, force: true });
});

test("exercise Markdown images share ownership across problem, answer, and solution", async () => {
  const folder = repositories.createFolder({ type: "exercise", name: "Image API" });
  const createResponse = await collectionRoute.POST(
    new Request("http://localhost/api/exercises", {
      method: "POST",
      body: noteForm(
        {
          folderId: folder.id,
          title: "Illustrated exercise",
          problemMd: [
            "Problem text",
            "![Shared problem](retex-upload://shared)",
            "![Problem only](retex-upload://problem)",
          ].join("\n"),
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
          ["problem", jpeg, "image/jpeg"],
          ["answer", gif, "image/gif"],
          ["solution", webp, "image/webp"],
        ],
      ),
    }),
  );

  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()) as {
    id: number;
    problemMd: string;
    answerMd: string;
    solutionMd: string;
  };
  assert.equal(created.problemMd.includes("retex-upload://"), false);
  assert.equal(created.answerMd.includes("retex-upload://"), false);
  assert.equal(created.solutionMd.includes("retex-upload://"), false);

  const problemPaths = [...storage.managedImagePathsInMarkdown(created.problemMd)];
  const answerPaths = [...storage.managedImagePathsInMarkdown(created.answerMd)];
  const solutionPaths = [...storage.managedImagePathsInMarkdown(created.solutionMd)];
  const sharedImagePath = problemPaths.find(
    (imagePath) => answerPaths.includes(imagePath) && solutionPaths.includes(imagePath),
  );
  const problemOnlyImagePath = problemPaths.find(
    (imagePath) => imagePath !== sharedImagePath,
  );
  const answerOnlyImagePath = answerPaths.find(
    (imagePath) => imagePath !== sharedImagePath,
  );
  const solutionOnlyImagePath = solutionPaths.find(
    (imagePath) => imagePath !== sharedImagePath,
  );
  assert.ok(sharedImagePath);
  assert.ok(problemOnlyImagePath);
  assert.ok(answerOnlyImagePath);
  assert.ok(solutionOnlyImagePath);
  assert.deepEqual(
    repositories.listNoteImagePaths("exercise", created.id),
    [sharedImagePath, problemOnlyImagePath, answerOnlyImagePath, solutionOnlyImagePath].sort(),
  );

  const patchResponse = await itemRoute.PATCH(
    jsonRequest(`http://localhost/api/exercises/${created.id}`, "PATCH", {
      problemMd: "The problem no longer contains an image.",
      answerMd: "The answer no longer contains an image.",
    }),
    { params: Promise.resolve({ id: String(created.id) }) },
  );
  assert.equal(patchResponse.status, 200);
  const patched = (await patchResponse.json()) as {
    problemMd: string;
    answerMd: string;
    solutionMd: string;
  };
  assert.equal(patched.problemMd, "The problem no longer contains an image.");
  assert.equal(patched.answerMd, "The answer no longer contains an image.");
  assert.equal(patched.solutionMd, created.solutionMd);
  assert.deepEqual(
    repositories.listNoteImagePaths("exercise", created.id),
    [sharedImagePath, solutionOnlyImagePath].sort(),
  );
  await assert.rejects(
    storage.readNoteImage(problemOnlyImagePath),
    hasStorageCode("NOT_FOUND"),
  );
  await assert.rejects(
    storage.readNoteImage(answerOnlyImagePath),
    hasStorageCode("NOT_FOUND"),
  );
  assert.deepEqual((await storage.readNoteImage(sharedImagePath)).data, png);
  assert.deepEqual((await storage.readNoteImage(solutionOnlyImagePath)).data, webp);
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
  assert.deepEqual(await noteStagingFiles(), []);
});

test("exercise API accepts JSON and requires a nonblank problem", async () => {
  const folder = repositories.createFolder({ type: "exercise", name: "Request formats" });
  const createResponse = await collectionRoute.POST(
    jsonRequest("http://localhost/api/exercises", "POST", {
      folderId: folder.id,
      title: "JSON exercise",
      problemMd: "  JSON problem  \n",
      answerMd: "JSON answer",
      solutionMd: "JSON solution",
    }),
  );
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()) as { id: number; problemMd: string };
  assert.equal(created.problemMd, "  JSON problem  \n");

  const missingProblem = await collectionRoute.POST(
    jsonRequest("http://localhost/api/exercises", "POST", {
      folderId: folder.id,
      title: "Missing problem",
      answerMd: "Answer",
    }),
  );
  assert.equal(missingProblem.status, 400);
  assert.equal(
    ((await missingProblem.json()) as { error: { code: string } }).error.code,
    "VALIDATION_ERROR",
  );

  const blankPatch = await itemRoute.PATCH(
    jsonRequest(`http://localhost/api/exercises/${created.id}`, "PATCH", {
      problemMd: "  \n",
    }),
    { params: Promise.resolve({ id: String(created.id) }) },
  );
  assert.equal(blankPatch.status, 400);
  assert.equal(repositories.getExercise(created.id)?.problemMd, "  JSON problem  \n");
});

test("exercise PATCH rolls back note image staging when one upload is invalid", async () => {
  const folder = repositories.createFolder({ type: "exercise", name: "Patch rollback" });
  const created = repositories.createExercise({
    folderId: folder.id,
    title: "Original exercise",
    problemMd: "Original problem",
    answerMd: "Original answer",
    solutionMd: "Original solution",
  });

  const patchResponse = await itemRoute.PATCH(
    new Request(`http://localhost/api/exercises/${created.id}`, {
      method: "PATCH",
      body: noteForm(
        {
          problemMd: [
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
  assert.equal(unchanged?.problemMd, "Original problem");
  assert.equal(unchanged?.answerMd, "Original answer");
  assert.equal(unchanged?.solutionMd, "Original solution");
  assert.deepEqual(repositories.listNoteImagePaths("exercise", created.id), []);
  assert.deepEqual(await noteUploadFiles(), []);
  assert.deepEqual(await noteStagingFiles(), []);
});

test("exercise PATCH rejects uploads when no Markdown field is supplied", async () => {
  const folder = repositories.createFolder({ type: "exercise", name: "Upload fields" });
  const created = repositories.createExercise({
    folderId: folder.id,
    title: "Upload field exercise",
    problemMd: "Problem",
  });
  const response = await itemRoute.PATCH(
    new Request(`http://localhost/api/exercises/${created.id}`, {
      method: "PATCH",
      body: noteForm(
        { title: "Uploads still require Markdown" },
        [["missing", png, "image/png"]],
      ),
    }),
    { params: Promise.resolve({ id: String(created.id) }) },
  );
  assert.equal(response.status, 400);
  assert.equal(repositories.getExercise(created.id)?.title, "Upload field exercise");
  assert.deepEqual(await noteUploadFiles(), []);
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
